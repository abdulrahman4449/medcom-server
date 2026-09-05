import { TIME_STEPS, callEdits } from "./constants.jsx";
import { idleStatusFor } from "./in-service.jsx";
import { activeAssistUnitIds, assistOf, assistTeams } from "./second-ambulance.jsx";
import { uid } from "../lib/helpers.jsx";
import { readKey } from "../lib/offline-queue.jsx";

// ---------- stamping the timeline, and saying how the time was known ----------
//
// The five stamps belong to the TRUCK, not to a phone: the crew press them
// from the vehicle, and when the phone that would have pressed them is dead
// the desk presses them instead, by radio, live — and each such stamp says
// so. A time typed an hour later from memory is a different kind of record
// from one pressed at the bedside, and the sheet has to be able to tell them
// apart or a month-end read quietly overstates how much of it was recorded
// live. So every stamp that was not the crew's own carries a source on the
// record (`timeSources[timeKey]`): who entered it, when, how — and for an
// after-the-fact entry, why.
//
//  radio           the desk stamped a LIVE call from what the crew reported
//                  over the radio; `at` is the time the crew reported, which
//                  may be a minute or two before it was typed
//  after-the-fact  the call was already closed with a gap in its timeline,
//                  and the desk filled it with a reason
//
// The crew's own stamps carry no source and no edit entry: a stamp the crew
// pressed is the ordinary case, not a correction. A stamp the DESK made is
// also an applied dispatch edit (`field: "times.<key>"`), so it reaches the
// crew's card with the tone and the red star exactly as a changed destination
// does, and can be proposed against by the crew who were there.
export const TIME_SOURCE_RADIO = "radio";
export const TIME_SOURCE_AFTER = "after-the-fact";

export function timeSourcesOf(req) {
  return req && req.timeSources && typeof req.timeSources === "object" ? req.timeSources : {};
}

// The next step this call can take, from the status it is at.
export function timeStepFor(req) {
  if (!req || !req.status) return null;
  return TIME_STEPS.find((s) => s.from === req.status) || null;
}

export function timeStepByKey(timeKey) {
  return TIME_STEPS.find((s) => s.timeKey === timeKey) || null;
}

export function timeLabelFor(timeKey) {
  const s = timeStepByKey(timeKey);
  return s ? s.timeLabel : timeKey;
}

// "HH:MM" typed on a form, placed on the day of `baseTs`. A call that crossed
// midnight rolls forward (a time before the base by more than an hour is the
// next day); a time typed just after midnight for something that happened
// just before it rolls back.
export function tsFromClock(clock, baseTs) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(clock || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!(h >= 0 && h < 24 && mi >= 0 && mi < 60)) return null;
  const d = new Date(baseTs);
  d.setHours(h, mi, 0, 0);
  let ts = d.getTime();
  if (ts < baseTs - 3600000) ts += 86400000;
  else if (ts > baseTs + 23 * 3600000) ts -= 86400000;
  return ts;
}

