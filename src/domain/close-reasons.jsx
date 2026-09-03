
// ---------- why a call was closed ----------
//
// Every call on this board ends the same way: the desk presses Close call. That
// one press used to be the entire record of the ending — the row moved to
// completed carrying a name and a timestamp and nothing at all about what
// happened to the patient. A call run through to the receiving ward and a call
// stood down two minutes after it was raised read identically the next morning,
// and the desk that closed them is long off shift by the time anyone asks.
//
// So the press asks a question first, the same way cancelling a booking does.
// The reasons below are the endings the desk actually sees, ordinary one first:
// most calls close because the patient was delivered, and that stays a single
// press. Anything else is typed into the same box — the chips fill the box
// rather than replace it, so a picked reason can still be added to.
export const CALL_CLOSE_REASONS = [
  "Call completed — patient delivered",
  "Patient refused transport",
  "Cancelled before the team arrived",
  "Team stood down en route",
  "Patient transported by other means",
  "No patient found at pickup",
  "Duplicate call",
  "Closed by desk — crew could not finish the timeline",
];

// The longest a reason can be. Long enough for a sentence explaining an unusual
// ending, short enough that the export column stays readable.
export const CALL_CLOSE_REASON_MAX = 200;

// What the record says a call was closed for. Calls closed before this was
// asked for have no reason on them, and everything reading it says so plainly
// rather than leaving a blank next to a patient — a blank reads as "nobody
// filled it in", which is a different thing from "this was never asked".
export function callCloseReason(req) {
  return req && typeof req.closeReason === "string" ? req.closeReason.trim() : "";
}

// A call that was called off rather than run. There is no "cancelled" status on
// this board and there deliberately isn't one: a call the desk stands down is
// closed exactly like any other, and the only record of it having been called
// off is the reason typed into the close banner. So that reason is what this
// reads. The chips fill the close box rather than replace it — a picked ending
// can have a sentence added to it — so it matches on the words rather than on
// the whole string, which keeps "Cancelled before the team arrived — ward rang
// back" a cancellation.
//
// A refusal is deliberately not one of these. The truck rolled and the team
// assessed the patient, so that call happened: it carries the NO TRANSPORT
// stamp instead, and it is not what anybody means by a cancelled request.
export const CALL_CANCELLED_MARKERS = [
  "cancel",
  "stood down",
  "stand down",
  "no patient found",
  "duplicate call",
  "transported by other means",
];

export function callWasCancelled(req) {
  const reason = callCloseReason(req).toLowerCase();
  if (!reason) return false;
  return CALL_CANCELLED_MARKERS.some((m) => reason.includes(m));
}
// Called off before the crew ever reached the patient: the reason says it was
// stood down AND there is no arrival stamp. Both halves — a call stood down at
// the bedside is a cancellation that still cost the crew a response, and a
// call with no scene stamp is an unfinished timeline, not a cancellation.
// Shared by the restock list and the service column, so the two never
// disagree about which calls "never happened".
export function stoodDownBeforeArrival(req) {
  if (!req) return false;
  const reachedScene = !!((req.times || {}).arrival);
  return callWasCancelled(req) && !reachedScene;
}
