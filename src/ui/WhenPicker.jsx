
// ---------- picking a date and a time ----------
//
// The browser's own <input type="datetime-local"> was doing this job, and it is
// the wrong tool here for two reasons. It renders in the device's calendar — on
// a tablet set to an Arabic locale that means a Hijri picker, so two desks
// booking the same transfer were reading two different dates — and it hides the
// time behind a spinner that is fiddly to nudge by a quarter of an hour on a
// touchscreen. What follows is a plain Gregorian month grid with the time on
// its own controls, so the date is unambiguous on every device and the time can
// be changed on its own without touching the date.

// Whole five-minute steps: a booking is a slot in a day's work, not a
// stopwatch, and a finer step only makes the minute list longer to scroll.
export const TIME_STEP_MIN = 5;

// The near hours of today — the case the desk hits most: a transfer phoned
// through for later this afternoon rather than for another day.
export const RELATIVE_PICKS = [
  { label: "+30 min", ms: 30 * 60 * 1000 },
  { label: "+1 hour", ms: 60 * 60 * 1000 },
  { label: "+2 hours", ms: 2 * 60 * 60 * 1000 },
  { label: "+4 hours", ms: 4 * 60 * 60 * 1000 },
];

// A booking has to be at least this far ahead. A time that has already gone
// would be released the instant it was saved, which is a call phoned in, not
// something booked — and it could never give the desk its quarter-hour warning.
export const MIN_LEAD_MS = 60 * 1000;