import { shortDurationStr } from "../domain/messages.jsx";
import { isRecurring } from "../domain/return-journeys.jsx";
import { hhmm, shiftMeta } from "../domain/shift-helpers.jsx";
import { SHIFTS } from "../domain/shifts.jsx";
import { gregDayMonthStr, gregLongDateStr } from "../lib/dates.jsx";
import { SCHED_STATUS } from "./ScheduledRequests.jsx";

// ---------- why a booking was cancelled ----------
//
// A cancelled booking is the one thing on the forward book with no times
// against it to explain itself: it was taken, it never went out, and the row on
// the export carries nothing but a name. So the desk is asked for the reason at
// the moment it cancels — the banner on the card will not let the cancellation
// through without one — and the answer is kept on the booking, said on the card,
// written into the event log and carried out onto the Scheduled Requests sheet
// of the shared workbook.
//
// The list below is the reasons the desk actually gives, one press each on a
// touchscreen at three in the morning. Anything not on it is typed into the same
// box: the chips fill the box rather than replacing it, so a picked reason can
// still be added to.
export const SCHED_CANCEL_REASONS = [
  "Patient no longer requires transfer",
  "Ward cancelled the request",
  "Appointment cancelled",
  "Patient discharged",
  "Patient deceased",
  "Patient not fit to travel",
  "Transferred by other means",
  "Booked in error / duplicate",
];

// The longest a reason can be. Long enough for a sentence explaining an unusual
// cancellation, short enough that the export column stays readable.
export const SCHED_CANCEL_REASON_MAX = 200;

// What the record says a booking was cancelled for. Bookings cancelled before
// this was asked for have no reason on them, and the export says so plainly
// rather than leaving the cell blank next to a name — a blank reads as "nobody
// filled it in", which is a different thing from "this was never asked".
export function schedCancelReason(s) {
  const reason = s && typeof s.cancelReason === "string" ? s.cancelReason.trim() : "";
  return reason;
}

// Anything inside this window of its dispatch time is flagged on the desk.
export const SCHED_DUE_SOON_MS = 30 * 60 * 1000;

// How far ahead of its time a booking chimes on the dispatch desk. A quarter of
// an hour is long enough to raise a crew on the radio, confirm the patient is
// ready and hand the job over — and short enough that the reminder still means
// "now" rather than "later today".
export const SCHED_PREALERT_MS = 15 * 60 * 1000;

// The reminder is checked on its own clock rather than off the board poll, so
// it fires within a few seconds of T-15 even on a desk nobody is touching.
export const SCHED_PREALERT_TICK_MS = 10000;

// Releasing a booking is a read, a write and a read-back: whichever open board
// writes its own id last owns the release, so five dispatch screens polling at
// once raise one call rather than five. A claim older than this is treated as
// abandoned (the board that took it was closed or lost its connection
// mid-release) and the booking becomes releasable again — otherwise a single
// dropped write would strand the booking forever.
export const SCHED_CLAIM_MS = 20000;

export function schedStatusMeta(status) {
  return SCHED_STATUS[status] || SCHED_STATUS.scheduled;
}

// Still waiting to go out: either untouched, or left behind by a board that
// claimed it and never finished.
export function schedOpen(s, now) {
  if (!s) return false;
  if (s.status === "scheduled") return true;
  return s.status === "releasing" && now - (s.claimedAt || 0) > SCHED_CLAIM_MS;
}

// A booking with no time on it: the ward could not say when the patient will be
// ready and will phone the desk instead. It sits on the schedule waiting for
// that call and is never released by the clock — only by someone pressing
// "patient ready" on the desk, which stamps a time on it and sends it out.
export function schedAwaitCall(s) {
  return !!s && !s.scheduledFor;
}

// Due out now. A booking awaiting a phone call has no time to fall due, so it is
// excluded here rather than being treated as a booking for 1970 and released the
// second it is saved.
// When a booking should go out.
//
// A booking has an appointment time — when the patient is expected somewhere —
// and, optionally, a dispatch time: when the ambulance has to leave to get them
// there. Where a dispatch time is given, the call is raised fifteen minutes
// before it, so the crew are told before they are needed rather than at the
// moment they are already late.
//
// Optional on purpose. Most transfers within the campus need no lead time at
// all, and a booking without one behaves exactly as it always has.
export const SCHED_LEAD_MS = 15 * 60 * 1000;

