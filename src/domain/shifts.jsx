
// ---------- shifts ----------
//
// The service runs around the clock in two 12-hour shifts: day 07:00–19:00,
// night 19:00–07:00 (crossing midnight). Which shift someone is on can't be
// read off the wall clock alone — a crew that took a call at 18:40 is still
// the day shift at 19:30, and the night crew relieving them may sign on
// before 19:00 — so dispatch and every crew member pick their shift by hand
// when they sign in, and the board works from what they picked.
export const SHIFT_HOURS = 12;
export const SHIFT_MS = SHIFT_HOURS * 60 * 60 * 1000;

export const SHIFTS = {
  day: {
    key: "day", label: "DAY SHIFT", short: "DAY", glyph: "☀",
    startHour: 7, window: "07:00 – 19:00", color: "var(--hold)",
  },
  night: {
    key: "night", label: "NIGHT SHIFT", short: "NIGHT", glyph: "☾",
    startHour: 19, window: "19:00 – 07:00", color: "#818CF8",
  },
};
export const SHIFT_KEYS = ["day", "night"];

// What each kind of shift entry on the log sheet is called.
export const SHIFT_EVENTS = {
  on: { label: "SIGNED ON", color: "var(--ok)" },
  off: { label: "SIGNED OFF", color: "var(--ink-3)" },
  swap: { label: "SHIFT SWAP", color: "var(--flow)" },
  overtime: { label: "OVERTIME", color: "var(--crit)" },
};

// How long after a seat is vacated a fresh sign-on still counts as taking
// over from that person, rather than an unrelated shift days later.
export const HANDOVER_GRACE_MS = 6 * 60 * 60 * 1000;