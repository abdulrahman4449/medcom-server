import { stationOf } from "../domain/live-sheet.jsx";
import { shiftWindowAt } from "../domain/shift-helpers.jsx";
import { SHIFT_MS } from "../domain/shifts.jsx";
import { writeKey } from "./offline-queue.jsx";

// ---------- keeping the live board small ----------
//
// Every change sends the whole board back to the server. A crew tapping
// "arrival at scene" re-uploads every call, every log line, every escalation the
// department has ever recorded. That is why the writes started failing: the
// board had quietly grown past what the server would accept. Raising the limit
// bought room, it did not fix the shape of the problem — left alone the board
// grows forever and the same failure comes back, slower and harder to spot.
//
// A completed call whose shift has been submitted and finalised is already kept
// in the archive. Holding a second copy on the live board buys nothing and costs
// something on every write from then on. So after a few shifts it comes off, and
// the archive is where it lives.
//
// Measured in shifts rather than days, because that is the unit the department
// actually works in: four shifts is the last two days, so yesterday's work is
// always still on the board.
export const PRUNE_KEEP_SHIFTS = 4;

export function pruneCutoff(now) {
  // The start of the window PRUNE_KEEP_SHIFTS ago. Anything whose shift ended
  // before this is old enough to live in the archive alone.
  return shiftWindowAt(now).start - PRUNE_KEEP_SHIFTS * SHIFT_MS;
}

// A call may only be dropped when all of this is true. Age on its own is never
// enough — the test is whether a copy is demonstrably safe somewhere else.
export function isSafeToPrune(req, submissions, cutoff) {
  if (!req || !req.id) return false;
  if (req.status !== "completed") return false;
  if (!req.createdAt || req.createdAt >= cutoff) return false;
  // Its shift must have been submitted, that submission must have completed,
  // and the call itself must actually be inside it. Verified against the stored
  // copy, not assumed from dates.
  return (submissions || []).some(
    (s) =>
      s &&
      s.status === "final" &&
      s.station === stationOf(req) &&
      req.createdAt >= s.windowStart &&
      req.createdAt < s.windowEnd &&
      Array.isArray(s.requests) &&
      s.requests.some((r) => r && r.id === req.id)
  );
}

// Log lines follow the calls: kept once they are inside a finalised submission,
// then trimmed. The live log was already capped at 400 and silently discarding
// the oldest, so this loses nothing that was not being lost already — the
// difference is that now the discarded lines are in the archive first.
export function isSafeToPruneLog(entry, submissions, cutoff) {
  if (!entry || !entry.ts || entry.ts >= cutoff) return false;
  return (submissions || []).some(
    (s) =>
      s &&
      s.status === "final" &&
      entry.ts >= s.windowStart &&
      entry.ts < s.windowEnd &&
      s.station === stationOf(entry) &&
      Array.isArray(s.log) &&
      s.log.some((l) => l && l.id === entry.id)
  );
}

export async function pruneArchivedWork({ requests, log, submissions, now }) {
  const cutoff = pruneCutoff(now);
  const keepRequests = (requests || []).filter((r) => !isSafeToPrune(r, submissions, cutoff));
  const keepLog = (log || []).filter((e) => !isSafeToPruneLog(e, submissions, cutoff));

  const droppedRequests = (requests || []).length - keepRequests.length;
  const droppedLog = (log || []).length - keepLog.length;
  if (!droppedRequests && !droppedLog) return { droppedRequests: 0, droppedLog: 0 };

  if (droppedRequests) {
    const ok = await writeKey("ems:requests", keepRequests);
    if (!ok) return { droppedRequests: 0, droppedLog: 0 };
  }
  if (droppedLog) await writeKey("ems:log", keepLog);
  return { droppedRequests, droppedLog };
}