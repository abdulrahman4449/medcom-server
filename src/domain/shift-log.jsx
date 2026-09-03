import { COVERAGE_KEY, coverageGapsIn } from "./coverage.jsx";
import { stationOf } from "./live-sheet.jsx";
import { opDayKey, opDayLabel, opDayStart } from "./op-day.jsx";
import { shiftWindowAt } from "./shift-helpers.jsx";
import { SHIFTS, SHIFT_MS } from "./shifts.jsx";
import { readKey, writeKey } from "../lib/offline-queue.jsx";

// ---------- submitting a shift's log ----------
//
// The desk submits its own log at the end of its own shift. Two submissions make
// a day: the day shift's and the night shift's, filed under the same operational
// date, and each station files separately — so 6 August holds up to four, one
// per shift per station.
//
// A submission is not always finished when it is made. A call raised at 06:30
// that is still running at 07:00 belongs to the shift that took it, but its
// remaining times and the crew's overtime are not known yet. So the desk submits
// and goes home; the submission stays open in the background and completes
// itself once that call is closed and its crew has signed out. Nobody has to
// come back and do anything.
export const SUBMISSION_KEY = "ems:submissions";
export const SUBMISSION_CAP = 600;

export function submissionId(dayStart, shiftKey, station) {
  return `${opDayKey(dayStart)}::${shiftKey}::${station}`;
}

// Every call this desk's shift is answerable for: raised inside the shift
// window, at this station. A call belongs to the shift that took it, not the
// one that happened to be on when it finished.
export function requestsForShift(requests, station, windowStart, windowEnd) {
  return (requests || []).filter(
    (r) =>
      stationOf(r) === station &&
      r.createdAt >= windowStart &&
      r.createdAt < windowEnd
  );
}

// Whether anybody who worked THIS shift is still in a seat at the station.
//
// The automatic filing used to ask "is anyone at the station seated?" — and at
// a station that runs around the clock the answer is always yes: the night
// crew signs on before the day shift ends, so the day log could never file,
// and the morning board read "0 filed" under an operational day the archive
// had kept perfectly well. A seat holds a shift's log open only if the person
// in it signed on FOR that shift (the seat carries `shiftStart`; an older seat
// with none is placed by when it was signed on). A seat still held one whole
// shift after the window closed is a forgotten sign-out, not a shift still
// running, and stops holding the log open — the sign-off, when it comes, is
// picked up by the re-cut like any other late line.
export function unitsStaffedForShift(units, station, windowStart, windowEnd, now = Date.now()) {
  if (!windowStart || !windowEnd || now >= windowEnd + SHIFT_MS) return [];
  return (units || []).filter((u) => {
    if (!u || stationOf(u) !== station) return false;
    return ["alpha", "bravo"].some((slot) => {
      const m = u[slot];
      if (!m) return false;
      if (m.shiftStart) return m.shiftStart === windowStart;
      const on = m.signedOnAt || 0;
      return on >= windowStart && on < windowEnd;
    });
  });
}

export function shiftStillStaffed(units, station, windowStart, windowEnd, now = Date.now()) {
  return unitsStaffedForShift(units, station, windowStart, windowEnd, now).length > 0;
}

export function logForShift(log, station, windowStart, windowEnd) {
  return (log || []).filter(
    (e) => e && e.ts >= windowStart && e.ts < windowEnd && stationOf(e) === station
  );
}

// Which shift a log line belongs to — one shift, never two.
//
// Both re-cuts below used to end the window at `Date.now()`, to pick up the
// closing stamps and the sign-outs that landed after the desk submitted. It
// works for the ten minutes that usually is, and it is wrong for everything
// else: a day shift finalised at 21:00 swallowed the night crew's 19:00 sign-on,
// which is also in the night shift's own submission — the same line filed under
// two shifts and printed on two sheets. A submission held open by a call still
// running took DAYS of that station's lines the same way.
//
// A line that NAMES a shift belongs to that shift wherever its clock time
// falls: an Alpha signing off at 19:40 in overtime worked the day shift, and
// filing that line under the night crew as well is the same duplication from
// the other end. Everything else belongs to the window its timestamp falls in.
//
// The named shift is resolved through `shiftWindowAt` rather than compared
// outright, because a shift start is not always a window start — Zahrawi
// stands 09:30 — and a line that matched no window at all would be filed
// under nothing and lost from every sheet.
export function logShiftHome(entry) {
  if (!entry || !entry.ts) return null;
  const d = entry.detail;
  const named = d && d.shiftStart;
  return shiftWindowAt(named || entry.ts).start;
}

export function logForFiledShift(log, station, windowStart, windowEnd) {
  const home = shiftWindowAt(windowStart).start;
  return (log || []).filter(
    (e) => e && stationOf(e) === station && logShiftHome(e) === home
  );
}

// What is still outstanding on a submission: calls not closed, and crews from
// those calls not yet signed out. While either is true the submission is held
// open and its overtime is not final.
//
// "Crews still on" means THIS shift's crews — the same rule as the automatic
// filing (`shiftStillStaffed`). Counting every seat at the station held a day
// log open all night behind the night crew, its overtime never final, and the
// board never allowed to tidy its calls away.
export function submissionOutstanding(sub, requests, units, now = Date.now()) {
  const ids = new Set((sub.requestIds || []));
  const openCalls = (requests || []).filter((r) => ids.has(r.id) && r.status !== "completed");
  const crewStillOn = unitsStaffedForShift(units, sub.station, sub.windowStart, sub.windowEnd, now);
  return { openCalls, crewStillOn };
}

