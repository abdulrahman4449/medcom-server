import { isAssistingUnit } from "./second-ambulance.jsx";
import { uid } from "../lib/helpers.jsx";
import { readKey } from "../lib/offline-queue.jsx";

// ---------- escalations: a problem on a call, raised to the admins ----------
//
// Not everything that goes wrong on a call is a dispatch decision. A lift that
// never came, a ward that argued about the transfer, a stretcher that failed, a
// receiving unit that wasn't ready, a colleague who didn't turn up — none of
// those change the timeline, and most of them surface after the call has been
// completed and closed on time with the problem still unaddressed. Until now
// the only route for them was a phone call to somebody's office, which left no
// record and no answer.
//
// So an escalation is a note the crew can put on a call at any point — while it
// is live, or on a call they closed three weeks ago — and it goes to the
// admins and to nobody else. Dispatch never sees one: the desk is a peer, and a
// crew who know the desk reads their complaints stop writing them. The admins
// answer on the same thread, and the answer comes back to the person who raised
// it, which is the only way anyone who reports a problem ever learns it was
// dealt with.
//
// It is kept on the call itself:
//
//   req.escalations = [{
//     id, raisedAt, message,
//     by: { name, accountId, seat },
//     unitId, unitName,
//     atStatus, afterClose,      // what the call was doing when it was raised
//     status: "open" | "resolved",
//     resolvedAt, resolvedBy,
//     replies: [{ id, ts, message, role: "admin" | "team", byName, byAccountId }],
//   }]
//
// — rather than on a board key of its own, because an issue with a call is a
// fact about that call. It travels with it into the history, it is found by
// searching the same list, and no separate record can drift out of step with
// the call it belongs to.
export const ESCALATION_MAX = 800;

export function escalationsOf(req) {
  return req && Array.isArray(req.escalations) ? req.escalations.filter(Boolean) : [];
}

export function escalationReplies(esc) {
  return esc && Array.isArray(esc.replies) ? esc.replies.filter(Boolean) : [];
}

export function escalationIsOpen(esc) {
  return !!esc && esc.status !== "resolved";
}

export function lastAdminReply(esc) {
  const fromAdmin = escalationReplies(esc).filter((r) => r.role === "admin");
  return fromAdmin.length > 0 ? fromAdmin[fromAdmin.length - 1] : null;
}

// Whether an issue is still the admins' to deal with, which is a narrower thing
// than being open. An issue they have closed off is done. An issue they have
// answered is off their desk too: the crew have their reply, and nothing is
// waiting on the admin until the crew come back on it. Both stay on the call
// they were raised on and are found again under "Escalated only" in the call
// list below — which reaches into the live board as well as the history, so an
// issue on a call that is still running is still findable. They just stop
// sitting in an inbox that is only worth reading if everything in it still
// needs doing. A crew note written after the admin's last reply puts it
// straight back.
export function escalationAwaitsAdmin(esc) {
  if (!escalationIsOpen(esc)) return false;
  const replies = escalationReplies(esc);
  const last = replies[replies.length - 1];
  return !last || last.role !== "admin";
}

// How an escalation reads on a card, which is not the same fact for both sides
// of it: the crew are waiting to hear back, the admins are looking for the ones
// nobody has answered yet.
export function escalationStateMeta(esc, role) {
  if (!escalationIsOpen(esc)) return { key: "resolved", label: "RESOLVED", color: "var(--ok)" };
  // Answered, and then written back on: it is waiting on the admins again, and
  // saying "REPLIED" on it would read as dealt with when it is not.
  if (escalationAwaitsAdmin(esc) && lastAdminReply(esc)) {
    return { key: "reopened", label: role === "admin" ? "CREW REPLIED" : "WITH ADMIN", color: "var(--hold)" };
  }
  if (lastAdminReply(esc)) {
    return { key: "answered", label: role === "admin" ? "REPLIED" : "ADMIN REPLIED", color: "var(--flow)" };
  }
  return { key: "open", label: role === "admin" ? "NEEDS A REPLY" : "WITH ADMIN", color: "var(--hold)" };
}

// Who this board is, as far as escalations are concerned. Built once per view
// and handed down, so every card decides visibility from the same three facts
// rather than each one reaching into the session for itself.
export function escalationViewer(user, unit, shiftWindow) {
  if (!user) return null;
  return {
    role: user.role,
    accountId: user.accountId || null,
    name: user.name || "",
    seat: user.role === "team" ? user.slot || null : null,
    unitId: user.role === "team" ? user.unitId || null : null,
    unitName: unit ? unit.name : user.unitName || "",
    shiftWindow: shiftWindow || null,
  };
}

// Admins see every escalation on the board — that is the whole point of them.
// The person who raised one sees their own, so a reply reaches them. The other
// seat of the crew that raised it sees it too, but only if it was raised inside
// the shift they are working: two medics who ran the call together are one
// crew, while the crew who take the same truck over tomorrow are not, and last
// week's complaint is none of their business. Everybody else — dispatch, other
// teams, a later crew on the same medic — sees nothing at all.
export function canSeeEscalation(esc, viewer) {
  if (!esc || !viewer) return false;
  if (viewer.role === "admin") return true;
  if (viewer.role !== "team") return false;
  const by = esc.by || {};
  if (viewer.accountId && by.accountId && by.accountId === viewer.accountId) return true;
  if (!viewer.unitId || esc.unitId !== viewer.unitId) return false;
  const w = viewer.shiftWindow;
  return !!(w && esc.raisedAt >= w.start && esc.raisedAt <= w.end);
}

