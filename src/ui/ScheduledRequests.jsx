import { stationOf } from "../domain/live-sheet.jsx";
import { opDayStart } from "../domain/op-day.jsx";
import { hhmm, scheduledShiftKey, shiftMeta } from "../domain/shift-helpers.jsx";
import { SHIFTS } from "../domain/shifts.jsx";
import { MONTH_LABELS, WEEKDAY_LABELS, gregLongDateStr } from "../lib/dates.jsx";
import { useEffect, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";
import { MIN_LEAD_MS, RELATIVE_PICKS, TIME_STEP_MIN } from "./WhenPicker.jsx";
import { nextShiftStartTs, startOfDay, untilStr } from "./booking-cancel.jsx";

// ---------- scheduled (future) requests ----------
//
// Not every transfer is an emergency. A good part of the work is booked ahead:
// an appointment on the next shift, a discharge tomorrow morning, a theatre
// transfer at a known time. Those live on their own board key (`ems:scheduled`)
// rather than in the live call list, so a booking made for 07:00 tomorrow can
// be planned and given a team today without showing up as an active call or
// setting a crew's alarm off. When its time arrives the booking is turned into
// an ordinary call — at which point every existing path takes over: the team
// pre-assigned to it is dispatched, their screen alarms, and the call runs
// through the normal timeline.
export const SCHED_STATUS = {
  scheduled: { label: "SCHEDULED", color: "var(--flow)" },
  releasing: { label: "DISPATCHING…", color: "var(--hold)" },
  released: { label: "DISPATCHED", color: "var(--ok)" },
  cancelled: { label: "CANCELLED", color: "#64748B" },
};

// ---------- what is already booked ----------
//
// The desk was booking blind. The form asked for a date and a time and said
// nothing about the four transfers already sitting at that time, so two
// bookings for one slot were only discovered on the day, by the crew.
//
// Bookings do not clash the way appointments do — a station with five trucks
// can legitimately send three at two o'clock — so nothing here blocks a
// booking. What it does is put the answer in front of whoever is typing: the
// times already taken on that day, and a plain warning when the time being
// picked already has company. The desk can still go ahead; what it cannot do
// any more is go ahead without knowing.
export const BOOKING_CLASH_MS = 30 * 60 * 1000;

// A booking that still expects an ambulance. One already sent out, or called
// off, is not competing for anything.
export function bookingIsLive(s) {
  return !!(s && s.scheduledFor && !s.cancelledAt && !s.releasedAt);
}

export function bookingsOnDay(list, station, ts) {
  if (!ts) return [];
  const day = opDayStart(ts);
  return (list || [])
    .filter((s) => bookingIsLive(s) && stationOf(s) === station && opDayStart(s.scheduledFor) === day)
    .sort((a, b) => a.scheduledFor - b.scheduledFor);
}

export function bookingsNear(list, station, ts, ignoreId) {
  if (!ts) return [];
  return (list || [])
    .filter(
      (s) =>
        bookingIsLive(s) &&
        stationOf(s) === station &&
        s.id !== ignoreId &&
        Math.abs(s.scheduledFor - ts) <= BOOKING_CLASH_MS
    )
    .sort((a, b) => a.scheduledFor - b.scheduledFor);
}

export function startOfMonth(ts) {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addMonths(ts, n) {
  const d = new Date(startOfMonth(ts));
  d.setMonth(d.getMonth() + n);
  return d.getTime();
}

// The six-week block a month is drawn in: from the Sunday on or before the 1st
// to the Saturday on or after the last day, so the grid never changes height as
// the desk pages through months.
export function monthGrid(monthTs) {
  const first = new Date(startOfMonth(monthTs));
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const cell = new Date(start);
      cell.setDate(start.getDate() + w * 7 + d);
      week.push(cell.getTime());
    }
    weeks.push(week);
  }
  return weeks;
}

// A date from one place and a time from another, which is exactly how the
// picker is used: page to a day, then set the hour.
export function withTimeOfDay(dayTs, hours, minutes) {
  const d = new Date(dayTs);
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

export function roundUpToStep(ts) {
  const d = new Date(ts);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / TIME_STEP_MIN) * TIME_STEP_MIN);
  return d.getTime();
}

// The earliest slot that can still be booked — used to snap a same-day pick
// forward when the hour that was already in the form has since passed.
export function earliestBookableTs(now) {
  return roundUpToStep(now + MIN_LEAD_MS);
}

