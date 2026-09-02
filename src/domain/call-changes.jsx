import { callEdits } from "./constants.jsx";

// ---------- Dispatch changed the call while the crew were on it ----------
//
// A destination changed silently on a phone in a pocket is a truck driving to
// the wrong ward. So a change the DESK applies to a live call reaches the crew
// with a tone and a red star on each changed line, and stays starred until
// the crew say they have seen it. The rules:
//  - only the desk's APPLIED edits count. A correction the crew proposed
//    themselves is theirs already, accepted or not;
//  - nothing from before the call was handed to this truck is starred - the
//    desk tidying a call before dispatch is not a change to a call in hand;
//  - "seen" is a timestamp kept on the DEVICE (lib/edits-seen.jsx), so a
//    phone that was locked while the desk edited catches up on its next read.
export function dispatchEditsOf(req) {
  return callEdits(req).filter((e) => e && e.status === "applied" && e.byRole === "dispatcher");
}

export function newestDispatchEditAt(req) {
  return dispatchEditsOf(req).reduce((n, e) => Math.max(n, e.at || 0), 0);
}

export function unseenDispatchEdits(req, seenTs) {
  return dispatchEditsOf(req).filter((e) => (e.at || 0) > (seenTs || 0));
}

export function changedFieldsSince(req, seenTs) {
  return new Set(unseenDispatchEdits(req, seenTs).map((e) => e.field));
}

// Before the crew have ever looked: everything since the call was handed to
// them counts, nothing before it does.
export function seenBaselineFor(req) {
  const t = (req && req.times) || {};
  return t.assigned || (req && req.createdAt) || 0;
}
