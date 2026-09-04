import { DEFAULT_STATION, stationOf } from "./live-sheet.jsx";
import { otHoursStr } from "./messages.jsx";
import { seatLabel, shiftLabelWithWindow } from "./shift-helpers.jsx";
import { callEndTs, callStartTs } from "./uhu.jsx";
import { mergeWrite, writeKey } from "../lib/offline-queue.jsx";

// ---------- overtime ----------
//
// Overtime here is not claimed, it is observed. The board already knows when
// somebody signed on, which shift they signed on for, and when they signed off,
// so a stay that ran past its shift end is a fact the log already holds — and
// asking a crew to fill in a form about something the app watched happen is
// how overtime goes unrecorded.
//
// So the claims are DERIVED from the log and never stored. What is stored is
// the decision: approved, approved in part, or declined, keyed to the stay it
// answers. That keeps one source of truth for what happened and a separate one
// for what was agreed about it, and it means correcting a sign-off time
// corrects the claim rather than leaving an orphan.
export const OVERTIME_KEY = "ems:overtime";

// What has actually been put in front of administration.
//
// Not every hour past a shift end is a claim somebody wants to make. A crew
// held on a call at seven o'clock had no choice about it and the department
// pays either way, so that one goes to administration on its own. A crew who
// stayed twenty minutes to finish tidying the truck may well not want to claim
// for it, and a queue full of claims nobody intended to make is a queue an
// administrator stops reading.
//
// So: held by a call is sent automatically, and everything else is the
// person's own to send. This is the record of what they sent — a map of claim
// id to who sent it and when, kept apart from the decisions so that a claim
// being sent can never be mistaken for a claim being approved.
export const OVERTIME_SENT_KEY = "ems:overtimeSent";

// Did the department keep this person past their shift, or did they stay?
// The one is sent on its own; the other is offered.
export function overtimeIsAutomatic(claim) {
  return !!(claim && (claim.onCall || claim.granted));
}

// Is this claim in front of administration at all?
export function overtimeSubmitted(claim, sent) {
  if (overtimeIsAutomatic(claim)) return true;
  return !!(sent && claim && sent[claim.id]);
}

// A claim nobody was HELD on has to say why.
//
// The two kinds of overtime are different conversations. A call still running
// at seven o'clock is a fact the board watched happen — the department kept
// them, it pays either way, and there is nothing for anybody to explain. Time
// after a shift with no call on it is the person's own decision to stay, and
// an administrator looking at "0.37 h claimed · not on a call" has nothing to
// approve or decline it ON. Restocking, a late handover, a truck fault, an
// hour covering for a partner who did not arrive — those are all reasonable
// and they are all invisible from the board, so the person has to say which.
//
// Required only where it is a choice: an automatic claim is never asked.
export function overtimeReasonRequired(claim) {
  return !!claim && !overtimeIsAutomatic(claim);
}

// Empty is refused; so is a stray keypress. Deliberately not much more than
// that — a minimum length people cannot meet honestly is a minimum that
// teaches them to type "aaaaaa".
export function overtimeReasonProblem(claim, reason) {
  if (!overtimeReasonRequired(claim)) return "";
  const said = String(reason == null ? "" : reason).trim();
  if (!said) return "Say what kept you past the end of your shift.";
  // Three, not more. A stray keypress is one or two characters; "PCR" is a real
  // answer and is three, and a minimum people cannot meet honestly is a
  // minimum that teaches them to type "aaaaaa".
  if (said.length < 3) return "A few more words — administration has to be able to act on this.";
  return "";
}

// Recording that somebody sent theirs in. Written by the person it belongs to,
// which is why it is its own key: the decisions are administration's and a
// crew tablet has no business writing into them.
export async function sendOvertimeClaim({ claim, sent, setSent, user, addLog, reason }) {
  if (!claim) return false;
  // The rule, at the one door every send goes through — the crew card and the
  // sign-out prompt both come here, and a check written in only one of them is
  // a rule the other route walks around.
  if (overtimeReasonProblem(claim, reason)) return false;
  const said = String(reason == null ? "" : reason).trim();
  const next = {
    ...(sent || {}),
    [claim.id]: {
      at: Date.now(),
      by: (user && user.name) || claim.name || "",
      accountId: (user && user.accountId) || claim.accountId || "",
      claimedMs: claim.claimedMs || 0,
      // Kept on the SENT record rather than on the decision: it is what the
      // person said when they asked, and it must not be editable by the person
      // answering.
      reason: said,
    },
  };
  const ok = await mergeWrite(OVERTIME_SENT_KEY, next, sent || {});
  if (!ok) {
    window.alert("That could not be sent — no signal to the server. Nothing has changed; try again.");
    return false;
  }
  if (setSent) setSent(next);
  if (addLog) {
    await addLog(
      `Overtime sent to administration by ${claim.name || (user && user.name) || "crew"}` +
        `${claim.unitName ? ` (${claim.unitName})` : ""} — ${otHoursStr(claim.claimedMs)}` +
        `${said ? ` — ${said}` : ""}`,
      "status"
    );
  }
  return true;
}