export function clockOf(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// One step, applied to the board: the call advances, the time is stamped, the
// truck's status follows, and closing the call closes what hangs off it — the
// same transformation whoever pressed the button. `source` is null for the
// crew's own stamp; "radio" for the desk's.
export function stampStep({ requests, units, req, unit, step, at, stampedAt, by, byRole, accountId, source, note }) {
  const now = stampedAt || Date.now();
  const when = at || now;
  const entry = source
    ? {
        id: uid("edit"),
        field: `times.${step.timeKey}`,
        from: null,
        to: when,
        by: by || "Dispatch",
        byRole: byRole || "dispatcher",
        at: now,
        note: note || "",
        status: "applied",
        verifiedBy: by || "Dispatch",
        verifiedAt: now,
        source,
      }
    : null;
  const nextRequests = (requests || []).map((r) => {
    if (!r || r.id !== req.id) return r;
    const patched = {
      ...r,
      status: step.to,
      times: { ...(r.times || {}), [step.timeKey]: when },
      // Closing the call closes the ask that came off it: a second ambulance
      // for a call that is over is a task nobody should still be looking at.
      assist:
        step.to === "completed" && assistOf(r)
          ? {
              ...assistOf(r),
              status: assistOf(r).status === "pending" ? "cancelled" : assistOf(r).status,
              cancelledAt: assistOf(r).status === "pending" ? now : assistOf(r).cancelledAt,
              cancelledBy: assistOf(r).status === "pending" ? "Call completed" : assistOf(r).cancelledBy,
              teams: assistTeams(r).map((t) => (t.clearedAt ? t : { ...t, clearedAt: now })),
            }
          : r.assist,
    };
    if (source) {
      patched.timeSources = {
        ...timeSourcesOf(r),
        [step.timeKey]: {
          source,
          by: by || "Dispatch",
          accountId: accountId || "",
          at: now,
          ...(when !== now ? { reported: when } : {}),
          ...(note ? { note } : {}),
        },
      };
      patched.edits = [...callEdits(r), entry];
    }
    return patched;
  });
  const assistIds = step.to === "completed" ? activeAssistUnitIds(req) : [];
  const nextUnits = (units || []).map((u) => {
    if (!u) return u;
    if (unit && u.id === unit.id) {
      const patch = { status: step.unitStatus };
      if (step.to === "completed") {
        patch.assignedRequestId = null;
        // Going back in service only means "available" if a crew is still
        // signed on; an emptied truck drops to out of service instead.
        patch.status = idleStatusFor(u);
      }
      return { ...u, ...patch };
    }
    // A team that came to help is freed with the call rather than left
    // pointing at a finished one until the next repair pass notices.
    if (assistIds.includes(u.id)) return { ...u, assignedRequestId: null, status: idleStatusFor(u) };
    return u;
  });
  return { requests: nextRequests, units: nextUnits, edit: entry };
}

// The steps a closed call never stamped — what the desk may fill after the
// fact. In timeline order.
export function missingTimeSteps(req) {
  if (!req) return [];
  const t = req.times || {};
  return TIME_STEPS.filter((s) => !t[s.timeKey]);
}

// A closed call's gaps, filled with a reason. Only MISSING times are ever
// filled here — changing a time the truck stamped is not a gap, and is not
// offered.
export function fillTimesAfterTheFact({ req, fills, by, accountId, reason, now }) {
  const at = now || Date.now();
  const t = { ...(req.times || {}) };
  const sources = { ...timeSourcesOf(req) };
  const entries = [];
  (fills || []).forEach((f) => {
    if (!f || !f.timeKey || !f.at || t[f.timeKey] || !timeStepByKey(f.timeKey)) return;
    t[f.timeKey] = f.at;
    sources[f.timeKey] = { source: TIME_SOURCE_AFTER, by: by || "Dispatch", accountId: accountId || "", at, reason: reason || "" };
    entries.push({
      id: uid("edit"),
      field: `times.${f.timeKey}`,
      from: null,
      to: f.at,
      by: by || "Dispatch",
      byRole: "dispatcher",
      at,
      note: reason || "",
      status: "applied",
      verifiedBy: by || "Dispatch",
      verifiedAt: at,
      source: TIME_SOURCE_AFTER,
    });
  });
  if (!entries.length) return req;
  return { ...req, times: t, timeSources: sources, edits: [...callEdits(req), ...entries] };
}

export async function applyTimeFillsTo({ req, fills, reason, who, accountId, requests, saveRequests, addLog }) {
  if (!req || !fills || !fills.length) return false;
  const fresh = await readKey("ems:requests", requests);
  let done = null;
  const next = fresh.map((r) => {
    if (r.id !== req.id) return r;
    done = fillTimesAfterTheFact({ req: r, fills, by: who, accountId, reason });
    return done;
  });
  if (!done || done === req) return false;
  await saveRequests(next);
  await addLog(
    `DISPATCH (${who || "Dispatch"}) entered missing times after the fact — ` +
      fills.map((f) => `${timeLabelFor(f.timeKey)} ${clockOf(f.at)}`).join("; ") +
      ` — ${req.nature}` +
      (reason ? ` (${reason})` : ""),
    "status"
  );
  return true;
}

// What the sheet says about how this row's times were known. Empty for a call
// the truck stamped itself.
export function timeSourceNote(req) {
  const s = timeSourcesOf(req);
  const parts = [];
  TIME_STEPS.forEach((step) => {
    const x = s[step.timeKey];
    if (!x) return;
    if (x.source === TIME_SOURCE_RADIO) parts.push(`${step.timeLabel}: by radio (${x.by || "Dispatch"})`);
    else if (x.source === TIME_SOURCE_AFTER) parts.push(`${step.timeLabel}: after the fact (${x.by || "Dispatch"}${x.reason ? ` — ${x.reason}` : ""})`);
  });
  return parts.join("; ");
}

// The short form for a chip or a narrow cell.
export function timeSourceShort(x) {
  if (!x) return "";
  return x.source === TIME_SOURCE_RADIO ? "RADIO" : x.source === TIME_SOURCE_AFTER ? "BY HAND" : "";
}
