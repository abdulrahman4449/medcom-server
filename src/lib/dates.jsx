import { clockStr, forceMidnight } from "../domain/messages.jsx";
import { soundGain, soundSilenced } from "./sound.jsx";

// ---------- dates: Gregorian, always ----------
//
// The service runs its transfers, rosters and logs off the Gregorian calendar,
// but a browser or tablet set to an Arabic locale renders `toLocaleDateString()`
// in Hijri with Arabic-Indic digits — so the same booking would read "١٧ صفر
// ١٤٤٨" on one desk and "3 Nov 2026" on the next, and a crew comparing the two
// has no way to line them up. Every date and time this board shows therefore
// goes through these helpers, which pin the locale, the calendar and the digits
// rather than taking whatever the device is set to.
export const GREG_LOCALE = "en-GB";
export const GREG_BASE = { calendar: "gregory", numberingSystem: "latn" };
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function gregFmt(ts, opts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(GREG_LOCALE, { ...GREG_BASE, ...opts });
  } catch (e) {
    // A browser without full Intl data still has to show something sensible.
    return new Date(ts).toISOString().slice(0, 16).replace("T", " ");
  }
}

// "03 Nov 2026"
export function gregDateStr(ts) {
  return gregFmt(ts, { day: "2-digit", month: "short", year: "numeric" });
}

// "Mon 3 Nov" — the compact form used on badges next to a time.
export function gregDayMonthStr(ts) {
  return gregFmt(ts, { weekday: "short", day: "numeric", month: "short" });
}

