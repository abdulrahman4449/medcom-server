import { isInternalEmergency, responseMsFor } from "./compliance.jsx";
import { medicCrewIndex, stayWindow } from "./crew-stamps.jsx";
import { callEndTs, callStartTs } from "./uhu.jsx";

// ---------- who stood out ----------
//
// Three awards, each measuring a different kind of good. A department that only
// ever celebrates the highest call count teaches its crews to chase calls; one
// that only celebrates speed teaches them to hurry. So: the busiest, the
// fastest, and the most reliable, side by side and equal.
//
// Punctuality is measured against the shift somebody signed on for, not against
// the clock — a night crew signing on at 18:50 for a 19:00 tour is early, and
// counting them late because it is not yet seven would be nonsense.
export const PUNCTUAL_GRACE_MS = 5 * 60 * 1000;

export function punctualityFor(log, win) {
  const people = new Map();
  (log || []).forEach((e) => {
    const d = e && e.detail;
    if (!d || d.kind !== "on" || d.role !== "team") return;
    if (!d.shiftStart || !e.ts) return;
    if (e.ts < win.start || e.ts >= win.end) return;
    const key = (d.accountId || d.name || "").toUpperCase();
    if (!key) return;
    if (!people.has(key)) people.set(key, { id: d.accountId || "", name: d.name || "", on: 0, total: 0, lateMs: 0 });
    const p = people.get(key);
    p.total += 1;
    const late = e.ts - d.shiftStart;
    if (late <= PUNCTUAL_GRACE_MS) p.on += 1;
    else p.lateMs += late;
  });
  return Array.from(people.values()).map((p) => ({
    ...p,
    pct: p.total ? (p.on / p.total) * 100 : 0,
  }));
}

// Average response, per person, on the internal emergencies they ran.
export function responseByPerson(requests, units, log, win, now) {
  const crewIndex = medicCrewIndex(units, log, now);
  const people = new Map();
  (requests || []).forEach((r) => {
    if (!isInternalEmergency(r)) return;
    if (r.createdAt < win.start || r.createdAt >= win.end) return;
    const ms = responseMsFor(r);
    if (ms === null) return;
    const from = callStartTs(r);
    const to = callEndTs(r, now);
    (crewIndex.get(r.assignedUnitId) || []).forEach((c) => {
      const w = stayWindow(c, now);
      if (!w.start || w.start > (to || from) || w.end < from) return;
      const key = (c.accountId || c.name || "").toUpperCase();
      if (!key) return;
      if (!people.has(key)) people.set(key, { id: c.accountId || "", name: c.name || "", total: 0, sum: 0 });
      const p = people.get(key);
      p.total += 1;
      p.sum += ms;
    });
  });
  return Array.from(people.values()).map((p) => ({ ...p, avg: p.sum / p.total }));
}

export function topPerformers({ staff, requests, units, log, win, now }) {
  // Busiest and hardest working, as one figure. Calls alone rewards short runs;
  // UHU alone rewards long ones. The average of the two ranks somebody who did
  // both above somebody who did one.
  const ranked = staff
    .filter((p) => p.calls > 0 || p.uhu > 0)
    .map((p) => {
      const maxCalls = Math.max(1, ...staff.map((x) => x.calls));
      return { ...p, score: ((p.calls / maxCalls) * 100 + p.uhu) / 2 };
    })
    .sort((a, b) => b.score - a.score);

  // Fastest, but only among people with enough calls for it to mean anything.
  // One lucky four-minute run is not a record.
  const resp = responseByPerson(requests, units, log, win, now)
    .filter((p) => p.total >= 3)
    .sort((a, b) => a.avg - b.avg);

  const punc = punctualityFor(log, win)
    .filter((p) => p.total >= 3)
    .sort((a, b) => b.pct - a.pct || b.total - a.total);

  return {
    workload: ranked[0] || null,
    fastest: resp[0] || null,
    punctual: punc[0] || null,
  };
}