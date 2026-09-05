import { DEFAULT_STATION } from "./live-sheet.jsx";
import { otHoursStr } from "./messages.jsx";
import { opDayKey, opDayLabel, opDayStart } from "./op-day.jsx";
import { uid } from "../lib/helpers.jsx";
import { mergeWrite } from "../lib/offline-queue.jsx";

// ---------- productivity requests ----------
//
// The department's "Administrative task form": a task somebody did that was
// not a call — on a day off, or at the station between calls — approved by a
// supervisor and counted into that person's UHU. On paper it was a Microsoft
// form with three boxes (ID, what was done, how many hours) and a note that it
// must be filed the same day and approved by the supervisor. Here it is the
// same three things, on the person's own screen, and the approval is the
// administrator's decision on the Teams page.
//
// Two keys, exactly as overtime is split: the ASK is the person's own and
// anybody signed in may write it; the DECISION is administration's and is on
// `ADMIN_ONLY_KEYS` (writable by the overtime area), or anybody could approve
// their own hours by posting to the board. The decision carries a COPY of the
// ask — who, what, which day, how many hours — so the statistics read the
// decisions alone and an ask edited after approval changes nothing.
//
// The day is never typed. "Must be filled the same day you did your task" is
// the form's own rule, so the day IS the operational day the request is sent
// on (07:00 to 07:00, like every date on this board), and there is no date
// field to get wrong.
export const PRODUCTIVITY_ASK_KEY = "ems:productivityAsks";
export const PRODUCTIVITY_KEY = "ems:productivity";

// Nobody's task runs longer than a shift. UHU is capped at 100 anyway, but a
// request for forty hours is a typo, and refusing it at the form is kinder
// than approving it by mistake.
export const PRODUCTIVITY_MAX_HOURS = 12;

// What is wrong with a request, as words — or "" when nothing is.
export function productivityProblem(form) {
  const { task, hours } = form || {};
  const said = String(task == null ? "" : task).trim();
  if (!said) return "Say what the task was.";
  // Three is the floor, as it is for an overtime reason: "PCR" is a real
  // answer, and a minimum people cannot meet honestly teaches them to pad.
  if (said.length < 3) return "A few more words — administration has to be able to act on this.";
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return "How many hours did it take?";
  if (h > PRODUCTIVITY_MAX_HOURS) return `No more than ${PRODUCTIVITY_MAX_HOURS} hours on one request.`;
  return "";
}

// A request, built from the signed-in person and the form. Hours are kept in
// milliseconds like every duration on this board, and the day is the
// operational day of the moment it was sent.
export function productivityAsk({ user, task, hours, now }) {
  const at = now || Date.now();
  const h = Number(hours);
  return {
    id: uid("prod"),
    accountId: (user && user.accountId) || "",
    name: (user && user.name) || "",
    unitName: (user && user.unitName) || "",
    station: (user && user.station) || DEFAULT_STATION,
    task: String(task == null ? "" : task).trim(),
    ms: Math.round(h * 3600000),
    day: opDayKey(opDayStart(at)),
    at,
  };
}

// Send it. Refuses at the one door every send goes through, so the banner
// and anything else that sends cannot disagree about what is acceptable.
export async function sendProductivityAsk({ user, task, hours, asks, setAsks, addLog, now }) {
  if (productivityProblem({ task, hours })) return null;
  const ask = productivityAsk({ user, task, hours, now });
  const next = { ...(asks || {}), [ask.id]: ask };
  const ok = await mergeWrite(PRODUCTIVITY_ASK_KEY, next, asks || {});
  if (!ok) return null;
  if (setAsks) setAsks(next);
  if (addLog) {
    await addLog(
      `Productivity request sent by ${ask.name || "crew"}${ask.unitName ? ` (${ask.unitName})` : ""} — ` +
        `${otHoursStr(ask.ms)} — ${ask.task}`,
      "status"
    );
  }
  return ask;
}

// Taking one back. Only while nobody has decided it: a decided request is
// the record of a decision, and the person it was about does not get to
// remove that.
export async function withdrawProductivityAsk({ ask, asks, setAsks, decisions }) {
  if (!ask || !asks || !asks[ask.id]) return false;
  if (decisions && decisions[ask.id]) return false;
  const next = { ...asks };
  delete next[ask.id];
  const ok = await mergeWrite(PRODUCTIVITY_ASK_KEY, next, asks);
  if (!ok) return false;
  if (setAsks) setAsks(next);
  return true;
}

