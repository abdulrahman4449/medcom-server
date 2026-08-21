import { STATIONS, stationOf } from "./live-sheet.jsx";
import { gregDateStr } from "../lib/dates.jsx";
import { uid } from "../lib/helpers.jsx";
import { readKey, writeKey } from "../lib/offline-queue.jsx";

// ---------- the operational day ----------
//
// A day here is not midnight to midnight. It runs 07:00 to 07:00: the day shift
// and the night shift that follows it are one working day, and a call taken at
// 02:00 belongs to the day that started the evening before. This is already how
// shift dates are filed on the sheet, so the archive uses the same boundary
// rather than inventing a second idea of what "6 August" means.
export const OP_DAY_START_HOUR = 7;
export const ARCHIVE_KEY = "ems:archives";
// Archives are the permanent record, so the cap is generous. Roughly a year of
// days: old ones fall off the end rather than growing without limit.
export const ARCHIVE_CAP = 400;

export function opDayStart(ts) {
  const d = new Date(ts);
  const start = new Date(d);
  start.setHours(OP_DAY_START_HOUR, 0, 0, 0);
  // Before 07:00 we are still inside the day that began yesterday morning.
  if (d.getHours() < OP_DAY_START_HOUR) start.setDate(start.getDate() - 1);
  return start.getTime();
}

export function opDayEnd(startTs) {
  const d = new Date(startTs);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

// A stable key for a day, independent of how dates are displayed.
export function opDayKey(startTs) {
  const d = new Date(startTs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function opDayLabel(startTs) {
  return gregDateStr(startTs);
}

// A call belongs to the day it was raised on. Not the day it finished: a call
// dispatched at 06:30 and cleared at 08:15 was that night's call, and moving it
// into the next day would leave a hole where it happened and count it twice
// across the two days' figures.
export function callOpDayStart(r) {
  return r && r.createdAt ? opDayStart(r.createdAt) : null;
}

export function requestsForOpDay(requests, dayStart) {
  return (requests || []).filter((r) => callOpDayStart(r) === dayStart);
}

export function logForOpDay(log, dayStart) {
  const end = opDayEnd(dayStart);
  return (log || []).filter((e) => e && e.ts >= dayStart && e.ts < end);
}

// Is there anything still running from that day? Used only for the early close —
// the clock closes the day either way.
export function opDayIsQuiet(requests, units, dayStart) {
  const stillOpen = requestsForOpDay(requests, dayStart).some((r) => r.status !== "completed");
  if (stillOpen) return false;
  // Nobody still signed on anywhere. A crew who has not signed out is still on
  // duty as far as the board is concerned.
  const anyoneOn = (units || []).some((u) => u && (u.alpha || u.bravo));
  return !anyoneOn;
}

// Close a day and keep it. What is stored is the data the sheet is built from,
// not a spreadsheet file: the workbook is generated when somebody downloads it,
// so an archive from March still comes out in whatever format the sheet has
// today rather than being frozen in the format it had then.
//
// Two desks can be open at 07:00, so the day is claimed the same way a booking
// release is: write it with this board's id, read it back, and only the board
// whose id survived is the one that wrote it. The loser leaves it alone.
export async function archiveOpDay({ dayStart, requests, units, log, scheduled, closedBy, reason, boardId }) {
  const existing = (await readKey(ARCHIVE_KEY, [])) || [];
  const key = opDayKey(dayStart);
  if (existing.some((a) => a && a.dayKey === key)) return false;

  const dayRequests = requestsForOpDay(requests, dayStart);
  const entry = {
    id: uid("arch"),
    dayKey: key,
    dayStart,
    dayEnd: opDayEnd(dayStart),
    closedAt: Date.now(),
    closedBy: closedBy || "",
    reason: reason || "clock",
    claimId: boardId,
    // A call that was still running when the day closed is kept as it stood and
    // said so on the sheet. Its remaining times are picked up on download.
    requests: dayRequests.map((r) => ({ ...r, openAtClose: r.status !== "completed" })),
    log: logForOpDay(log, dayStart),
    scheduled: (scheduled || []).filter((s) => s && s.scheduledFor && opDayStart(s.scheduledFor) === dayStart),
    // The rosters as they stood, so the name stamps on the sheet still resolve
    // years later even if a medic has since been renamed or retired.
    units: (units || []).map((u) => ({ ...u })),
    counts: STATIONS.reduce((acc, st) => {
      acc[st.key] = dayRequests.filter((r) => stationOf(r) === st.key).length;
      return acc;
    }, {}),
  };

  const next = [entry, ...existing].slice(0, ARCHIVE_CAP);
  const ok = await writeKey(ARCHIVE_KEY, next);
  if (!ok) return false;

  // Read back and see whose claim survived.
  const after = (await readKey(ARCHIVE_KEY, [])) || [];
  const mine = after.find((a) => a && a.dayKey === key);
  return !!(mine && mine.claimId === boardId);
}

// Has this day actually finished?
//
// The clock is not the whole answer. A call raised at 05:40 that is still
// running at 08:00 belongs to the day that has just ended — the crew are still
// on it, the times are still being stamped, and archiving the day now would
// keep a half-written call and call it the record. So a day is finished when
// the clock has passed it *and* every call raised on it is closed.
//
// Crews are deliberately not part of this test. A crew signed on at 07:00 is
// working the new day, not holding the old one open, and the administrator does
// not have to sign out for the day to be kept — this runs on its own.
export function opDayComplete(requests, dayStart, now) {
  if (now < opDayEnd(dayStart)) return false;
  return requestsForOpDay(requests, dayStart).every((r) => r && r.status === "completed");
}

// Which days are finished but not yet kept. Normally none or one; more than one
// only if no desk was open for a few days, in which case they are all caught up
// at once rather than quietly skipped.
export function unarchivedOpDays(requests, archives, now) {
  const today = opDayStart(now);
  const have = new Set((archives || []).map((a) => a && a.dayKey));
  const days = new Set();
  (requests || []).forEach((r) => {
    const d = callOpDayStart(r);
    // Only days that are actually over. The day in progress is not archived.
    if (d && d < today && !have.has(opDayKey(d))) days.add(d);
  });
  return Array.from(days).sort((a, b) => a - b);
}