// When the call card goes out — fifteen minutes before the truck has to leave.
//
// The time a booking LEAVES is `dispatchAt` where the desk gave one, and the
// appointment time where it did not: with no dispatch time, the appointment
// time is the only time anybody knows, so it is the time the crew is working
// back from. Either way the card is raised `SCHED_LEAD_MS` ahead of it, so the
// crew get the same notice whichever way the booking was taken.
//
// The lead used to be applied only to `dispatchAt`. A booking with no dispatch
// time was raised AT its appointment time, which is the moment the patient was
// due to be somewhere else — the crew were told about it exactly as late as it
// is possible to be told.
export function schedLeaveAt(s) {
  if (!s) return 0;
  return s.dispatchAt || s.scheduledFor || 0;
}

export function schedReleaseAt(s) {
  const leaves = schedLeaveAt(s);
  return leaves ? leaves - SCHED_LEAD_MS : 0;
}

// A standing arrangement is not an appointment, and must never be dispatched.
//
// It used to be: the template carried a real date and time, the release loop
// saw it fall due like any other booking, and sent it out. The record left
// behind was an arrangement stamped DISPATCHED with the date it was set up on —
// so Schedule → Repeating showed "Sun 23 Aug 07:15 · DISPATCHED" for a dialysis
// run that goes out three times a week, for ever. It also sat in Upcoming,
// taking up room, as a booking that had already gone.
//
// The template is the arrangement now and nothing else. What goes out is the
// occurrence it throws off for the day — see `repeatOccurrencesDue`.
export function schedIsTemplate(s) {
  return !!(s && isRecurring(s) && !s.repeatOf);
}

// The day's copy of an arrangement — what the template threw off for today, and
// the thing that actually goes out.
//
// It is a real booking and is released like any other, but it is not something
// the desk booked: it belongs to an arrangement somebody set up once, and it is
// already visible in Schedule → Repeating, where the patient's card says which
// days they run and when they are next in. Listed in Upcoming as well it read
// as a second, separate booking for the same patient — a dialysis run appearing
// twice on a board the desk is trying to read at a glance. So Upcoming carries
// what the desk booked; the arrangement carries the rest, and the day's copy
// surfaces at its time, as a call card, once.
export function schedIsOccurrence(s) {
  return !!(s && s.repeatOf);
}

// A stopped arrangement stops.
//
// The pass that throws off the day's copy picked its templates on shape alone —
// "has repeat days, is not a return leg, is not itself a copy" — and never
// looked at whether the arrangement was still wanted. So cancelling a standing
// transfer took it off the Repeating tab, which filters cancelled ones out, and
// changed nothing else: it went on producing a call every one of its days, for
// ever, from a card the desk could no longer see to stop it a second time.
export function schedRepeatIsLive(s) {
  return schedIsTemplate(s) && s.status !== "cancelled";
}

export function schedDue(s, now) {
  if (schedAwaitCall(s)) return false;
  if (schedIsTemplate(s)) return false;
  return schedOpen(s, now) && schedReleaseAt(s) <= now;
}

// "Today 14:30" / "Tomorrow 07:00" / "Mon 3 Nov 19:00" — the dispatch time in
// the shortest form that is still unambiguous. Gregorian throughout, by way of
// gregDayMonthStr.
export function whenStr(ts) {
  if (!ts) return "—";
  const days = dayOffset(ts, Date.now());
  const time = hhmm(ts);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  return `${gregDayMonthStr(ts)} ${time}`;
}

// Whole calendar days between two instants, counted off midnight rather than
// by dividing the gap — so 23:50 to 00:10 is one day apart, not none.
export function dayOffset(ts, from) {
  return Math.round((startOfDay(ts) - startOfDay(from)) / 86400000);
}

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// "Today · Saturday 1 August 2026" — the day headings the schedule ahead is
// broken up by, so a week of bookings reads as a calendar rather than a list.
export function dayHeadingStr(ts, now) {
  const days = dayOffset(ts, now);
  const long = gregLongDateStr(ts);
  if (days === 0) return `Today · ${long}`;
  if (days === 1) return `Tomorrow · ${long}`;
  if (days === -1) return `Yesterday · ${long}`;
  return long;
}

// "in 2h 15m" / "6m overdue" — how long until (or since) a booking is due out.
export function untilStr(ts, now) {
  if (!ts) return "";
  const delta = ts - now;
  if (delta <= 0) return `${shortDurationStr(-delta)} overdue`;
  return `in ${shortDurationStr(delta)}`;
}

// The next time `shiftKey` starts after `from` — what the "next day shift" /
// "next night shift" quick picks on the booking form fill in.
export function nextShiftStartTs(shiftKey, from) {
  const shift = shiftMeta(shiftKey) || SHIFTS.day;
  const d = new Date(from);
  d.setHours(shift.startHour, 0, 0, 0);
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// Rounded up to the next quarter hour, an hour out — the form's opening value.
export function defaultScheduleTs(now) {
  const d = new Date(now + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  return d.getTime();
}