// "Monday 3 November 2026" — the day headers on the schedule ahead.
export function gregLongDateStr(ts) {
  return gregFmt(ts, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// "03 Nov 2026, 14:30" — for the exported spreadsheet, where a cell has to
// carry the whole stamp on its own.
export function gregDateTimeStr(ts) {
  return forceMidnight(
    gregFmt(ts, {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    })
  );
}

// "3 Nov, 14:30" — call cards, where the year is noise.
export function gregShortDateTimeStr(ts) {
  return forceMidnight(
    gregFmt(ts, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
  );
}

export function nowTime() {
  return clockStr(Date.now());
}

// One note, gated by its own envelope. The whole sequence used to share a
// single oscillator held at a constant gain, which had two consequences: a rest
// between notes was only a pitch change inside one unbroken tone, and any note
// written with a `start` offset was preceded by the oscillator's default 440Hz
// for the length of that offset — audibly wrong on the routine chime, which is
// two notes with a gap. A gain node per note fixes both: notes start and stop
// where they say they do, and silence between them is real silence.
export function scheduleNote(ctx, t0, note, type, peak) {
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = type || "square";
  const start = t0 + (note.start || 0);
  const end = start + note.dur;
  // Set on the node and again on the timeline: some engines ignore a bare
  // `.value` once the node is scheduled, others need it before the first event.
  osc.frequency.value = note.freq;
  osc.frequency.setValueAtTime(note.freq, start);
  osc.connect(gain);
  // Short attack and release rather than a hard gate — a square wave switched
  // on at full gain clicks, and a click on every repeat of an alarm that runs
  // until it is acknowledged gets tiring fast.
  const attack = Math.min(0.02, note.dur / 4);
  const release = Math.min(0.03, note.dur / 4);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.setValueAtTime(peak, Math.max(start + attack, end - release));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.start(start);
  osc.stop(end + 0.02);
}

export function scheduleTone(ctx, notes, type, gainPeak, force) {
  // Scaled by this device's chosen loudness — unless this is a call being
  // assigned to this crew, which is not a preference. See UNMISSABLE below.
  //
  // The peaks were set for a quiet control room and were far too polite for the
  // cab of a moving ambulance. They are roughly two and a half times what they
  // were, and capped: past about 0.7 a square wave clips, and a clipped tone is
  // heard as quieter and nastier rather than louder.
  const peak = Math.min(0.7, (gainPeak || 0.16) * (force ? 1 : soundGain()));
  if (peak <= 0.0002) return;
  // A context that was suspended a moment ago can report a currentTime the
  // scheduler has already passed, and anything scheduled in the past is simply
  // dropped. A short lead is inaudible as a delay and keeps the first note.
  const t0 = ctx.currentTime + 0.03;
  notes.forEach((n) => scheduleNote(ctx, t0, n, type, peak));
}

// Which tone a call gets, and there are two of them.
//
// The urgency a crew hears has to match the level of care they are being sent
// for. The department's decision is that ALS and CCT are the same answer —
// both are somebody getting up and moving now — so both get the wail that has
// to cut through a room, and BLS keeps the chime that says this can be walked
// to. A crew was being asked to tell two urgent tones apart in the second
// after waking up, which is not a distinction anybody acts on differently.
//
// This is deliberate and it is NOT the old bug where every priority collapsed
// onto one fallback tone. BLS still sounds different, and that is the
// difference that changes what a crew does. Change this and change
// `alarmWav(priority:)` in the iOS plugin with it, note for note.
//
// Written against both vocabularies, so a board that still holds the old words
// sounds the same as one that does not.
export function toneKeyFor(priority) {
  if (priority === "cct" || priority === "critical") return "critical";
  if (priority === "als" || priority === "urgent") return "critical";
  return "routine";
}

export function playAlertTone(ctx, priorityIn, force) {
  try {
    if (!ctx) return;
    const priority = toneKeyFor(priorityIn);
    if (priority === "critical") {
      // fast alternating wail - most urgent
      scheduleTone(ctx, [
        { freq: 950, start: 0, dur: 0.15 },
        { freq: 650, start: 0.15, dur: 0.15 },
        { freq: 950, start: 0.3, dur: 0.15 },
        { freq: 650, start: 0.45, dur: 0.15 },
        { freq: 950, start: 0.6, dur: 0.15 },
        { freq: 650, start: 0.75, dur: 0.15 },
      ], "square", 0.55, force);
    } else {
      // gentle two-note chime — anything that isn't critical or urgent lands
      // here, so an unrecognised priority still makes a noise
      scheduleTone(ctx, [
        { freq: 784, start: 0, dur: 0.3 },
        { freq: 1046, start: 0.32, dur: 0.35 },
      ], "sine", 0.38, force);
    }
  } catch (e) {
    // audio not available; ignore
  }
}

// A booking coming due in a quarter of an hour is a reminder, not an emergency,
// and it plays on the dispatch desk of a control room where the same speakers
// carry the call alarm. So it gets a sound of its own that can never be
// mistaken for one: two soft sine notes a fifth apart, faded in over a tenth of
// a second and left to ring out, at roughly a third of the loudness of a
// routine call tone. Audible across a quiet room, ignorable mid-sentence.
export function softTone(ctx, freq, startOffset, dur, peak, force) {
  // `force` means the same thing here as it does for a dispatch tone: this is
  // not a preference. A message the desk has to answer is worth hearing over a
  // volume chip somebody nudged down three hours ago.
  const level = Math.min(0.7, peak * (force ? 1 : soundGain()));
  if (level <= 0.0002) return;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  osc.connect(gain);
  const t0 = ctx.currentTime + startOffset;
  const end = t0 + dur;
  // A slow attack is what keeps it from reading as an alarm: no click, no edge.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(level, t0 + 0.12);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.start(t0);
  osc.stop(end + 0.02);
}

// "The call is cancelled", said out loud, twice.
//
// The stand-down used to borrow the critical dispatch tone, which is the worst
// possible choice: it is the sound that means GO, played at the moment a crew
// must stop. A crew hearing it through a windscreen with the tablet face-down
// speeds up.
//
// So it speaks. Speech is unambiguous where a pattern of beeps is learned, and
// it is the one thing that cannot be confused with any other sound this app
// makes. Twice, because the first one lands while somebody is still reacting
// to the fact that a noise happened at all.
//
// A descending two-note figure goes in front of it — falling where every
// dispatch tone rises — so the meaning is already on its way before the words
// arrive, and so there is still something to hear on a device with no voice.
export function speakStandDown() {
  try {
    if (typeof window === "undefined" || !window.speechSynthesis) return false;
    const say = (delay) =>
      setTimeout(() => {
        try {
          const u = new SpeechSynthesisUtterance("The call is cancelled");
          u.rate = 0.95;
          u.pitch = 1;
          u.volume = 1;
          window.speechSynthesis.speak(u);
        } catch (e) {}
      }, delay);
    window.speechSynthesis.cancel();
    say(220);
    say(2000);
    return true;
  } catch (e) {
    return false;
  }
}

// Falling, where a dispatch rises. Plays whether or not the voice is available.
export function playStandDownTone(ctx) {
  try {
    if (!ctx) return;
    scheduleTone(
      ctx,
      [
        { freq: 620, start: 0, dur: 0.28 },
        { freq: 420, start: 0.3, dur: 0.42 },
      ],
      "triangle",
      0.2,
      true
    );
  } catch (e) {}
}

// The tone on its own, for the repeat.
//
// Keep this separate from the words. `speakStandDown` starts by cancelling
// whatever the voice is currently saying - it has to, or a second stand-down
// would queue behind the first and arrive late. That is correct when it is
// called once and wrong when it is called on a loop: the repeat cancelled the
// sentence mid-word every 450 milliseconds, so the crew heard "The call is
// cancelled. The call is cancelled." and then "the call - the call - the call"
// for as long as the banner was up. The words are said once, at the start,
// twice over as they always were; only the tone repeats.
// The stand-down goes out the same way the alarm did.
//
// It used to be page audio and nothing else, and that is the one context least
// likely to work at the moment it is needed: an alarm has just been playing
// over it on the system alarm path, the app has probably been in the
// background, and on both platforms that leaves the page's AudioContext
// interrupted or suspended. So a crew who had been sent somewhere were never
// told the call was off — they were still driving to a patient nobody needed
// moved, which is worse than a missed alert, not better.
//
// The plugin's stand-down is one shot; the repeat is still this layer's, so
// nothing sounds for ever. Anything without the plugin, or a plugin too old to
// have the method, falls through to the page tone exactly as before.
export function soundStandDownTone(audioCtxRef) {
  const webTone = (why) => {
    lastStandDownOutcome = why;
    playWhenAwake(audioCtxRef, (ctx) => playStandDownTone(ctx));
  };
  try {
    const plugin = nativeAlarm();
    if (plugin && typeof plugin.standDown === "function") {
      const answered = plugin.standDown();
      lastStandDownOutcome = "system alarm";
      if (answered && typeof answered.then === "function") {
        // A rejection is a promise, not a throw — a try/catch alone never sees
        // it, which is how the alarm path once failed silently.
        answered.then(
          () => {
            lastStandDownOutcome = "system alarm";
          },
          (err) =>
            webTone(`page audio (shell refused: ${(err && err.message) || "no reason given"})`)
        );
      }
      return;
    }
  } catch (e) {
    // no shell, or a shell older than this call
  }
  webTone("page audio — this app was built before the stand-down existed, rebuild it");
}

export function soundStandDown(audioCtxRef) {
  soundStandDownTone(audioCtxRef);
  speakStandDown();
}

export function playSoftReminderTone(ctx, force) {
  try {
    if (!ctx) return;
    // Two notes, not an alarm — but audible in a room with a radio in it. The
    // old peaks were set for a quiet office and were inaudible on a desk
    // tablet at arm's length.
    softTone(ctx, 587.33, 0, 0.75, force ? 0.3 : 0.05, force); // D5
    softTone(ctx, 880.0, 0.28, 0.95, force ? 0.28 : 0.045, force); // A5
  } catch (e) {
    // audio not available; ignore
  }
}

// Every path that makes a noise needs the same three things first: a context,
// that context awake, and the notes scheduled only once it is. A browser
// suspends audio whenever the tab goes to the background, and a tab that has
// never been touched has no context at all — so this is done at the moment of
// playing, on every repeat, rather than once at sign-in. Without it the first
// alarm of a shift on a restored session can be silent.
export function ensureAudioCtx(audioCtxRef) {
  if (!audioCtxRef) return null;
  try {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      // "playback", not the default.
      //
      // A context created without a category is treated as ambient audio, and
      // ambient audio is exactly what the silent switch exists to stop. A
      // dispatch alert is not ambient — it is the reason the tablet is in the
      // vehicle — so it is declared as playback and rides through the switch.
      audioCtxRef.current = new Ctx({ latencyHint: "interactive" });
      try {
        if (audioCtxRef.current.setSinkId) {
          // Leave the sink alone; naming it can silence the context on some
          // builds. Category is what matters here.
        }
        if (typeof navigator !== "undefined" && navigator.audioSession) {
          navigator.audioSession.type = "playback";
        }
      } catch (e) {}
    }
  } catch (e) {
    return null;
  }
  return audioCtxRef.current;
}

// Resume, then play. resume() is a promise, and notes written into a clock that
// was still frozen when they were laid down get dropped — which is how a call
// arriving on a backgrounded tab used to lose its first alert entirely.
// Play, and if the context is dead, build a new one and play on that.
//
// "Suspended" is not the only way a context stops working, and on the native
// shells it is not even the common one. When anything else in the app activates
// an audio session - which is exactly what going on duty now does, to keep iOS
// from suspending the app - WebKit puts the page's AudioContext into
// "interrupted", and an interrupted context never comes back on its own.
// resume() on it resolves without making it runnable. The symptom is a tablet
// where nothing web-made will play at all: no reminder, no reply chime, and no
// speaker check - a crew pressing the check button and hearing silence on a
// phone that is not even muted.
//
// So anything that is not running is resumed, and anything still not running
// after that is thrown away and replaced. A context is cheap; a silent tablet
// is not.
export function playWhenAwake(audioCtxRef, play) {
  const ref =
    audioCtxRef && typeof audioCtxRef === "object" && "current" in audioCtxRef ? audioCtxRef : null;
  const ctx = ref ? ensureAudioCtx(ref) : audioCtxRef;
  if (!ctx) return;

  const attempt = (c) => {
    try {
      play(c);
    } catch (e) {
      // one bad tone must not take the next one with it
    }
  };

  // Only ever called after a resume has failed to produce a running context,
  // and it never calls back into playWhenAwake, so there is no loop here.
  //
  // The one retry matters, and this is where it earns itself: a stand-down is
  // sounded in the same instant the alarm is stopped, and stopping the alarm
  // tears down the shell's audio session. WebKit answers that by interrupting
  // the page's context, and a context built while the session is still settling
  // comes up interrupted too - so the notes are scheduled onto something that
  // is not running and are dropped without a sound. A few hundred milliseconds
  // later it works. Rather than lose the one tone that tells a crew the call is
  // off, this gives it a second go once the session has settled.
  const rebuild = (retries) => {
    if (!ref) return;
    try {
      if (ref.current && ref.current.state !== "closed") ref.current.close();
    } catch (e) {
      // already gone
    }
    ref.current = null;
    const fresh = ensureAudioCtx(ref);
    if (!fresh) return;
    const playOrRetry = () => {
      if (fresh.state === "running") {
        attempt(fresh);
        return;
      }
      // Not runnable yet. One more attempt, far enough out that the session
      // has settled and near enough that the tone is still the answer to what
      // just happened.
      if (retries > 0) setTimeout(() => rebuild(retries - 1), 400);
    };
    if (fresh.state === "running") {
      attempt(fresh);
      return;
    }
    try {
      const again = fresh.resume && fresh.resume();
      if (again && typeof again.then === "function") {
        again.then(playOrRetry).catch(playOrRetry);
        return;
      }
    } catch (e) {
      playOrRetry();
      return;
    }
    playOrRetry();
  };

  try {
    if (ctx.state === "running") {
      attempt(ctx);
      return;
    }
    // "Interrupted" never resumes, and the rebuild must happen NOW —
    // synchronously, inside whatever tap brought us here. Going through
    // resume()'s promise first cost the user gesture on WebKit, and a context
    // built outside a gesture starts suspended with nothing entitled to
    // resume it — which is how the speaker check stayed dead until the app
    // was relaunched, on a phone that was not even muted.
    if (ref && ctx.state === "interrupted") {
      rebuild(2);
      return;
    }
    const resumed = ctx.resume && ctx.resume();
    if (resumed && typeof resumed.then === "function") {
      resumed
        .then(() => {
          if (ctx.state === "running") attempt(ctx);
          else rebuild(2);
        })
        .catch(() => rebuild(2));
      return;
    }
    if (ctx.state === "running") attempt(ctx);
    else rebuild(2);
  } catch (e) {
    rebuild(2);
  }
}

// The one entry point for a call alert: critical, urgent and routine all come
// through here, so all three get the same guarantees about being heard — and
// the one place a silenced device turns back, so all three are silenced
// together and nothing has to remember to check twice.
//
// UNMISSABLE. A call landing on this crew's own truck is the exception to
// every volume setting on this screen. The loudness control exists so a tablet
// in a quiet ward does not chirp through every booking reminder and button
// press — it was never meant to be able to silence a dispatch. A crew who
// turned the board down at two in the morning and then missed the call they
// were sent on is the failure this whole alarm exists to prevent, so an
// assignment plays at full gain whatever the chip says, and it plays even when
// the chip says SILENT.
//
// Everything else on the board still respects the setting. Reminders, replies
// and confirmation sounds are things you may legitimately not want to hear.
// ---------- the native alarm channel ----------
//
// What the web layer cannot do, at all, on any browser: override the hardware
// silent switch, the OS volume slider, or Do Not Disturb. An AudioContext
// declared as "playback" gets through more than an ambient one does, and that
// is the whole of what a page is allowed. A phone on silent can still miss a
// dispatch.
//
// Beating that needs the operating system's alarm path, which only native code
// can ask for: on Android a notification channel built with USAGE_ALARM, so
// the tone plays on the alarm stream that wakes people up; on iOS an
// AVAudioSession set to .playback with .duckOthers.
//
// The native shell installs a Capacitor plugin under this name. When it is
// there, a dispatch goes through it. When it is not - the web build, or a
// shell that has not been rebuilt yet - everything falls back to the Web Audio
// path below and behaves exactly as it did before. See native/README.md.
export function nativeAlarm() {
  try {
    const cap = typeof window !== "undefined" && window.Capacitor;
    const plugin = cap && cap.Plugins && cap.Plugins.PulseOpsAlarm;
    return plugin && typeof plugin.alert === "function" ? plugin : null;
  } catch (e) {
    return null;
  }
}

// Whether the SHELL on this device is as new as the web layer running inside
// it, and what is missing if it is not.
//
// The two halves ship separately: index.html is copied into the project, the
// plugin is rebuilt in Xcode or Android Studio, and it is easy to do one and
// not the other. When that happens everything looks right - the build stamp is
// today's, the plugin says "loaded" - and a method the web layer depends on
// simply is not there. A whole round of testing went into a stand-down that
// could never have worked, because the app carrying it had been built before
// the method existed.
//
// So the methods this build needs are named here and checked. Missing one is
// not a fault in the phone or the settings; it means the app needs rebuilding,
// and the crew line says so in those words.
export const SHELL_METHODS = ["alert", "stop", "standDown", "notify", "requestNotifications", "backgroundStatus"];

// The plugin build this web layer expects, checked against the one the plugin
// reports about ITSELF.
//
// Checking the method list is not enough and never was on Android: every
// method this build needs already existed in the previous plugin, so a phone
// carrying a fortnight-old plugin answered every name it was asked for and
// said "shell up to date" — while the fix that had been shipped into that file
// was simply not on the device. A method list says what a plugin can do; only
// a version says which one it is. Bump this and the constant in BOTH plugins
// together.
export const SHELL_BUILD_WANTED = { android: "2026-09-04.1", ios: "2026-09-03.5" };

// What to say about the plugin's own build, given whatever backgroundStatus
// last answered. Empty when there is nothing to complain about — the line is
// long enough without a badge saying everything is fine.
// What the volume floor did, ALWAYS said — not only when it failed.
//
// It used to print only on a refusal, so after a call the line went silent
// and there was nothing on the screen saying what had happened while the tone
// was playing. "Not attempted yet" disappearing is not an answer. And a
// reading taken after the call is the volume NOW; the whole question is what
// the stream did DURING it, which is why the plugin keeps the low-water mark
// and the number of corrections and they are printed here.
export function volumeFloorNote(bg) {
  if (!bg || typeof bg !== "object") return "";
  if (bg.platform === "ios") return " · no floor on iPhone";
  const what = bg.volumeFloor ? String(bg.volumeFloor) : "";
  if (!what) return "";
  const min = typeof bg.floorMinPct === "number" ? bg.floorMinPct : 70;
  const low = typeof bg.alarmVolumeMinPct === "number" && bg.alarmVolumeMinPct >= 0
    ? `, dipped to ${bg.alarmVolumeMinPct}%`
    : "";
  const puts = typeof bg.floorRaises === "number" && bg.floorRaises > 0
    ? `, put back ${bg.floorRaises}×`
    : "";
  // How many times the watch actually looked.
  //
  // Without this, "the stream never dipped" and "nothing was watching when it
  // dipped" read identically — and the second one is what a floor that has
  // quietly died looks like from the outside. A long alert reporting one look
  // is a dead watch, and the line says so in those words rather than leaving
  // it to be worked out from a number.
  const ticks = typeof bg.floorTicks === "number" ? bg.floorTicks : null;
  const watch = ticks === null
    ? ""
    : ticks <= 1
      ? `, WATCHED ${ticks}× — the floor was not being held`
      : `, held ${ticks}×`;
  return ` · FLOOR ≥${min}% ${what}${low}${puts}${watch}`;
}

// The two plugins are asked for SEPARATELY, because they change separately.
//
// One number for both meant an Android-only fix — the volume floor, which iOS
// cannot have at all — told every iPhone it was out of date and demanded an
// Xcode rebuild that would have changed nothing but a constant. A version is
// there to tell somebody what to do; one that cries wolf on the platform it
// did not touch teaches them to ignore it.
export function shellBuildWanted(platform) {
  const p = String(platform || "").toLowerCase();
  if (p === "ios") return SHELL_BUILD_WANTED.ios;
  return SHELL_BUILD_WANTED.android;
}

export function shellBuildNote(bg) {
  if (!bg || typeof bg !== "object") return "";
  const wanted = shellBuildWanted(bg.platform);
  const has = bg.pluginBuild ? String(bg.pluginBuild) : "";
  // A plugin too old to carry the stamp at all is, by definition, older than
  // the build that introduced it.
  if (!has) return ` · PLUGIN IS OLD — rebuild the app (it is older than ${wanted})`;
  if (has === wanted) return "";
  return ` · PLUGIN IS ${has}, THIS BUILD NEEDS ${wanted} — rebuild the app`;
}

export function shellReport() {
  const plugin = nativeAlarm();
  if (!plugin) return "no shell (browser)";
  const missing = SHELL_METHODS.filter((m) => typeof plugin[m] !== "function");
  if (!missing.length) return "shell up to date";
  return `SHELL IS OLD — rebuild the app (missing ${missing.join(", ")})`;
}

// Called where the alert is taken down, so a tone playing on the alarm stream
// stops with the banner rather than outliving it.
export function stopNativeAlarm() {
  try {
    const plugin = nativeAlarm();
    if (plugin && typeof plugin.stop === "function") plugin.stop();
  } catch (e) {
    // the shell is not there, or is older than this call
  }
}

// Keeping the shell awake while somebody is on duty.
//
// This is the whole answer to "the tone does not work in the background", and
// it is worth being exact about why. When iOS suspends an app, its JavaScript
// stops: the three-second poll stops, the call never arrives, and there is
// nothing to play a tone about. The alarm plugin cannot help, because nothing
// is running to call it.
//
// An app that is playing audio is not suspended. So while a crew is signed on,
// the shell holds an audio session open with silence playing through it - no
// sound, no ducking, just enough for the operating system to keep the process
// alive. The poll keeps running, a call still arrives, and the alarm plays at
// full volume on the alarm path.
//
// It is switched off at sign-out, because a phone that nobody is on duty with
// has no reason to be kept awake.
export function setNativeStandby(on) {
  try {
    const plugin = nativeAlarm();
    if (!plugin || typeof plugin.standby !== "function") return;
    const answered = plugin.standby({ on: !!on });
    // An older shell that does not have this method rejects rather than
    // throwing; the app carries on exactly as it did before it existed.
    if (answered && typeof answered.catch === "function") answered.catch(() => {});
  } catch (e) {
    // no shell, or a shell older than this call
  }
}

// Keep the screen on while somebody is signed on — the Android half of
// standby, and the answer to "the alert was late".
//
// iOS suspends an app that is not playing audio; Android does something
// quieter and worse. It throttles a backgrounded WebView's timers to about one
// a second, then to one a minute, and after a few minutes freezes the page
// outright. The board is read by a three-second timer inside that page, so a
// throttled tablet learns about a call up to a minute late and a frozen one
// never learns at all — and Doze and each manufacturer's own battery saver
// decide which of those happens, which is why the same dispatch reaches one
// tablet instantly, the next a minute later, and the third not at all.
//
// A screen that stays on is a page that is never backgrounded. Two routes,
// because neither covers every device: the shell's window flag, and the
// browser's own Screen Wake Lock for a tablet running this in a browser.
// Neither needs a permission or anything declared to Google.
//
// It does NOT survive Home being pressed or the tablet being locked. Nothing a
// web layer can do does — see native/README.md.
let screenLock = null;

export function setScreenAwake(on) {
  try {
    const plugin = nativeAlarm();
    if (plugin && typeof plugin.keepAwake === "function") {
      const answered = plugin.keepAwake({ on: !!on });
      if (answered && typeof answered.catch === "function") answered.catch(() => {});
    }
  } catch (e) {
    // no shell, or a shell older than this call
  }
  try {
    const wl = typeof navigator !== "undefined" && navigator.wakeLock;
    if (!wl || typeof wl.request !== "function") return;
    if (on) {
      if (screenLock) return;
      const got = wl.request("screen");
      if (got && typeof got.then === "function") {
        got.then((lock) => {
          screenLock = lock;
          // The browser drops the lock whenever the page is hidden, and does
          // not give it back by itself. Forgetting the handle here is what
          // lets the effect below take it again on the next wake.
          try {
            lock.addEventListener("release", () => {
              if (screenLock === lock) screenLock = null;
            });
          } catch (e) {
            /* older shape, nothing to listen on */
          }
        }, () => {});
      }
      return;
    }
    const held = screenLock;
    screenLock = null;
    if (held && typeof held.release === "function") {
      const done = held.release();
      if (done && typeof done.catch === "function") done.catch(() => {});
    }
  } catch (e) {
    // no wake lock on this device
  }
}

export function screenAwakeHeld() {
  return !!screenLock;
}

// Everything about this phone that decides whether a call will be heard, read
// from the shell.
//
// None of it is visible from inside a web page, and every one of them has
// silenced a real alert: notifications turned off for the app, the alarm
// channel silenced by its owner in a way Android will not let the app undo, the
// alarm stream sitting at zero, battery optimisation freezing the app in the
// background. A crew cannot read a log, so these come back as a sentence for
// the screen.
export function nativeBackgroundStatus() {
  try {
    const plugin = nativeAlarm();
    if (!plugin || typeof plugin.backgroundStatus !== "function") return null;
    const answered = plugin.backgroundStatus();
    if (answered && typeof answered.then === "function") {
      return answered.catch(() => null);
    }
    return Promise.resolve(answered);
  } catch (e) {
    return null;
  }
}

// Two taps to the screen that fixes it. "which" is "notifications", "channel"
// or "battery".
export function openNativeSettings(which) {
  try {
    const plugin = nativeAlarm();
    if (!plugin || typeof plugin.openSettings !== "function") return false;
    const answered = plugin.openSettings({ which: String(which || "notifications") });
    if (answered && typeof answered.catch === "function") answered.catch(() => {});
    return true;
  } catch (e) {
    return false;
  }
}

// What the last dispatch alarm actually did, for the diagnostics line.
//
// A plugin that is not registered and a plugin that refuses look identical from
// the crew's side - silence - and both were happening. Recording the outcome
// turns "no tone" into a sentence somebody can read off the screen and send on.
let lastAlarmOutcome = "none yet";
export function alarmOutcome() {
  return lastAlarmOutcome;
}

// How loud the phone actually was when it played, in the same line as which
// tone it played.
//
// Reported because a thumb on the volume buttons during an alert is a real
// thing crews do, and the two platforms answer it differently: Android raises
// the alarm stream to a floor and can be REFUSED (Do Not Disturb, a
// manufacturer's focus mode) without any error at all, and iOS cannot raise
// anything, because `outputVolume` is read-only and Apple offers no API that
// sets the system volume. Either way the number belongs on the screen: "the
// alert went quiet by itself" and "the alert is playing at 10% because that is
// where the slider is" look identical from a truck.
export function alarmLoudnessNote(r) {
  if (!r || typeof r !== "object") return "";
  // Whether the phone is buzzing as well as sounding. iOS has no Vibration API
  // in a WKWebView at all, so `navigator.vibrate` is a no-op there and the
  // buzz can only come from the shell — which makes "did it buzz?" a question
  // the screen has to answer rather than the crew guess at.
  const buzz = r.vibrating === true ? " · buzzing" : r.vibrating === false ? " · NO BUZZ" : "";
  const pct = r.outputVolumePct != null ? r.outputVolumePct : r.alarmVolumePct;
  if (pct == null) return buzz;
  if (r.platform === "ios") return ` · device volume ${pct}% (iPhone: no floor, the slider decides)${buzz}`;
  if (r.volumeFloorOk === false) return ` · alarm stream ${pct}% · FLOOR ${r.volumeFloor || "refused"}${buzz}`;
  return ` · alarm stream ${pct}%${buzz}`;
}

// What the last stand-down did, on the same principle as the alarm above.
//
// Two rounds of guessing went into "the cancellation tone comes late" without
// anybody being able to see whether the plugin had played it, refused it, or
// never been asked. A crew cannot read a console and neither can a supervisor
// on a phone.
let lastStandDownOutcome = "none yet";
export function standDownOutcome() {
  return lastStandDownOutcome;
}

// The speaker check answers ONE question: will this device be heard when a
// call lands on it? On a shell a dispatch goes out through the plugin on the
// alarm stream, so that is the path the check has to prove. It used to test
// the page-audio path instead — a path a dispatch on a shell never takes, and
// the one WebKit interrupts every time the native alarm plays — so the check
// went silent after every real call, on a device whose actual alarm was
// perfectly healthy, and read as a broken speaker until the app was
// relaunched. The tone is stopped after a couple of seconds because this is a
// check, not an alert; if it ever collides with a real alarm, the alarm's own
// 1.7-second repeat restarts the player the moment it finds it stopped.
// Returns what the shell said about the check — the tone it used, where it
// came from, how loud the phone is — so a caller can put the answer on the
// screen. A check whose result nobody sees is not a check. Resolves to null on
// the page-audio path, which cannot report anything about itself.
export function soundSpeakerCheck(audioCtxRef, priority) {
  const plugin = nativeAlarm();
  if (plugin && typeof plugin.stop === "function") {
    try {
      const answered = plugin.alert({ priority: String(priority || "routine") });
      lastAlarmOutcome = "system alarm (check)";
      const stopSoon = () => {
        setTimeout(() => {
          try {
            plugin.stop();
          } catch (e) {
            // an alarm mid-flight owns the player; its repeat carries on
          }
        }, 2200);
      };
      if (answered && typeof answered.then === "function") {
        const out = answered.then(
          (r) => {
            const tone = r && r.tone ? String(r.tone).toUpperCase() : "?";
            lastAlarmOutcome = `system alarm · ${tone} · ${(r && r.source) || "shell"} (check)${alarmLoudnessNote(r)}`;
            return r || { ok: true };
          },
          () => {
            lastAlarmOutcome = "system alarm refused — page tone used for the check";
            soundCallAlert(audioCtxRef, priority);
            return { ok: false };
          }
        );
        stopSoon();
        return out;
      }
      stopSoon();
      return Promise.resolve(null);
    } catch (e) {
      // an old shell without the method — the page tone is still an answer
    }
  }
  soundCallAlert(audioCtxRef, priority);
  return Promise.resolve(null);
}

export function soundCallAlert(audioCtxRef, priority, unmissable) {
  if (!unmissable && soundSilenced()) return;
  const webTone = () =>
    playWhenAwake(audioCtxRef, (ctx) => playAlertTone(ctx, priority, !!unmissable));
  // A dispatch on the native shell goes out on the alarm stream, which is the
  // only thing that gets past a muted phone. Everything else, and every device
  // without the shell, uses the Web Audio path.
  if (unmissable) {
    const plugin = nativeAlarm();
    if (plugin) {
      // The plugin can be installed and still fail — the commonest way being a
      // shell built without dispatch_alert.mp3 in the bundle, which both
      // platforms answer by rejecting the call. That rejection is a promise,
      // not a throw, so a try/catch never saw it: the alarm went to the plugin,
      // the plugin refused, and the tablet sat there in silence with nothing
      // falling back. Now anything but success drops through to the Web Audio
      // tone, which is beatable by a mute switch but is not nothing.
      let handed = false;
      try {
        const answered = plugin.alert({ priority: String(priority || "routine") });
        handed = true;
        lastAlarmOutcome = "system alarm";
        if (answered && typeof answered.then === "function") {
          answered.then(
            (r) => {
              // Which of the two tones the shell picked, and where it got it
              // from. "The ALS tone is wrong in the app" is a sentence somebody
              // can now read off the screen and send on, instead of a thing
              // three people guess at.
              const tone = r && r.tone ? String(r.tone).toUpperCase() : "?";
              const from = r && r.source ? r.source : "shell";
              lastAlarmOutcome = `system alarm · ${tone} · ${from}${alarmLoudnessNote(r)}`;
            },
            (err) => {
              lastAlarmOutcome = `system alarm refused (${(err && err.message) || "no reason given"})`;
              webTone();
            }
          );
        }
      } catch (e) {
        handed = false;
        lastAlarmOutcome = `system alarm threw (${(e && e.message) || "no reason given"})`;
      }
      if (handed) return;
    }
  }
  if (unmissable && !nativeAlarm()) lastAlarmOutcome = "page audio (no plugin on this device)";
  webTone();
}

export function soundReminderTone(audioCtxRef, force) {
  if (!force && soundSilenced()) return;
  playWhenAwake(audioCtxRef, (ctx) => playSoftReminderTone(ctx, force));
}