// The desk submitting its shift. Safe to press with a call still running: what
// is known now is filed, and what is not yet known is marked as still open. The
// background pass below finishes it off later.
export async function submitShiftLog({ requests, units, log, scheduled, station, windowStart, windowEnd, shiftKey, by, coverageList }) {
  const all = (await readKey(SUBMISSION_KEY, [])) || [];
  const dayStart = opDayStart(windowStart);
  const id = submissionId(dayStart, shiftKey, station);
  if (all.some((s) => s && s.id === id)) return { ok: false, reason: "already" };

  const mine = requestsForShift(requests, station, windowStart, windowEnd);
  const openIds = mine.filter((r) => r.status !== "completed").map((r) => r.id);

  // The gaps have to come from somewhere. Neither caller was passing a list, so
  // every submission was filed with an empty one and every sheet printed off it
  // said the station had never been without an ambulance — including the
  // shifts where it plainly had. A caller that holds the list can still hand it
  // over; one that doesn't gets it from the same store the panel reads.
  const gaps = coverageList || (await readKey(COVERAGE_KEY, [])) || [];

  const entry = {
    id,
    dayKey: opDayKey(dayStart),
    dayStart,
    dayLabel: opDayLabel(dayStart),
    shiftKey,
    shiftLabel: SHIFTS[shiftKey] ? SHIFTS[shiftKey].label : shiftKey,
    station,
    windowStart,
    windowEnd,
    submittedAt: Date.now(),
    submittedBy: by || "",
    // Open until every call it covers is closed and the crews are off.
    status: openIds.length ? "open" : "final",
    requestIds: mine.map((r) => r.id),
    openRequestIds: openIds,
    // The snapshot as submitted. The live record is preferred on download when
    // it has moved on, and the sheet says so.
    requests: mine.map((r) => ({ ...r })),
    log: logForFiledShift(log, station, windowStart, windowEnd),
    scheduled: (scheduled || []).filter(
      (s) => s && stationOf(s) === station && s.scheduledFor >= windowStart && s.scheduledFor < windowEnd
    ),
    units: (units || []).filter((u) => stationOf(u) === station).map((u) => ({ ...u })),
    // The gaps that happened on this shift travel with it, so a submitted log
    // carries its own evidence rather than depending on a live list.
    coverage: coverageGapsIn(gaps, station, windowStart, windowEnd),
    callCount: mine.length,
  };

  const next = [entry, ...all].slice(0, SUBMISSION_CAP);
  const ok = await writeKey(SUBMISSION_KEY, next);
  return { ok, entry, openCount: openIds.length };
}

// Finishing off submissions that were filed with a call still running. Runs in
// the background on any desk or admin board: once the last call is closed and
// the station's crews are signed out, the submission is completed — its calls
// refreshed to their final times and the overtime that was still accruing when
// it was submitted now counted.
// A shift filed by hand before its window closed still has to take whatever the
// rest of the window brings. Without this, a desk that submitted at 16:00
// because it looked finished would leave every later call off the sheet — and
// nobody would notice until the month was counted.
export async function amendSubmissionsWithLateCalls({ requests, log }) {
  const all = (await readKey(SUBMISSION_KEY, [])) || [];
  if (!all.length) return 0;
  let changed = 0;
  const next = all.map((sub) => {
    if (!sub) return sub;
    const known = new Set(sub.requestIds || []);
    const late = requestsForShift(requests, sub.station, sub.windowStart, sub.windowEnd)
      .filter((r) => !known.has(r.id));
    if (!late.length) return sub;
    changed += 1;
    const merged = [...(sub.requests || []), ...late.map((r) => ({ ...r }))];
    const stillOpen = merged.filter((r) => r.status !== "completed").map((r) => r.id);
    return {
      ...sub,
      requestIds: merged.map((r) => r.id),
      requests: merged,
      openRequestIds: stillOpen,
      // Taking on a call that has not finished re-opens the submission, so the
      // overtime is counted when it does.
      status: stillOpen.length ? "open" : sub.status,
      callCount: merged.length,
      log: logForFiledShift(log, sub.station, sub.windowStart, sub.windowEnd),
      amendedAt: Date.now(),
      amendedCount: (sub.amendedCount || 0) + late.length,
    };
  });
  if (!changed) return 0;
  await writeKey(SUBMISSION_KEY, next);
  return changed;
}

export async function finaliseOpenSubmissions({ requests, units, log, boardId }) {
  const all = (await readKey(SUBMISSION_KEY, [])) || [];
  const open = all.filter((s) => s && s.status === "open");
  if (!open.length) return 0;

  let changed = 0;
  const next = all.map((s) => {
    if (!s || s.status !== "open") return s;
    const { openCalls, crewStillOn } = submissionOutstanding(s, requests, units);
    if (openCalls.length || crewStillOn.length) return s;
    changed += 1;
    const byId = new Map((requests || []).map((r) => [r.id, r]));
    return {
      ...s,
      status: "final",
      finalisedAt: Date.now(),
      finalisedBy: boardId,
      openRequestIds: [],
      requests: (s.requestIds || []).map((id) => {
        const live = byId.get(id);
        return live ? { ...live } : (s.requests || []).find((r) => r.id === id);
      }).filter(Boolean),
      // The log is re-cut at completion so the closing stamps and the sign-outs
      // that happened after submission are in the record too.
      log: logForFiledShift(log, s.station, s.windowStart, s.windowEnd),
    };
  });

  if (!changed) return 0;
  await writeKey(SUBMISSION_KEY, next);
  return changed;
}