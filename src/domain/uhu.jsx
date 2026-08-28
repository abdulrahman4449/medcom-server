import { TIME_STEPS } from "./constants.jsx";
import { shiftMsForUnit } from "./coverage.jsx";
import { stayWindow } from "./crew-stamps.jsx";
import { assistBusyMs, assistTeams } from "./second-ambulance.jsx";
import { shiftWindowAt } from "./shift-helpers.jsx";
import { SHIFT_MS } from "./shifts.jsx";

// ---------- UHU (unit hour utilization) ----------
//
// UHU here is the straightforward "how long was this team tied up on calls"
// total: for every call a unit was assigned, the stretch from the moment
// dispatch assigned it until the crew went back in service. A call that is
// still running counts up to right now, so the total ticks live while a team
// is out.

// A unit's clock starts when dispatch assigns the call. Boards created before
// times.assigned existed fall back to when the call was created — the same
// instant for anything that was assigned as it was logged.
export function callStartTs(req) {
  return (req.times && req.times.assigned) || req.createdAt || null;
}

export function isCallLive(req) {
  return req.status !== "completed";
}

// The longest a single call may count for.
//
// Nobody is on one call for two days. A call that is still open long after the
// shift it was raised on is not work in progress — it is a call nobody closed,
// and it must not go on earning on-call time for whoever happens to be signed
// on. Left uncapped it did exactly that: an abandoned call showed 48h 50m and
// carried one medic's UHU to 81.7% for a month, on a truck that had been
// standing still. One shift is the ceiling because a shift is the longest
// anybody is on duty for in one stretch.
export const MAX_CALL_MS = SHIFT_MS;

// Normally "Back in Service". If dispatch closed the call before the crew
// finished the timeline, the last stamp they did record is the honest end
// (and if there is none, the call contributed no measurable time) — anything
// else would leave an abandoned call inflating the total forever.
//
// A call still running counts up to now, but never for longer than MAX_CALL_MS.
// The board still shows the true age of an open call, because a call open for
// two days is exactly the thing a desk needs to see; what it must not do is
// count as two days of work.
export function callEndTs(req, now) {
  const t = req.times || {};
  if (t.backInService) return t.backInService;
  if (isCallLive(req)) {
    const start = callStartTs(req);
    return start ? Math.min(now, start + MAX_CALL_MS) : now;
  }
  const stamps = TIME_STEPS.map((s) => t[s.timeKey]).filter(Boolean);
  return stamps.length > 0 ? Math.max(...stamps) : callStartTs(req);
}

export function callBusyMs(req, now) {
  const start = callStartTs(req);
  if (!start) return 0;
  return Math.max(0, callEndTs(req, now) - start);
}

// One row per unit: total time on call, how many calls that covers, and the
// call it is on right now (if any) with that call's running time.
//
// A call a team was sent to as the second ambulance counts too — the truck was
// out and the crew were working, which is the whole point of the measure — but
// only for the stretch they were actually on it, not the call's full length.
// UHU is a measure of this shift, not of all time.
//
// It used to count every call on the board, so a fleet total read "18 calls"
// at the start of a shift that had run one — the rest were the shift before's.
// It also meant a crew who signed out and came back on overtime carried their
// old hours into their new tour, when for the purposes of the next shift they
// are a fresh crew starting at zero.
//
// So: only calls raised inside the current 12-hour window count, and the clock
// starts again at every changeover.
export function uhuWindowStart(now) {
  return shiftWindowAt(now).start;
}

