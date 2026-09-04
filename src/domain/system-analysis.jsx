// ---------- system analysis ----------
//
// What this device would tell somebody diagnosing it — and, far more often,
// whether there is anything to tell at all.
//
// The crew screen used to carry the whole diagnostic line permanently: build
// stamp, shell report, page audio state, last alarm, last stand-down, the four
// handset settings. That line has answered every "no tone" report this app has
// had, so it cannot be deleted. But a line that says everything is fine on
// every screen of every shift is a line people stop reading, and the shift it
// finally says something is the shift nobody looks at it.
//
// So the readings are turned into FAULTS first. A fault shows itself where the
// crew are standing; a clean device carries one quiet chip beside the person's
// name and nothing else, with the whole line one tap inside it. Nothing is
// lost — it is only quiet until it matters.
//
// Pure on purpose: every reading is passed in as the string or number the
// caller already had, so the rules are under `npm test` rather than being
// re-derived by eye off a handset.

// Ranked worst first, because the chip can only wear one colour and the banner
// reads top-down: a phone that cannot be heard at all outranks one that is a
// build behind.
export function systemFaults(input) {
  const it = input && typeof input === "object" ? input : {};
  const bg = it.bg && typeof it.bg === "object" ? it.bg : null;
  const held = typeof it.held === "number" ? it.held : 0;
  const onIos = bg ? bg.platform === "ios" : false;
  // Each entry carries its own level, so the chip can colour itself from the
  // first one without the caller re-deriving which list it came out of.
  const bad = [];
  const warn = [];
  const isBad = (f) => ({ ...f, level: "bad" });
  const isWarn = (f) => ({ ...f, level: "warn" });

  // --- the phone cannot be heard ---
  if (bg && bg.notificationsEnabled === false) {
    bad.push(isBad({ which: "notifications", say: "Notifications are turned off for this app." }));
  } else if (bg && !onIos && bg.channelSilenced) {
    bad.push(isBad({ which: "channel", say: "The Dispatch alerts channel has been silenced on this phone." }));
  }
  if (bg && onIos && typeof bg.alarmVolumePct === "number" && bg.alarmVolumePct < 40) {
    warn.push(isWarn({
      which: null,
      say: `This iPhone is at ${bg.alarmVolumePct}% — the app cannot raise it, so turn it up before the shift.`,
    }));
  } else if (bg && !onIos && bg.volumeFloorOk === false) {
    warn.push(isWarn({ which: "notifications", say: "This phone refused to raise the alarm volume for the last alert." }));
  } else if (bg && !onIos && typeof bg.alarmVolumePct === "number" && bg.alarmVolumePct < 30) {
    warn.push(isWarn({ which: null, say: `The alarm volume is at ${bg.alarmVolumePct}%.` }));
  }
  if (bg && !onIos && bg.batteryOptimised) {
    warn.push(isWarn({ which: "battery", say: "Battery optimisation is on, which freezes the app in the background." }));
  }

  // --- the app on this device is behind the one it is talking to ---
  //
  // Both of these are the same fault wearing two hats — the shell and its
  // plugin ship separately from the web build — and either one is a method the
  // app is about to call and will not find.
  if (/^SHELL IS OLD/.test(String(it.shell || ""))) {
    bad.push(isBad({ which: null, say: `${it.shell} — rebuild and reinstall the app.` }));
  }
  if (String(it.shellNote || "").trim()) {
    bad.push(isBad({ which: null, say: String(it.shellNote).replace(/^\s*·\s*/, "") }));
  }

  // --- work this device is holding that the department cannot see ---
  if (String(it.writeError || "").trim()) {
    bad.push(isBad({
      which: null,
      say: `The server is refusing to save${held > 0 ? `. ${held} change${held === 1 ? "" : "s"} held on this device` : ""}. Nothing is lost.`,
    }));
  } else if (it.connectionOk === false) {
    bad.push(isBad({
      which: null,
      say: `No signal${held > 0 ? ` — ${held} change${held === 1 ? "" : "s"} held on this device` : ""}. Nothing is lost.`,
    }));
  } else if (held > 0) {
    warn.push(isWarn({ which: null, say: `${held} change${held === 1 ? "" : "s"} still going up.` }));
  }

  // --- page audio, and only where it is the path a call would take ---
  //
  // On a shell the tone goes down the plugin's alarm stream, so an interrupted
  // AudioContext there says nothing about whether a call will be heard and is
  // not worth a warning on a crew's screen. In a browser it is the only path
  // there is.
  if (String(it.shell || "") === "no shell (browser)" && String(it.pageAudio || "") === "interrupted") {
    warn.push(isWarn({ which: null, say: "This browser's audio was interrupted — reload the page before relying on the tone." }));
  }

  return bad.concat(warn);
}

export function systemSummary(input) {
  const faults = systemFaults(input);
  // The chip can only wear one colour, and the list is ranked worst-first by
  // construction above — so the first fault is the one it wears.
  return {
    ok: faults.length === 0,
    faults,
    level: faults.length ? faults[0].level : "ok",
  };
}

// The whole line, unchanged from what the crew screen used to carry
// permanently. One definition, so the chip's panel and anything that reports a
// device upward can never drift into saying different things about it.
export function systemDetailLine(input) {
  const it = input && typeof input === "object" ? input : {};
  const bg = it.bg && typeof it.bg === "object" ? it.bg : null;
  const held = typeof it.held === "number" ? it.held : 0;
  const bits = [];
  if (it.build) bits.push(`build ${it.build}`);
  if (it.shell) bits.push(`${it.shell}${it.shellNote || ""}`.trim());
  if (it.pageAudio) bits.push(`page audio ${it.pageAudio}`);
  bits.push(`screen held ${it.screenHeld ? "yes" : "no"}`);
  if (it.alarm) bits.push(`last alarm: ${it.alarm}`);
  if (it.standDown) bits.push(`last stand-down: ${it.standDown}`);
  if (bg) {
    const onIos = bg.platform === "ios";
    bits.push(onIos
      ? `device volume ${bg.alarmVolumePct}% (no floor on iPhone)`
      : `alarm volume ${bg.alarmVolumePct}%${String(it.floorNote || "").replace(/^\s*·\s*/, " ")}`.trim());
    bits.push(`notifications ${bg.notificationsEnabled ? "on" : "OFF"}`);
    if (!onIos) {
      bits.push(`channel ${bg.channelSilenced ? "SILENCED" : "ok"}`);
      bits.push(`battery saver ${bg.batteryOptimised ? "ON" : "off"}`);
    }
  }
  bits.push(
    String(it.writeError || "").trim() ? `sync REFUSED (${held} held)`
      : it.connectionOk === false ? `sync OFFLINE (${held} held)`
      : held > 0 ? `sync ${held} going up`
      : "sync ok"
  );
  return bits.filter(Boolean).join(" · ");
}
