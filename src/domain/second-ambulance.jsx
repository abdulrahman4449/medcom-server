import { callWasCancelled } from "./close-reasons.jsx";
import { NO_TRANSPORT } from "./outcomes.jsx";
import { callEndTs } from "./uhu.jsx";

// ---------- a second ambulance on the same call ----------
//
// One team is sometimes not enough: a bariatric lift, two patients out of one
// room, a resuscitation that needs four pairs of hands. The crew on scene are
// the only people who know that, so they ask for the help themselves from the
// call they are on, and the ask lands on the dispatch desk as an alert plus a
// task that isn't finished until a second team has been sent to that same call.
//
// The whole exchange lives on the call record so every desk and both crews see
// the same thing:
//
//   req.assist = {
//     status: "pending" | "assigned" | "cancelled",
//     requestedAt, requestedByUnitId, requestedByUnitName, requestedBy, note,
//     cancelledAt, cancelledBy,
//     teams: [{ unitId, unitName, assignedAt, assignedBy, acknowledgedAt, clearedAt }]
//   }
//
// `teams` is a list, not a single id: a crew can ask again after the first
// assisting team has been sent, which puts the task back on the desk while
// keeping the team already helping exactly where it is.
export function assistOf(req) {
  return req && req.assist && typeof req.assist === "object" ? req.assist : null;
}

export function assistPending(req) {
  const a = assistOf(req);
  return !!(a && a.status === "pending" && req.status !== "completed");
}

export function assistTeams(req) {
  const a = assistOf(req);
  return a && Array.isArray(a.teams) ? a.teams.filter(Boolean) : [];
}

// The assisting team's own record on this call while it is still helping. A
// team that has cleared has finished assisting and is free again.
export function assistTeamFor(req, unitId) {
  return assistTeams(req).find((t) => t.unitId === unitId && !t.clearedAt) || null;
}

export function isAssistingUnit(req, unitId) {
  return !!assistTeamFor(req, unitId);
}

export function activeAssistUnitIds(req) {
  return assistTeams(req)
    .filter((t) => !t.clearedAt)
    .map((t) => t.unitId);
}

// Every live call still waiting for a second team, oldest ask first — the
// dispatch desk's task list.
export function pendingAssistCalls(requests) {
  return (requests || [])
    .filter((r) => assistPending(r))
    .sort((a, b) => (assistOf(a).requestedAt || 0) - (assistOf(b).requestedAt || 0));
}

// How long an assisting team was tied up on a call that isn't theirs: from the
// moment they were sent to the moment they cleared, or to the end of the call.
export function assistBusyMs(req, unitId, now) {
  const team = assistTeams(req).find((t) => t.unitId === unitId);
  if (!team || !team.assignedAt) return 0;
  const end = team.clearedAt || callEndTs(req, now);
  return Math.max(0, end - team.assignedAt);
}

// A call the crew responded to and did not transport on, because the patient
// refused the transfer once the team reached them.
export function isNoTransport(req) {
  return !!(req && req.noTransport);
}

// What the call ended up being, for the history and the export. Left blank
// rather than guessed at for an ordinary call: only a refusal is something this
// board knows for certain happened.
export function callOutcomeLabel(req) {
  return isNoTransport(req) ? NO_TRANSPORT.label : "";
}

// Did this call move a patient, or was it called off?
//
// The question the department asks a month-end sheet first, and until now it
// had to be worked out by reading the close reason on every row. Four answers
// rather than the two it is usually asked as, because the two in between are
// real and recording either of them as a transfer would be a lie:
//
//  - CANCELLED       the desk stood it down; nobody was moved
//  - NOT TRANSPORTED the truck rolled and the patient refused or was not there
//  - IN PROGRESS     it has not finished yet
//  - TRANSFERRED     the patient was delivered
//
// A refusal is deliberately not a cancellation: the truck went, the team
// assessed somebody, and that call happened. See close-reasons.jsx.
export const REQUEST_OUTCOMES = {
  cancelled: "CANCELLED",
  notTransported: "NOT TRANSPORTED",
  inProgress: "IN PROGRESS",
  transferred: "TRANSFERRED",
};

export function requestOutcomeKey(req) {
  if (!req) return "inProgress";
  if (callWasCancelled(req)) return "cancelled";
  if (req.status !== "completed") return "inProgress";
  if (isNoTransport(req)) return "notTransported";
  return "transferred";
}

export function requestOutcomeLabel(req) {
  return REQUEST_OUTCOMES[requestOutcomeKey(req)] || "";
}

// Every team that was sent to help on this call, named, in the order they were
// sent. Falls back to the id if a team has since been removed from the roster.
export function assistTeamNames(req, units) {
  return assistTeams(req)
    .map((t) => {
      if (t.unitName) return t.unitName;
      const u = (units || []).find((x) => x.id === t.unitId);
      return u ? u.name : t.unitId;
    })
    .join(", ");
}