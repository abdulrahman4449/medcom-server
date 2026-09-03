// ---------- the speaker check at sign-on ----------
//
// A phone that cannot make a noise looks exactly like a phone with nothing to
// make a noise about. The crew screen has always carried buttons to play each
// tone, and the whole department has been asked to press one — which is a
// thing people do on the first day and never again. The check that matters is
// the one nobody has to remember: at sign-on, before the first call, while the
// crew are still standing at the truck and can do something about it.
//
// WHY IT CAN BE AUTOMATIC AT ALL. Page audio cannot play until the page has
// been tapped, so on the web this would be silence pretending to be a check —
// worse than not checking, because silence reads as a broken speaker. On a
// shell the tone goes out through the plugin on the alarm stream, which needs
// no gesture and is the same path a dispatch takes. So it runs on the shell
// and only on the shell.
//
// ONCE PER SIGN-ON, not once per render and not once per poll. The key is the
// person, the truck and the shift window together: the same crew member back
// on the same truck for a second shift is a new shift and gets a new check,
// and a refresh, a re-render or coming back from the background is not.
export const SPEAKER_CHECK_KEY = "ems:speakerChecked";

// The identity of one sign-on. Empty when any part is missing, and an empty
// key never runs a check — a half-built session must not fire a tone.
export function speakerCheckKey(user, unit) {
  if (!user || !unit) return "";
  const who = user.accountId || user.id || "";
  const truck = unit.id || "";
  const shift = user.shiftStart || "";
  if (!who || !truck || !shift) return "";
  return `${who}|${truck}|${shift}`;
}

// Has this device already checked itself for this sign-on? The store is passed
// in rather than reached for, so this is testable and so a device with storage
// turned off degrades to "check again" rather than throwing.
export function speakerCheckDone(key, store) {
  if (!key) return true;
  try {
    return (store && store.getItem(SPEAKER_CHECK_KEY)) === key;
  } catch (e) {
    return false;
  }
}

export function markSpeakerCheckDone(key, store) {
  if (!key) return;
  try {
    if (store) store.setItem(SPEAKER_CHECK_KEY, key);
  } catch (e) {
    // A device with storage blocked checks once per load. That is noisier than
    // intended and still better than never checking.
  }
}

// Everything that has to be true before a tone is played at somebody without
// them asking for it.
//
// The alarm condition is the important one: a real call sounding is never
// interrupted by a test of whether sound works. Nor does a check run on a
// truck that is already out on a call — the crew are working, and a phone that
// has been dispatched has just proved the point anyway.
export function speakerCheckDue({ key, hasShell, alarmActive, onCall, done }) {
  if (!key) return false;
  if (!hasShell) return false;
  if (alarmActive) return false;
  if (onCall) return false;
  if (done) return false;
  return true;
}

// What the crew are told afterwards. The check is only worth running if its
// answer is on the screen: a tone somebody half-heard while putting a bag in
// the truck proves nothing by itself.
export function speakerCheckResult(answer) {
  if (!answer || typeof answer !== "object") {
    return { ok: false, say: "The speaker check could not run on this phone. Test it by hand before you take a call." };
  }
  if (answer.ok === false) {
    return { ok: false, say: "This phone could not play the alert tone. Test it by hand and tell the desk before you take a call." };
  }
  const tone = answer.tone ? String(answer.tone).toUpperCase() : "";
  const vol = typeof answer.alarmVolumePct === "number"
    ? answer.alarmVolumePct
    : (typeof answer.outputVolumePct === "number" ? answer.outputVolumePct : null);
  const quiet = vol !== null && vol < 40;
  return {
    ok: !quiet,
    say: quiet
      ? `Speaker checked — but this phone is at ${vol}%. Turn it up before your shift.`
      : `Speaker checked${tone ? ` · ${tone} tone` : ""}${vol !== null ? ` · ${vol}%` : ""} — this phone will be heard.`,
  };
}
