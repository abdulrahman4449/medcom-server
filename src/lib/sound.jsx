import { useEffect, useState } from "./react.jsx";

// ---------- how loud this device is allowed to be ----------
//
// Web Audio does not answer to the device's silent switch. A tablet with the
// ringer off, a phone on vibrate, a laptop whose volume keys have been held
// down — none of them stop an AudioContext, so the board was the one thing in
// the room that could not be quietened, and the only way to stop it making a
// noise was to close it. On a crew tablet waiting for a call that is the whole
// point. On the fourth screen in a control room where two others are already
// alerting, on a supervisor's phone, or on a desk that is being used to write
// up yesterday's log, it is noise nobody asked for.
//
// So loudness is a property of this device, kept next to the session in
// localStorage rather than on the board: two people signed in on two tablets
// have two different speakers and only one of them may need to be quiet. It is
// read at the moment each note is scheduled, so a change takes hold on the very
// next tone without a reload and without anything being re-armed.
//
// Silencing only ever silences the *tone*. The full-screen alarm, the vibration
// and the system notification are untouched — a call still arrives, it just
// arrives quietly — and every screen that can be silenced says so in plain
// sight while it is, because a board that is quiet by accident and a board that
// is quiet on purpose must never look the same.
export const SOUND_KEY = "ems:sound";

export const SOUND_LEVELS = [
  { key: "full", label: "FULL", short: "FULL", gain: 1, note: "as loud as this board gets" },
  { key: "medium", label: "MEDIUM", short: "MED", gain: 0.55, note: "half volume" },
  { key: "low", label: "LOW", short: "LOW", gain: 0.25, note: "quiet — for a room that is already loud enough" },
  { key: "off", label: "SILENT", short: "MUTED", gain: 0, note: "no tone at all from this device" },
];

export const DEFAULT_SOUND_LEVEL = "full";

export function soundLevelMeta(key) {
  return SOUND_LEVELS.find((l) => l.key === key) || SOUND_LEVELS[0];
}

// Read once at load and then held here, because the tone scheduler is plain
// functions rather than components and has no props to read a setting from.
export let soundLevelKey = (function readSoundLevel() {
  try {
    const saved = window.localStorage.getItem(SOUND_KEY);
    if (saved && SOUND_LEVELS.some((l) => l.key === saved)) return saved;
  } catch (e) {
    // private browsing: the default stands for this session
  }
  return DEFAULT_SOUND_LEVEL;
})();

// Anything on screen that shows the current level subscribes, so switching it
// in the header updates the crew's silenced warning and the tone-check row in
// the same paint rather than on the next tick of the clock.
export const soundLevelListeners = new Set();

export function getSoundLevel() {
  return soundLevelKey;
}

export function soundGain() {
  return soundLevelMeta(soundLevelKey).gain;
}

export function soundSilenced() {
  return soundGain() <= 0;
}

export function setSoundLevel(key) {
  const meta = soundLevelMeta(key);
  soundLevelKey = meta.key;
  try {
    window.localStorage.setItem(SOUND_KEY, meta.key);
  } catch (e) {
    // the choice still holds for this session, it just won't survive a reload
  }
  soundLevelListeners.forEach((fn) => {
    try {
      fn(meta.key);
    } catch (e) {
      // a listener that has gone away must not stop the others hearing it
    }
  });
}

export function useSoundLevel() {
  const [level, setLevel] = useState(getSoundLevel);
  useEffect(() => {
    soundLevelListeners.add(setLevel);
    return () => {
      soundLevelListeners.delete(setLevel);
    };
  }, []);
  return level;
}