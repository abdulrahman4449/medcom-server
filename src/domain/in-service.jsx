import { STATUS } from "./constants.jsx";
import { isAssistingUnit } from "./second-ambulance.jsx";

// ---------- who is actually in service ----------
//
// Dispatch used to read "in service" straight off `unit.status === "available"`,
// which turned out to be too narrow: a crew could be signed on and working
// while their unit still carried a status left over from an earlier call (or a
// status nobody had thought to reset), and dispatch would see an empty board —
// no teams to pick in the request form, and no options in the "Assign unit…"
// dropdown on a pending call, so a call raised without a team could never be
// given one. Availability is now derived from two independent facts: is anyone
// signed on, and is the unit tied up on a call that is still running.

// The statuses that only make sense while a unit is committed to a live call.
// Seeing one of these on a unit with no live call means the status is stale.
export const ON_CALL_STATUSES = ["dispatched", "enroute", "onscene", "transporting"];

// Never index STATUS directly for display: a unit saved before a status field
// existed (or carrying a value this build doesn't know) would otherwise throw
// while rendering and take the whole board down with it.
export function statusKey(status) {
  return STATUS[status] ? status : "oos";
}

export function statusMeta(status) {
  return STATUS[statusKey(status)];
}

// A unit is staffed when at least one seat is occupied. One crew member signed
// on is enough to reach — a single-seat unit is short-handed, not off the board.
export function isStaffed(unit) {
  return !!(unit && (unit.alpha || unit.bravo));
}

// The call a unit is committed to right now, or null. A pointer to a call that
// was completed (or no longer exists at all) is stale and doesn't count.
//
// A call that names this team counts even when the team doesn't point back at
// it. Assigning is two separate writes — the call first, then the unit — and if
// the second one never landed (a dropped request, a device that dozed off in
// between) the crew's screen used to stay silent while the desk showed the call
// as assigned and nobody could tell why. What dispatch actually decided is
// recorded on the call, so that is what the crew is alerted on; the repair pass
// in loadAll re-points the unit behind the scenes.
export function liveRequestFor(unit, requests) {
  if (!unit) return null;
  const live = (requests || []).filter((r) => r && r.status !== "completed");
  if (unit.assignedRequestId) {
    const pointed = live.find((r) => r.id === unit.assignedRequestId);
    if (pointed) return pointed;
  }
  const assignedAt = (r) => (r.times && r.times.assigned) || r.createdAt || 0;
  // A team sent as the second ambulance on someone else's call is committed to
  // it just as firmly as the team that owns it, and is found the same way.
  const named = live
    .filter((r) => r.assignedUnitId === unit.id || isAssistingUnit(r, unit.id))
    .sort((a, b) => assignedAt(a) - assignedAt(b));
  return named[0] || null;
}

export function isOnCall(unit, requests) {
  return !!liveRequestFor(unit, requests);
}

// Every unit dispatch could send on a new call — anything not already on one.
// Deliberately not filtered down to `status === "available"`: a unit that is
// free is assignable, and dispatch decides whether a short-handed or
// out-of-service team is the right one to send. Staffed teams sort first so the
// obvious choice is at the top of the list.
export function assignableUnits(units, requests) {
  return (units || [])
    .filter((u) => !isOnCall(u, requests))
    .sort((a, b) => {
      const rank = (u) => (u.status === "available" ? 0 : isStaffed(u) ? 1 : 2);
      return rank(a) - rank(b) || String(a.name).localeCompare(String(b.name));
    });
}

// How a free unit reads on a dispatch picker, so the desk can tell "crew on
// board, sitting out of service" apart from "nobody has signed on".
export function assignableNote(unit) {
  if (!isStaffed(unit)) return "no crew signed on";
  if (unit.status === "available") return !unit.alpha || !unit.bravo ? "one crew" : null;
  return statusMeta(unit.status).label.toLowerCase();
}

// The status a unit that isn't on a call should be sitting at: in service when
// someone is signed on, out of service when the seats are empty.
export function idleStatusFor(unit) {
  return isStaffed(unit) ? "available" : "oos";
}