// One stay, one claim. The seat is in the key because a person who worked two
// trucks in one shift did two stays and each is answerable separately.
export function overtimeClaimId(d) {
  const who = (d.accountId || d.name || "?").toUpperCase();
  return `${who}::${d.shiftStart || 0}::${d.unitId || "?"}::${d.seat || "?"}`;
}

// Was this person on a call when their shift ended? Both cases count as
// overtime — the department pays for the hour either way — but they are
// different conversations, and an administrator deciding should be able to see
// which one this is without opening the call list.
export function heldByCallAt(requests, unitId, at) {
  if (!unitId || !at) return null;
  return (
    (requests || []).find((r) => {
      if (!r || r.assignedUnitId !== unitId) return false;
      const start = callStartTs(r);
      if (!start || start > at) return false;
      const end = callEndTs(r, at + 1);
      return end >= at;
    }) || null
  );
}

// Every stay in the window that ran past its shift end, with whatever has been
// decided about it attached.
export function overtimeClaims(log, requests, from, to, decisions, sent) {
  const decided = decisions || {};
  const submitted = sent || {};
  const out = [];
  (log || []).forEach((e) => {
    if (!e || e.type !== "shift") return;
    const d = e.detail || {};
    if (d.kind !== "off" || d.role !== "team") return;
    if (!d.overtimeMs || d.overtimeMs <= 0) return;
    if (!e.ts || e.ts < from || e.ts >= to) return;
    const id = overtimeClaimId(d);
    // Whether a call was holding them is decided at sign-off and stamped on the
    // log entry there. Deriving it here from `requests` was right on the day and
    // wrong a fortnight later: the live board only carries recent calls, so an
    // older claim came back "not on a call" and — now that the answer decides
    // whether it reaches administration at all — would have quietly stopped
    // being sent. The stamp is the truth; the derivation is the fallback for
    // entries written before it existed.
    const held =
      d.onCall === undefined ? heldByCallAt(requests, d.unitId, d.shiftEnd) : null;
    const onCall = d.onCall === undefined ? !!held : !!d.onCall;
    const onCallNature = d.onCall === undefined ? (held ? held.nature : "") : d.onCallNature || "";
    out.push({
      id,
      ts: e.ts,
      station: d.station || DEFAULT_STATION,
      name: d.name || "",
      accountId: d.accountId || "",
      unitId: d.unitId || null,
      unitName: d.unitName || "",
      seat: d.seat || null,
      shift: d.shift || null,
      shiftStart: d.shiftStart || null,
      shiftEnd: d.shiftEnd || null,
      signedOffAt: e.ts,
      claimedMs: d.overtimeMs,
      onCall,
      onCallNature,
      decision: decided[id] || null,
      granted: false,
      // Automatic if a call held them; otherwise only once they send it.
      sentAt: onCall ? e.ts : (submitted[id] && submitted[id].at) || null,
      submitted: onCall || !!submitted[id],
      automatic: onCall,
      // What the person said kept them. Carried onto the claim so the panel
      // deciding it can read it without going to the shift log for it — an
      // administrator looking at hours with no call behind them has nothing
      // else to go on.
      sentReason: (submitted[id] && submitted[id].reason) || "",
    });
  });

  // Whole shifts an administrator granted outright. These are not derived from
  // anything — they are a decision on their own — so they are read straight out
  // of the store and shown beside the observed ones.
  Object.keys(decided).forEach((id) => {
    const dec = decided[id];
    if (!dec || !dec.granted) return;
    if (!dec.shiftStart || dec.shiftStart < from || dec.shiftStart >= to) return;
    out.push({
      id,
      ts: dec.decidedAt || dec.shiftStart,
      station: dec.station || DEFAULT_STATION,
      name: dec.name || "",
      accountId: dec.accountId || "",
      unitId: dec.unitId || null,
      unitName: dec.unitName || "",
      seat: dec.seat || null,
      shift: dec.shift || null,
      shiftStart: dec.shiftStart || null,
      shiftEnd: dec.shiftEnd || null,
      signedOffAt: null,
      claimedMs: dec.claimedMs || 0,
      onCall: false,
      onCallNature: "",
      decision: dec,
      granted: true,
      // A granted shift is administration's own decision, so it is never
      // waiting on the person to send it.
      sentAt: dec.decidedAt || null,
      submitted: true,
      automatic: true,
    });
  });

  return out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// What was actually agreed, in milliseconds. Undecided is not zero — it is
// undecided, and a total that quietly counts pending claims as nought is a
// total somebody will budget against.
export function overtimeApprovedMs(claim) {
  const d = claim && claim.decision;
  if (!d) return null;
  if (d.status === "declined") return 0;
  if (d.status === "partial") return Math.max(0, d.approvedMs || 0);
  if (d.status === "approved") return Math.max(0, d.approvedMs || claim.claimedMs || 0);
  return null;
}

// Counting somebody's whole tour as overtime — called in on a rest day, or held
// over for a full shift rather than the hour or two the board works out on its
// own. It is not derived from anything, so it is a decision recorded in its own
// right, and it is written the same way from wherever it is pressed.
//
// It covers the rostered shift and nothing beyond it. If they then work past
// the end of that shift, the board raises the usual overtime claim for the
// excess when they sign off, and administration has to approve that separately.
// A grant is not a blank cheque on the rest of the day.
export async function grantWholeShiftOvertime({ unit, slot, member, user, decisions, setDecisions, addLog }) {
  const start = member && member.shiftStart;
  const end = member && member.shiftEnd;
  if (!start || !end) {
    window.alert(
      `${(member && member.name) || "That person"} has no shift window recorded, so a whole shift ` +
        `cannot be worked out. They need to sign on again for it to be counted.`
    );
    return false;
  }
  const whole = Math.max(0, end - start);
  const now = Date.now();
  // How far past the rostered end they already are. Named in the confirmation,
  // because it is the part this grant does *not* cover.
  const beyond = Math.max(0, now - end);

  const ok = window.confirm(
    `Count ${member.name}'s whole shift as overtime?\n\n` +
      `${shiftLabelWithWindow(member.shift)} — ${otHoursStr(whole)}\n\n` +
      (beyond > 0
        ? `They are already ${otHoursStr(beyond)} past the end of that shift. This grant covers ` +
          `the ${otHoursStr(whole)} of the shift itself. Anything past it is a separate claim ` +
          `that you will be asked to approve again when they sign off.\n\n`
        : `If the shift runs past its twelve hours, the extra is a separate claim you will be ` +
          `asked to approve again.\n\n`) +
      `Recorded as done by you.`
  );
  if (!ok) return false;

  // The desk has no truck and no seat. A grant to a dispatcher is keyed to
  // "desk" and named as the desk, and reads on the overtime panel like any
  // other whole-shift grant.
  const unitId = unit ? unit.id : "desk";
  const unitName = unit ? unit.name : "Dispatch desk";
  const station = unit ? stationOf(unit) : member.station || DEFAULT_STATION;
  const id = `GRANT::${overtimeClaimId({
    accountId: member.accountId,
    name: member.name,
    shiftStart: start,
    unitId,
    seat: slot,
  })}`;

  const next = {
    ...(decisions || {}),
    [id]: {
      ...(decisions || {})[id],
      status: "approved",
      approvedMs: whole,
      decidedBy: (user && user.name) || "Administration",
      decidedAt: now,
      note: "Whole shift granted as overtime",
      name: member.name,
      accountId: member.accountId || "",
      unitId,
      unitName,
      seat: slot || null,
      station,
      shift: member.shift,
      shiftStart: start,
      shiftEnd: end,
      claimedMs: whole,
      granted: true,
    },
  };

  const saved = await writeKey(OVERTIME_KEY, next);
  if (!saved) {
    window.alert("That could not be saved — no signal to the server. Nothing has changed; try again.");
    return false;
  }
  setDecisions(next);
  await addLog(
    `Whole shift granted as overtime — ${member.name} (${unitName}${slot ? ` · ${seatLabel(slot)}` : ""}), ` +
      `${shiftLabelWithWindow(member.shift)}, ${otHoursStr(whole)}` +
      (beyond > 0 ? ` · ${otHoursStr(beyond)} already past the shift end, to be claimed separately` : ""),
    "status"
  );
  return true;
}

export function overtimeStatusLabel(claim) {
  const d = claim && claim.decision;
  if (!d) return "AWAITING APPROVAL";
  if (d.status === "declined") return "DECLINED";
  if (d.status === "partial") return "APPROVED IN PART";
  if (d.status === "approved") return claim.granted ? "WHOLE SHIFT GRANTED" : "APPROVED";
  return "AWAITING APPROVAL";
}