// `from` may be given explicitly. On a live board it is the shift running now;
// on an archived shift printed days later it must be that shift's own window,
// or every call falls outside it and the whole sheet reads nought calls and
// nought per cent — which is exactly what the archive was printing.
export function computeUhu(units, requests, now, from) {
  const cutoff = typeof from === "number" ? from : uhuWindowStart(now);
  const inShift = (requests || []).filter((r) => r && r.createdAt >= cutoff);
  requests = inShift;
  return units.map((unit) => {
    const mine = requests.filter((r) => r.assignedUnitId === unit.id);
    const assisted = requests.filter(
      (r) => r.assignedUnitId !== unit.id && assistTeams(r).some((t) => t.unitId === unit.id)
    );
    const live = mine.find((r) => isCallLive(r)) || assisted.find((r) => isCallLive(r)) || null;
    const assistedMs = assisted.reduce((sum, r) => sum + assistBusyMs(r, unit.id, now), 0);
    return {
      unit,
      calls: mine.length + assisted.length,
      assistCalls: assisted.length,
      totalMs: mine.reduce((sum, r) => sum + callBusyMs(r, now), 0) + assistedMs,
      activeCall: live,
      activeMs: live
        ? live.assignedUnitId === unit.id
          ? callBusyMs(live, now)
          : assistBusyMs(live, unit.id, now)
        : 0,
    };
  });
}

// The same question asked about a person rather than about a truck.
//
// A medic is a vehicle: it keeps working while the people in it change over. A
// total taken per truck and then printed against every name that sat in it
// during the shift handed the crew who came on at seven the three calls the
// crew before them had run — the same figures under two different names, and
// wrong under both. What somebody is answerable for is the time they were
// signed into the seat, so their stay decides. A call counts for them only for
// the stretch of it that ran while they were on, and a call that started and
// finished before they arrived does not count for them at all.
//
// The denominator does not change: it stays the shift, as it is everywhere else
// in this app. Six hours of calls in a twelve-hour shift is fifty per cent, and
// dividing by time-signed-on instead would flatter whoever went home early —
// the same reasoning the monthly per-person figures already carry. Only the
// numerator was wrong, and only the numerator moves.

// When a unit was tied up on one call: its own call from the moment dispatch
// assigned it, or — where it went as the second team — from the moment it was
// sent until it cleared. Null when there is nothing to measure.
export function unitCallInterval(req, unitId, now) {
  if (!req) return null;
  if (req.assignedUnitId === unitId) {
    const start = callStartTs(req);
    return start ? { start, end: callEndTs(req, now) } : null;
  }
  const team = assistTeams(req).find((t) => t.unitId === unitId);
  if (!team || !team.assignedAt) return null;
  return { start: team.assignedAt, end: team.clearedAt || callEndTs(req, now) };
}

export function overlapMs(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

// One person's stay on one medic. `from`/`to` are the shift window the sheet
// covers; `now` is the moment the sheet is taken, which is what an unfinished
// call or an open stay is measured to.
export function computePersonUhu(unit, person, requests, now, from, to) {
  const shiftFrom = typeof from === "number" ? from : uhuWindowStart(now);
  const shiftTo = typeof to === "number" ? to : now;
  const stay = stayWindow(person, now);

  // A stay with no recorded sign-on cannot be placed inside the shift. Rather
  // than credit it with nothing, it is treated as having stood the window —
  // which is the figure the sheet printed before, kept for the one row where
  // there is nothing better to go on.
  const start = Math.max(stay.start || shiftFrom, shiftFrom);
  const end = stay.end || shiftTo;
  const win = { start, end: Math.max(start, end) };

  // The tour this person is measured against, which is the roster's twelve
  // hours — or Zahrawi's nine and a half. It used to be `shiftEnd - shiftStart`
  // off the stamp, which is the same twelve hours for everybody and had no way
  // of knowing Zahrawi is shorter, so Zahrawi's crews were being divided by a
  // shift two and a half hours longer than the one they actually stood.
  const shiftMs = shiftMsForUnit(unit);

  const inShift = (requests || []).filter((r) => r && r.createdAt >= shiftFrom);
  let totalMs = 0;
  // Which calls, not just how many. A person who moved trucks mid-shift is one
  // person with one list, and the aggregate needs the ids to say so.
  const callIds = [];
  inShift.forEach((r) => {
    const iv = unitCallInterval(r, unit.id, now);
    if (!iv) return;
    const ms = overlapMs(iv, win);
    if (ms <= 0) return;
    totalMs += ms;
    callIds.push(r.id);
  });

  return {
    calls: callIds.length,
    callIds,
    totalMs,
    shiftMs,
    pct: shiftMs > 0 ? Math.min(100, (totalMs / shiftMs) * 100) : 0,
  };
}