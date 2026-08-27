import { INVENTORY_MOVES_CAP, INVENTORY_MOVES_KEY } from "./inventory.jsx";
import { stationOf } from "./live-sheet.jsx";
import { callEndTs } from "./uhu.jsx";
import { uid } from "../lib/helpers.jsx";
import { mergeWrite, readKey, writeKey, writeList } from "../lib/offline-queue.jsx";

// ---------- restocking, after the call ----------
//
// Restocking happens when the truck is back at station, not while the patient
// is in the back of it. Putting the tick-list on the live call card asked a
// crew to do the paperwork of replacing a cannula at the moment they were
// still using it, which is both the wrong moment and the one they are least
// able to give it.
//
// So it waits for them. A call goes on this list when it closes, the History
// tab carries a red count while anything is on it, and it stays there until
// somebody says the truck is restocked. Nothing else clears it: not the end of
// the shift, not signing out.
//
// Marked per call rather than counted from the movements, because "we used
// nothing on that one" is a real and common answer and it has to be
// distinguishable from "nobody has looked at it yet".
export const RESTOCK_KEY = "ems:restockDone";
export const RESTOCK_CAP = 600;

export function restockIsDone(done, requestId) {
  return !!(done && requestId && done[requestId]);
}

// The calls this truck has finished on this shift that nobody has restocked
// against yet, newest first.
//
// Measured on when the call ENDED, not when it was raised. Restocking happens
// after a call, so "did this land in my shift" is a question about the end of
// it — and keying on the start dropped calls off this list minutes after they
// finished: one raised at 18:40 and cleared at 19:10 was created before the
// window it ended in, so it disappeared at exactly the moment the crew were
// walking back to the truck to restock it.
//
// `from` is the crew's own shift window, the same one their completed-call list
// uses, so the two agree about which calls are theirs.
export function callsAwaitingRestock(requests, unitId, from, done) {
  if (!unitId) return [];
  const now = Date.now();
  return (requests || [])
    .filter(
      (r) =>
        r &&
        r.status === "completed" &&
        r.assignedUnitId === unitId &&
        callEndTs(r, now) >= (from || 0) &&
        !restockIsDone(done, r.id)
    )
    .sort((a, b) => callEndTs(b, now) - callEndTs(a, now));
}

export async function markRestocked({ request, unit, user }) {
  if (!request) return null;
  const existing = (await readKey(RESTOCK_KEY, {})) || {};
  const next = {
    ...existing,
    [request.id]: {
      ts: Date.now(),
      byName: (user && user.name) || "",
      accountId: (user && user.accountId) || null,
      unitId: unit ? unit.id : null,
    },
  };
  // Oldest entries fall off: this is a list of what has been done, and a call
  // from six months ago is never coming back onto the outstanding list.
  const keys = Object.keys(next);
  if (keys.length > RESTOCK_CAP) {
    const trimmed = {};
    keys
      .sort((a, b) => (next[b].ts || 0) - (next[a].ts || 0))
      .slice(0, RESTOCK_CAP)
      .forEach((k) => {
        trimmed[k] = next[k];
      });
    await writeKey(RESTOCK_KEY, trimmed);
    return trimmed;
  }
  await mergeWrite(RESTOCK_KEY, next, existing);
  return next;
}

// What a crew took off the shelf on one call. Negative deltas only — this half
// of the system records consumption; putting stock back is a count, which is
// administration's job and is recorded as one.
export async function recordStockUse({ item, qty, unit, user, request }) {
  const n = Math.max(1, Math.round(qty || 0));
  if (!item || !n) return null;
  const entry = {
    id: uid("mov"),
    ts: Date.now(),
    itemId: item.id,
    itemName: item.name || "",
    delta: -n,
    unitId: unit ? unit.id : null,
    unitName: unit ? unit.name || "" : "",
    station: unit ? stationOf(unit) : null,
    byName: (user && user.name) || "",
    accountId: (user && user.accountId) || null,
    requestId: request ? request.id : null,
    requestNature: request ? request.nature : "",
  };
  const existing = (await readKey(INVENTORY_MOVES_KEY, [])) || [];
  const next = [...existing, entry].slice(-INVENTORY_MOVES_CAP);
  const sent = await writeList(INVENTORY_MOVES_KEY, next, existing, { cap: INVENTORY_MOVES_CAP });
  return sent.value || next;
}

// Taking a line back off. A crew who tapped the wrong item, or the wrong
// number, corrects it here rather than through the desk — and the correction
// removes the line rather than adding an opposite one, because a restock and a
// mistake are different things and the log should not blur them.
export async function undoStockUse({ moveId }) {
  if (!moveId) return null;
  const existing = (await readKey(INVENTORY_MOVES_KEY, [])) || [];
  const next = existing.filter((m) => m && m.id !== moveId);
  const sent = await writeList(INVENTORY_MOVES_KEY, next, existing, { cap: INVENTORY_MOVES_CAP });
  return sent.value || next;
}

// What this call has already had recorded against it.
export function usedOnCall(moves, requestId) {
  if (!requestId) return [];
  return (moves || []).filter((m) => m && m.requestId === requestId);
}