export function visibleEscalations(req, viewer) {
  return escalationsOf(req).filter((e) => canSeeEscalation(e, viewer));
}

// A crew can raise an issue on a call that was theirs — the one they were sent
// to, or one they were sent to help on — whether it is still running or long
// since closed. Nobody raises one on somebody else's call.
export function canRaiseEscalationOn(req, viewer) {
  if (!req || !viewer || viewer.role !== "team" || !viewer.unitId) return false;
  return req.assignedUnitId === viewer.unitId || isAssistingUnit(req, viewer.unitId);
}

// Every call carrying an escalation this viewer is allowed to read, newest
// issue first — the admin inbox, and the crew's own "show me the ones I
// escalated" filter, come off this.
export function escalatedCalls(requests, viewer, { openOnly, pendingOnly } = {}) {
  return (requests || [])
    .map((req) => {
      const list = visibleEscalations(req, viewer).filter(
        (e) => (!openOnly || escalationIsOpen(e)) && (!pendingOnly || escalationAwaitsAdmin(e))
      );
      return { req, escalations: list, latest: list.reduce((a, e) => Math.max(a, e.raisedAt || 0), 0) };
    })
    .filter((row) => row.escalations.length > 0)
    .sort((a, b) => b.latest - a.latest);
}

export function pendingEscalationCount(requests, viewer) {
  return (requests || []).reduce(
    (n, req) => n + visibleEscalations(req, viewer).filter(escalationAwaitsAdmin).length,
    0
  );
}

// The three writers. They all read the call list back before they touch it, for
// the same reason every other writer on this board does: an escalation raised
// on a tablet and a reply typed at a desk are two people writing to one key a
// few seconds apart, and neither may drop the other.
export async function raiseEscalation({ req, message, viewer, requests, saveRequests, addLog }) {
  const text = (message || "").trim();
  if (!req || !text || !canRaiseEscalationOn(req, viewer)) return false;
  const now = Date.now();
  const entry = {
    id: uid("esc"),
    raisedAt: now,
    message: text.slice(0, ESCALATION_MAX),
    by: { name: viewer.name || "", accountId: viewer.accountId || null, seat: viewer.seat || null },
    unitId: viewer.unitId,
    unitName: viewer.unitName || "",
    atStatus: req.status || "",
    afterClose: req.status === "completed",
    status: "open",
    replies: [],
  };
  const fresh = await readKey("ems:requests", requests);
  const next = fresh.map((r) => (r.id === req.id ? { ...r, escalations: [...escalationsOf(r), entry] } : r));
  await saveRequests(next);
  // The log line records that an issue was raised and says nothing whatever
  // about what it says. The event log is read at the desk and goes out on the
  // shared spreadsheet; the issue itself is for the admins.
  await addLog(
    `${entry.unitName || "A team"} escalated an issue to admin — ${req.nature}` +
      `${entry.afterClose ? " (call already closed)" : ""}`,
    "call"
  );
  return true;
}

export async function replyToEscalation({ req, escId, message, viewer, requests, saveRequests, addLog }) {
  const text = (message || "").trim();
  if (!req || !escId || !text || !viewer) return false;
  const now = Date.now();
  const reply = {
    id: uid("rep"),
    ts: now,
    message: text.slice(0, ESCALATION_MAX),
    role: viewer.role === "admin" ? "admin" : "team",
    byName: viewer.name || "",
    byAccountId: viewer.accountId || null,
  };
  const fresh = await readKey("ems:requests", requests);
  const next = fresh.map((r) =>
    r.id === req.id
      ? {
          ...r,
          escalations: escalationsOf(r).map((e) =>
            e.id === escId ? { ...e, replies: [...escalationReplies(e), reply] } : e
          ),
        }
      : r
  );
  await saveRequests(next);
  await addLog(
    reply.role === "admin"
      ? `Admin replied to an escalated issue — ${req.nature}`
      : `A team replied on an escalated issue — ${req.nature}`,
    "call"
  );
  return true;
}

// Closing an issue off is the admins' call, not the crew's: the person who
// reported a problem is not the person who decides it has been dealt with. It
// can be reopened, because plenty of them come back.
export async function setEscalationResolution({ req, escId, resolved, viewer, requests, saveRequests, addLog }) {
  if (!req || !escId || !viewer || viewer.role !== "admin") return false;
  const now = Date.now();
  const fresh = await readKey("ems:requests", requests);
  const next = fresh.map((r) =>
    r.id === req.id
      ? {
          ...r,
          escalations: escalationsOf(r).map((e) =>
            e.id === escId
              ? {
                  ...e,
                  status: resolved ? "resolved" : "open",
                  resolvedAt: resolved ? now : null,
                  resolvedBy: resolved ? viewer.name || "Admin" : null,
                }
              : e
          ),
        }
      : r
  );
  await saveRequests(next);
  await addLog(
    `Admin ${resolved ? "closed" : "reopened"} an escalated issue — ${req.nature}`,
    "call"
  );
  return true;
}