// A Gregorian month grid plus the hour and minute of the day, over one
// timestamp. `value` is a number of milliseconds or null; every change comes
// back through onChange as a number.
export function WhenPicker({ value, onChange, now, hint }) {
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(value || now));
  const monthOfValue = value ? startOfMonth(value) : 0;

  // Quick picks and the relative chips can land in another month; the grid
  // follows them rather than leaving the chosen day off screen.
  useEffect(() => {
    if (monthOfValue) setMonthAnchor(monthOfValue);
  }, [monthOfValue]);

  const selected = value || null;
  const selectedDay = selected ? startOfDay(selected) : null;
  const today = startOfDay(now);
  const current = new Date(selected || earliestBookableTs(now));
  const hours = current.getHours();
  const minutes = current.getMinutes();

  function pickDay(dayTs) {
    // Keep the time that was already set and just move the date. If that lands
    // in the past — picking today when the hour on the form has gone by — the
    // time moves up to the next bookable slot instead of quietly saving
    // something that would fire immediately.
    const next = withTimeOfDay(dayTs, hours, minutes);
    onChange(next < now + MIN_LEAD_MS ? earliestBookableTs(now) : next);
  }

  function setTime(h, m) {
    onChange(withTimeOfDay(selectedDay || today, h, m));
  }

  // The ± buttons walk the time in quarters and hours — how a booking is
  // usually adjusted once it exists ("push it back an hour"). Walking backwards
  // stops at the earliest slot still bookable rather than going into the past.
  function nudge(mins) {
    const next = (selected || earliestBookableTs(now)) + mins * 60000;
    onChange(Math.max(next, earliestBookableTs(now)));
  }

  const minuteOptions = [];
  for (let m = 0; m < 60; m += TIME_STEP_MIN) minuteOptions.push(m);
  // A minute that isn't on the step (an older booking saved at 14:37) stays
  // selectable rather than being silently rounded on open.
  if (!minuteOptions.includes(minutes)) minuteOptions.push(minutes);
  minuteOptions.sort((a, b) => a - b);

  return (
    <div style={styles.whenPicker}>
      <div style={styles.whenReadoutRow}>
        <div>
          <div style={styles.whenReadoutTime}>{selected ? hhmm(selected) : "--:--"}</div>
          <div style={styles.whenReadoutDate}>
            {selected ? gregLongDateStr(selected) : "No date picked"}
            <span style={styles.whenCalTag}>Gregorian</span>
          </div>
        </div>
        {selected && (
          <div style={styles.whenReadoutSide}>
            <div style={selected <= now ? styles.staffingWarn : styles.whenReadoutUntil}>
              {untilStr(selected, now)}
            </div>
            {(() => {
              const meta = shiftMeta(scheduledShiftKey(selected));
              return meta ? (
                <div style={{ ...styles.shiftTag, color: meta.color, borderColor: meta.color }}>
                  {meta.glyph} {meta.label}
                </div>
              ) : null;
            })()}
          </div>
        )}
      </div>

      <div style={styles.whenSection}>
        <div style={styles.whenSectionLabel}>Date</div>
        <div style={styles.calHeader}>
          <button
            type="button"
            style={styles.calNavBtn}
            onClick={() => setMonthAnchor((m) => addMonths(m, -1))}
            aria-label="Previous month"
          >
            ‹
          </button>
          <div style={styles.calMonthLabel}>
            {MONTH_LABELS[new Date(monthAnchor).getMonth()]} {new Date(monthAnchor).getFullYear()}
          </div>
          <button
            type="button"
            style={styles.calNavBtn}
            onClick={() => setMonthAnchor((m) => addMonths(m, 1))}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
        <div style={styles.calWeekRow}>
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} style={styles.calWeekday}>{d.slice(0, 2)}</div>
          ))}
        </div>
        {monthGrid(monthAnchor).map((week, i) => (
          <div key={i} style={styles.calWeekRow}>
            {week.map((dayTs) => {
              const inMonth = new Date(dayTs).getMonth() === new Date(monthAnchor).getMonth();
              const isPast = dayTs < today;
              const isToday = dayTs === today;
              const isSelected = selectedDay === dayTs;
              return (
                <button
                  type="button"
                  key={dayTs}
                  disabled={isPast}
                  onClick={() => pickDay(dayTs)}
                  style={{
                    ...styles.calDay,
                    ...(inMonth ? null : styles.calDayOutside),
                    ...(isPast ? styles.calDayPast : null),
                    ...(isToday ? styles.calDayToday : null),
                    ...(isSelected ? styles.calDaySelected : null),
                  }}
                >
                  {new Date(dayTs).getDate()}
                </button>
              );
            })}
          </div>
        ))}
        <div style={styles.quickPickRow}>
          <button type="button" style={styles.quickPickBtn} onClick={() => pickDay(today)}>
            Today
          </button>
          <button type="button" style={styles.quickPickBtn} onClick={() => pickDay(today + 86400000)}>
            Tomorrow
          </button>
          <button
            type="button"
            style={styles.quickPickBtn}
            onClick={() => setMonthAnchor(startOfMonth(now))}
          >
            This month
          </button>
        </div>
      </div>

      <div style={styles.whenSection}>
        <div style={styles.whenSectionLabel}>Time (24h)</div>
        <div style={styles.whenTimeRow}>
          <select
            style={styles.whenTimeSelect}
            value={hours}
            onChange={(e) => setTime(Number(e.target.value), minutes)}
            aria-label="Hour"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, "0")}</option>
            ))}
          </select>
          <span style={styles.whenTimeColon}>:</span>
          <select
            style={styles.whenTimeSelect}
            value={minutes}
            onChange={(e) => setTime(hours, Number(e.target.value))}
            aria-label="Minute"
          >
            {minuteOptions.map((m) => (
              <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
            ))}
          </select>
          <div style={styles.whenNudgeGroup}>
            {[-60, -15, 15, 60].map((mins) => (
              <button
                type="button"
                key={mins}
                style={styles.whenNudgeBtn}
                onClick={() => nudge(mins)}
              >
                {mins > 0 ? `+${mins}m` : `${mins}m`}
              </button>
            ))}
          </div>
        </div>
        <div style={styles.quickPickRow}>
          {RELATIVE_PICKS.map((p) => (
            <button
              type="button"
              key={p.label}
              style={styles.quickPickBtn}
              onClick={() => onChange(roundUpToStep(now + p.ms))}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            style={styles.quickPickBtn}
            onClick={() => onChange(nextShiftStartTs("day", now))}
          >
            {SHIFTS.day.glyph} Next day shift
          </button>
          <button
            type="button"
            style={styles.quickPickBtn}
            onClick={() => onChange(nextShiftStartTs("night", now))}
          >
            {SHIFTS.night.glyph} Next night shift
          </button>
        </div>
      </div>

      {hint && <InfoNote>{hint}</InfoNote>}
    </div>
  );
}