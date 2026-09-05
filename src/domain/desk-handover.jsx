import { SHIFT_MS } from "./shifts.jsx";

// ---------- the dispatch desk is ONE seat per station ----------
//
// The desk used to be nothing on the board: a dispatcher signing on wrote a
// shift-log line, and so could a second one, and a third — nothing anywhere
// said the desk was taken. A dispatcher-role account that had joined a team
// could also flip its screen to the desk with the masthead button while
// another dispatcher was working it, and the board had two desks raising
// calls. The department's rule is one dispatcher per station per shift, and
// taking the desk from somebody mid-shift goes exactly the way taking a medic
// seat does (seat-handover.jsx): the holder is ASKED on their own phone,
// nothing moves until they answer, approving is their own sign-out, and a
// dead phone is an administrator's to resolve, never a timer's.
//
// `ems:desk` holds it: one record per station — `holder` (who has the desk,
// stamped like a seat) and `relief` (an ask waiting on the holder). It rides
// the fast poll: an ask has to reach the holder's screen and the answer has
// to reach the phone that is waiting, within seconds. The shift log stays
// the record of WHO WORKED THE DESK; this key only says who holds it now.
export const DESK_KEY = "ems:desk";

export function deskFor(desk, station) {
  const rec = desk && typeof desk === "object" && station ? desk[station] : null;
  return rec && typeof rec === "object" ? rec : null;
}

// Who holds the desk right now. A holder still on the record a whole shift
// after their window closed went home without signing out — the same grace a
// medic seat gets — and is nobody, not a dispatcher still working.
export function deskHolder(rec, now = Date.now()) {
  const h = rec && rec.holder && rec.holder.accountId ? rec.holder : null;
  if (!h) return null;
  const end = h.shiftEnd || (h.shiftStart ? h.shiftStart + SHIFT_MS : 0);
  if (end && now >= end + SHIFT_MS) return null;
  return h;
}

export function deskAsk(rec) {
  const r = rec && rec.relief && rec.relief.accountId ? rec.relief : null;
  return r;
}

export function deskAskPending(r) {
  return !!(r && r.accountId && (!r.status || r.status === "pending"));
}

// "declined" · "approved" · "forced" · "signed-out" once answered; null while
// it waits.
export function deskAskAnswer(r) {
  return r && r.accountId && r.status && r.status !== "pending" ? r.status : null;
}

// What signing on to this station's desk means for this person, right now.
//  free           nobody holds it — take it
//  mine           already theirs — continue, write nothing (changing phones)
//  waiting-mine   they already asked and the ask still waits
//  forgot         the holder's shift is over and they never signed out —
//                 nobody to ask, a plain takeover (the seat rule, exactly)
//  needs-approval the holder is mid-shift: ask them
export function deskHandoverKind(rec, accountId, now = Date.now()) {
  const holder = deskHolder(rec, now);
  if (!holder) return "free";
  if (accountId && holder.accountId === accountId) return "mine";
  const r = deskAsk(rec);
  if (r && accountId && r.accountId === accountId && deskAskPending(r)) return "waiting-mine";
  const end = holder.shiftEnd || (holder.shiftStart ? holder.shiftStart + SHIFT_MS : 0);
  if (end && now >= end) return "forgot";
  return "needs-approval";
}

export function askDesk(rec, who, now = Date.now()) {
  return { ...(rec || {}), relief: { ...who, queuedAt: now, needsApproval: true, status: "pending" } };
}

export function answerDeskAsk(rec, status, by, now = Date.now()) {
  const r = deskAsk(rec);
  if (!r) return rec || {};
  return { ...rec, relief: { ...r, status, answeredAt: now, answeredBy: by || "" } };
}

export function clearDeskAsk(rec) {
  if (!rec || !rec.relief) return rec || {};
  return { ...rec, relief: null };
}

// The desk changes hands. The ask is kept on the record, answered, so the
// phone that asked can see that the holder is now them and how it happened;
// it clears the ask itself when it lands.
export function handDeskTo(rec, who, how, by, now = Date.now()) {
  const r = deskAsk(rec);
  return {
    ...(rec || {}),
    holder: { accountId: who.accountId, name: who.name, shift: who.shift || null, shiftStart: who.shiftStart || null, shiftEnd: who.shiftEnd || null, signedOnAt: now, delegated: who.delegated || undefined },
    relief: r ? { ...r, status: how, answeredAt: now, answeredBy: by || "" } : null,
  };
}

export function takeDesk(rec, who, now = Date.now()) {
  return { ...(rec || {}), holder: { accountId: who.accountId, name: who.name, shift: who.shift || null, shiftStart: who.shiftStart || null, shiftEnd: who.shiftEnd || null, signedOnAt: now, delegated: who.delegated || undefined }, relief: null };
}

export function leaveDesk(rec) {
  return { ...(rec || {}), holder: null };
}

// The holder's side: an ask waiting for THEM.
export function askForMyDesk(rec, accountId, now = Date.now()) {
  const holder = deskHolder(rec, now);
  if (!holder || !accountId || holder.accountId !== accountId) return null;
  const r = deskAsk(rec);
  return deskAskPending(r) ? r : null;
}

// The station whose desk this account holds, if any.
export function deskHeldBy(desk, accountId, now = Date.now()) {
  if (!desk || typeof desk !== "object" || !accountId) return null;
  for (const station of Object.keys(desk)) {
    const holder = deskHolder(desk[station], now);
    if (holder && holder.accountId === accountId) return { station, holder };
  }
  return null;
}

// Every ask waiting on a holder who has not answered — the administrator's
// list, the way the dispatcher lists unanswered seat asks.
export function unansweredDeskAsks(desk, now = Date.now()) {
  if (!desk || typeof desk !== "object") return [];
  const out = [];
  for (const station of Object.keys(desk)) {
    const rec = desk[station];
    const holder = deskHolder(rec, now);
    const r = deskAsk(rec);
    if (holder && deskAskPending(r) && r.accountId !== holder.accountId) out.push({ station, holder, ask: r });
  }
  return out;
}