// The decision, carrying the ask with it. `approvedMs` may be less than what
// was asked — a supervisor may approve two of the three hours — and a decline
// approves nought and says why.
export function productivityDecision({ ask, status, approvedMs, note, user, now }) {
  const at = now || Date.now();
  const declined = status === "declined";
  return {
    id: ask.id,
    status: declined ? "declined" : "approved",
    approvedMs: declined ? 0 : Math.max(0, Math.min(ask.ms || 0, approvedMs == null ? ask.ms || 0 : approvedMs)),
    note: String(note == null ? "" : note).trim(),
    decidedBy: (user && user.name) || "Administration",
    decidedByAccountId: (user && user.accountId) || "",
    decidedAt: at,
    // The ask, copied: the statistics read decisions alone.
    accountId: ask.accountId || "",
    name: ask.name || "",
    unitName: ask.unitName || "",
    station: ask.station || DEFAULT_STATION,
    task: ask.task || "",
    ms: ask.ms || 0,
    day: ask.day || "",
    at: ask.at || at,
  };
}

// A declined request has to say why — it goes on the person's own screen.
export function productivityDeclineProblem(note) {
  const said = String(note == null ? "" : note).trim();
  if (!said) return "Say why — it goes on their screen.";
  return "";
}

// Every request with whatever was decided about it, newest first. A decision
// whose ask has gone is still a decision, so the list is the union.
export function productivityRows(asks, decisions) {
  const a = asks && typeof asks === "object" ? asks : {};
  const d = decisions && typeof decisions === "object" ? decisions : {};
  const ids = new Set([...Object.keys(a), ...Object.keys(d)]);
  const out = [];
  ids.forEach((id) => {
    const ask = a[id] || null;
    const dec = d[id] || null;
    const base = ask || dec;
    if (!base || !base.at) return;
    out.push({
      id,
      accountId: base.accountId || "",
      name: base.name || "",
      unitName: base.unitName || "",
      station: base.station || DEFAULT_STATION,
      task: base.task || "",
      ms: base.ms || 0,
      day: base.day || "",
      at: base.at,
      decision: dec,
      status: dec ? dec.status : "pending",
    });
  });
  return out.sort((x, y) => (y.at || 0) - (x.at || 0));
}

export function productivityStatusLabel(row) {
  if (!row || !row.decision) return "AWAITING APPROVAL";
  if (row.decision.status === "declined") return "DECLINED";
  return row.decision.approvedMs < (row.ms || 0) ? "APPROVED IN PART" : "APPROVED";
}

// Requests inside a window, by the moment they were sent.
export function productivityInWindow(rows, from, to) {
  return (rows || []).filter((r) => r && r.at >= from && r.at < to);
}

// Approved hours per person inside a window — the thing that is added to a
// UHU numerator. Keyed the way `staffStatsFor` keys its people: employee ID
// upper-cased, or the name where there is none.
export function personKey(id, name) {
  return String(id || name || "").toUpperCase();
}

export function approvedProductivityByPerson(decisions, from, to) {
  const map = new Map();
  Object.values(decisions && typeof decisions === "object" ? decisions : {}).forEach((d) => {
    if (!d || d.status !== "approved" || !(d.approvedMs > 0)) return;
    if (!d.at || d.at < from || d.at >= to) return;
    const k = personKey(d.accountId, d.name);
    if (!k) return;
    map.set(k, (map.get(k) || 0) + d.approvedMs);
  });
  return map;
}

export function approvedProductivityMs(decisions, accountId, name, from, to) {
  return approvedProductivityByPerson(decisions, from, to).get(personKey(accountId, name)) || 0;
}

// One person's own requests, for their banner.
export function myProductivityRows(rows, accountId, name) {
  const k = personKey(accountId, name);
  return (rows || []).filter((r) => personKey(r.accountId, r.name) === k);
}

export function productivityDayLabel(row) {
  if (!row) return "";
  return row.at ? opDayLabel(opDayStart(row.at)) : row.day || "";
}
