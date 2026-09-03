// ---------- who is on the dispatch desk ----------
//
// The desk has no seat on the board: a dispatcher signing on writes a shift
// log line and nothing else, and until now the only place an administrator
// could learn who was on the desk today was by reading that log. This reads
// it for them. A stay is on duty from its `kind: "on"` line until a `kind:
// "off"` line for the same person and the same shift window, and never past
// one whole shift after that window closed — a sign-off that never came is a
// forgotten sign-out, not a dispatcher still working.
import { SHIFT_MS } from "./shifts.jsx";

export function dispatchersOnDuty(log, now = Date.now()) {
  const stays = new Map();
  const offs = new Map();
  (log || []).forEach((e) => {
    if (!e || e.type !== "shift") return;
    const d = e.detail || {};
    if (d.role !== "dispatcher" || !d.shiftStart) return;
    const key = `${d.accountId || d.name || "?"}::${d.shiftStart}`;
    if (d.kind === "on") {
      const prev = stays.get(key);
      if (!prev || (e.ts || 0) > prev.signedOnAt) {
        stays.set(key, {
          key,
          name: d.name || d.accountId || "",
          accountId: d.accountId || "",
          station: d.station || "",
          shift: d.shift || null,
          shiftStart: d.shiftStart,
          shiftEnd: d.shiftEnd || d.shiftStart + SHIFT_MS,
          signedOnAt: e.ts || d.shiftStart,
          delegated: !!d.delegated,
        });
      }
    } else if (d.kind === "off") {
      offs.set(key, Math.max(offs.get(key) || 0, e.ts || 0));
    }
  });
  return [...stays.values()]
    .filter((s) => {
      const off = offs.get(s.key);
      if (off && off >= s.signedOnAt) return false;
      if (s.signedOnAt > now) return false;
      return now < s.shiftEnd + SHIFT_MS;
    })
    .sort((a, b) => a.station.localeCompare(b.station) || a.shiftStart - b.shiftStart);
}
