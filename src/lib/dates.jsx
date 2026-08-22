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

// Each call priority gets a distinct, recognizable alert tone.
// Which tone a call gets.
//
// The urgency a crew hears has to match the level of care they are being sent
// for: a critical care transfer is the one that must cut through a room, an ALS
// run is the two-beep call to move, and everything else is the routine chime.
// Written against both vocabularies, so a board that still holds the old words
// sounds the same as one that does not.
export function toneKeyFor(priority) {
  if (priority === "cct" || priority === "critical") return "critical";
  if (priority === "als" || priority === "urgent") return "urgent";
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
    } else if (priority === "urgent") {
      // two rising beeps, with a gap so they read as two
      scheduleTone(ctx, [
        { freq: 700, start: 0, dur: 0.34 },
        { freq: 1000, start: 0.42, dur: 0.34 },
      ], "square", 0.48, force);
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
export function soundStandDownTone(audioCtxRef) {
  playWhenAwake(ensureAudioCtx(audioCtxRef), (ctx) => playStandDownTone(ctx));
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
export function playWhenAwake(ctx, play) {
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") {
      const resumed = ctx.resume();
      if (resumed && typeof resumed.then === "function") {
        resumed.then(() => play(ctx)).catch(() => {});
        return;
      }
    }
    play(ctx);
  } catch (e) {
    // audio not available; ignore
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

export function soundCallAlert(audioCtxRef, priority, unmissable) {
  if (!unmissable && soundSilenced()) return;
  const webTone = () =>
    playWhenAwake(ensureAudioCtx(audioCtxRef), (ctx) => playAlertTone(ctx, priority, !!unmissable));
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
        if (answered && typeof answered.catch === "function") answered.catch(() => webTone());
      } catch (e) {
        handed = false;
      }
      if (handed) return;
    }
  }
  webTone();
}

export function soundReminderTone(audioCtxRef, force) {
  if (!force && soundSilenced()) return;
  playWhenAwake(ensureAudioCtx(audioCtxRef), (ctx) => playSoftReminderTone(ctx, force));
}