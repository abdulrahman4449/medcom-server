import { liveRequestFor } from "./in-service.jsx";

// ---------- relieving a crew who are still out ----------
//
// A night crew whose last call runs past 07:00 are on overtime, on the road,
// with a patient in the back. The day crew arriving to take their seat had only
// one way in: take it. That stood the night crew down where they sat — their
// overtime stopped being counted at the moment of takeover rather than when they
// actually cleared, the running call lost its crew of record halfway through,
// and the board showed the truck freshly crewed and available while it was
// physically still out.
//
// A handover is not instantaneous. It happens when the truck comes back. So the
// relief is queued: the incoming crew are on duty and recorded from the moment
// they sign on, the outgoing crew keep the seat and keep accruing overtime until
// they close the call and sign out, and the seat transfers itself at that
// moment. Nobody has to remember.
//
// The other case is not overtime at all: somebody simply forgot to sign out and
// went home. There is nothing to wait for there, and waiting would hold a seat
// open all day — so that one is a straight takeover, and administration can
// clear it too.
export function seatOccupantIsWorking(unit, requests) {
  // Genuinely still out: the unit has a call that has not finished.
  return !!liveRequestFor(unit, requests);
}

export function seatShiftIsOver(member, now) {
  return !!(member && member.shiftEnd && now >= member.shiftEnd);
}

// Which of the two situations this is.
export function reliefSituationFor(unit, slot, requests, now) {
  const member = unit ? unit[slot] : null;
  if (!member) return "free";
  if (seatOccupantIsWorking(unit, requests)) return "still-out";
  if (seatShiftIsOver(member, now)) return "forgot-to-sign-out";
  return "on-shift";
}

export function queuedReliefFor(unit, slot) {
  const r = unit && unit.relief ? unit.relief[slot] : null;
  return r && r.accountId ? r : null;
}