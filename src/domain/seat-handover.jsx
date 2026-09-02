import { reliefSituationFor, queuedReliefFor } from "./crew-relief.jsx";

// ---------- taking a seat somebody is sitting in ----------
//
// The holder is asked. The relief queue (crew-relief.jsx) already lets a
// newcomer sign on and take the seat the moment its crew sign out; taking over
// somebody MID-SHIFT goes through the same queue with one difference — the
// holder is asked to hand over, on their own phone, and nothing moves until
// they say so. Approving is signing out: their hours close by their own
// sign-out, the seat transfers by the rule that already exists, and the log
// names both sides. Declining keeps the seat and tells the person waiting.
//
// Two cases are not "asking":
//  - a holder still out on a call is queued for (unchanged) — the seat is
//    theirs until they clear, and it transfers itself when they sign out;
//  - a holder whose shift is over and who is not out has gone home without
//    signing out. There is nobody to ask; that stays a plain takeover.
//
// A holder whose phone is dead cannot answer either. The desk can hand the
// seat over instead, and that is logged as the desk's decision, never as the
// holder's.
export function handoverRequest(unit, slot) {
  const r = unit && unit.relief ? unit.relief[slot] : null;
  return r && r.accountId ? r : null;
}

// An ASK, as opposed to a still-out relief that needs nobody's answer.
export function handoverIsAsk(r) {
  return !!(r && r.needsApproval);
}

export function handoverIsPending(r) {
  return handoverIsAsk(r) && (!r.status || r.status === "pending");
}

// "declined" · "approved" · "forced" once answered; null while it waits.
export function handoverAnswer(r) {
  return handoverIsAsk(r) && r.status && r.status !== "pending" ? r.status : null;
}

// What signing into this seat means for this person, right now.
export function handoverKind(unit, slot, requests, accountId, now) {
  const member = unit ? unit[slot] : null;
  if (!member) return "free";
  if (accountId && member.accountId === accountId) return "mine";
  const r = handoverRequest(unit, slot);
  if (r && accountId && r.accountId === accountId && !handoverAnswer(r)) return "waiting-mine";
  const situation = reliefSituationFor(unit, slot, requests || [], now);
  if (situation === "still-out") return "still-out";
  if (situation === "forgot-to-sign-out") return "forgot";
  return "needs-approval";
}

export function queueHandover(unit, slot, who, now, needsApproval) {
  const entry = { ...who, queuedAt: now, ...(needsApproval ? { needsApproval: true, status: "pending" } : {}) };
  return { ...unit, relief: { ...(unit.relief || {}), [slot]: entry } };
}

export function answerHandover(unit, slot, status, by, now) {
  const r = handoverRequest(unit, slot);
  if (!r) return unit;
  return {
    ...unit,
    relief: { ...(unit.relief || {}), [slot]: { ...r, status, answeredAt: now, answeredBy: by || "" } },
  };
}

export function clearHandover(unit, slot) {
  if (!unit || !unit.relief || !unit.relief[slot]) return unit;
  return { ...unit, relief: { ...unit.relief, [slot]: null } };
}

// The seat-holder's side: an ask waiting for THEM.
export function askForMySeat(unit, slot, accountId) {
  const member = unit ? unit[slot] : null;
  if (!member || !accountId || member.accountId !== accountId) return null;
  const r = handoverRequest(unit, slot);
  return handoverIsPending(r) ? r : null;
}

export { queuedReliefFor };
