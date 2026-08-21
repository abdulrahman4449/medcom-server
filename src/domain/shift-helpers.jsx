import { forceMidnight, shortDurationStr } from "./messages.jsx";
import { SHIFTS, SHIFT_MS } from "./shifts.jsx";
import { gregDateStr, gregFmt } from "../lib/dates.jsx";

// ---------- shift helpers ----------

export function hhmm(ts) {
  if (!ts) return "—";
  return forceMidnight(gregFmt(ts, { hour: "2-digit", minute: "2-digit", hour12: false }));
}

export function seatLabel(slot) {
  return slot === "alpha" ? "Alpha" : slot === "bravo" ? "Bravo" : "";
}

export function shiftMeta(shiftKey) {
  return SHIFTS[shiftKey] || null;
}

// What the wall clock says the shift is right now. Used to pre-select the
// likely answer at sign-in and to label the board — never to override what
// someone actually told us they're working.
export function scheduledShiftKey(ts) {
  const h = new Date(ts).getHours();
  return h >= SHIFTS.day.startHour && h < SHIFTS.night.startHour ? "day" : "night";
}

// The 12-hour window of `shiftKey` nearest to `ts`: the one containing it if
// there is one, otherwise whichever edge is closest. So a night crew signing
// on at 08:00 is booked against the night that has just ended — which is what
// carrying a call past 07:00 looks like, and it reads as overtime straight
// away — while one signing on at 18:00 is booked against the night ahead.
export function shiftWindowFor(shiftKey, ts) {
  const shift = shiftMeta(shiftKey) || SHIFTS.day;
  const windows = [-1, 0, 1].map((dayOffset) => {
    const start = new Date(ts);
    start.setDate(start.getDate() + dayOffset);
    start.setHours(shift.startHour, 0, 0, 0);
    return { start: start.getTime(), end: start.getTime() + SHIFT_MS };
  });
  const distance = (w) =>
    ts >= w.start && ts < w.end ? 0 : Math.min(Math.abs(ts - w.start), Math.abs(ts - w.end));
  return windows.reduce((best, w) => (distance(w) < distance(best) ? w : best));
}

// The shift record stamped on a session, and on the crew seat that session
// holds, so every device reading the board sees the same shift for that person.
export function shiftAssignment(shiftKey, ts) {
  const w = shiftWindowFor(shiftKey, ts);
  return { shift: shiftKey, shiftStart: w.start, shiftEnd: w.end, signedOnAt: ts };
}

export function shiftWindowStr(a) {
  if (!a || !a.shiftStart) return "";
  return `${hhmm(a.shiftStart)} – ${hhmm(a.shiftEnd)}`;
}

// "DAY SHIFT (07:00 – 19:00)" — the phrase every shift log line is built from.
export function shiftPhrase(a) {
  const meta = shiftMeta(a && a.shift);
  if (!meta) return "an unrecorded shift";
  return `${meta.label} (${shiftWindowStr(a) || meta.window})`;
}

// The same phrase from a shift key alone. Every Shift column in the export
// carries it rather than the bare word, so the two 12-hour windows the service
// actually runs — 07:00–19:00 and 19:00–07:00 — are written on the sheet
// instead of being something the reader has to already know.
export function shiftLabelWithWindow(shiftKey) {
  const meta = shiftMeta(shiftKey);
  return meta ? `${meta.label} (${meta.window})` : "";
}

// The 12-hour window a moment falls in by the wall clock, whatever anyone
// signed on for. The night shift crosses midnight, so a call stamped at 02:00
// belongs to the window that opened at 19:00 the evening before — the returned
// window starts on the previous day, which is what makes the export sort into
// shifts rather than into calendar days.
export function shiftWindowAt(ts) {
  const key = scheduledShiftKey(ts);
  const start = new Date(ts);
  if (key === "night" && start.getHours() < SHIFTS.night.startHour) {
    start.setDate(start.getDate() - 1);
  }
  start.setHours(SHIFTS[key].startHour, 0, 0, 0);
  return { key, meta: SHIFTS[key], start: start.getTime(), end: start.getTime() + SHIFT_MS };
}

// The stretch of time one crew member's own shift covers, for scoping what
// they are shown to the work they were actually there for. It is built from
// the 12-hour window they signed on for — not the window the wall clock says,
// which can be a different one for a night crew who came in at 18:30 — and it
// is stretched at both ends to the real edges of their tour: back to the
// moment they actually signed on, and forward to now while they are still
// working. Relief here is loose on purpose, so a crew who came in early or a
// call that closes on overtime both land on the shift they were worked on
// rather than falling into a gap between two windows.
//
// `windowStr` stays the nominal 07:00 – 19:00 (or 19:00 – 07:00) so what is
// written on the screen is still the shift as the roster names it.
//
// A session saved before shifts were recorded falls back to the scheduled
// window around now, which is the best guess available for it.
export function crewShiftWindow(person, now) {
  const fallback = shiftWindowAt(now);
  const nominalStart = person && person.shiftStart ? person.shiftStart : fallback.start;
  const nominalEnd = person && person.shiftEnd ? person.shiftEnd : fallback.end;
  const signedOnAt = person && person.signedOnAt ? person.signedOnAt : nominalStart;
  return {
    start: Math.min(nominalStart, signedOnAt),
    end: Math.max(nominalEnd, now),
    windowStr: `${hhmm(nominalStart)} – ${hhmm(nominalEnd)}`,
    meta: shiftMeta(person && person.shift) || fallback.meta,
  };
}

// The date a shift is filed under: the day it started. A night shift that runs
// to 07:00 belongs to the evening it began, not the morning it ended.
export function shiftDateOf(windowStart) {
  return windowStart ? gregDateStr(windowStart) : "";
}

// Time worked past the end of the 12 hours that were signed on for. Overtime
// is routine here — a call running at 19:00 doesn't stop at 19:00 — so it is
// only ever measured, shown, and recorded. Nothing blocks on it.
export function overtimeMs(a, now) {
  if (!a || !a.shiftEnd) return 0;
  return Math.max(0, now - a.shiftEnd);
}

export function shiftRemainingMs(a, now) {
  if (!a || !a.shiftEnd) return 0;
  return Math.max(0, a.shiftEnd - now);
}

// Everyone seated on the board right now, with how far past their shift end
// they are. Drives the "on overtime" count above the log sheet.
export function crewOnDuty(units) {
  const rows = [];
  units.forEach((u) => {
    ["alpha", "bravo"].forEach((slot) => {
      if (u[slot]) rows.push({ unit: u, slot, member: u[slot] });
    });
  });
  return rows;
}

// "John (DAY), Sara (NIGHT · 40m OT)" — who is holding this unit's seats and
// on which shift, for the team picker and the roster cards.
export function crewShiftSummary(unit, now) {
  const at = now || Date.now();
  return ["alpha", "bravo"]
    .map((slot) => unit[slot])
    .filter(Boolean)
    .map((m) => {
      const meta = shiftMeta(m.shift);
      const ot = overtimeMs(m, at);
      const tags = [meta ? meta.short : null, ot > 0 ? `${shortDurationStr(ot)} OT` : null].filter(Boolean);
      return tags.length > 0 ? `${m.name} (${tags.join(" · ")})` : m.name;
    })
    .join(", ");
}