import { callRoute } from "../domain/call-locations.jsx";
import { PRIORITY, PRIORITY_CHOICES, REQUIREMENTS, REQ_STATUS, priorityKeyOf } from "../domain/constants.jsx";
import { DEFAULT_STATION, stationLabel } from "../domain/live-sheet.jsx";
import { buzz, clockStr, shortDurationStr } from "../domain/messages.jsx";
import { DAY_SHORT, RETURN_MODES, groupRepeatsByPatient, isOutLeg, isRecurring, isReturnLeg, nextRepeatAt, repeatDays, repeatLabel, repeatPatientKey, wantsReturn } from "../domain/return-journeys.jsx";
import { callTypeMeta, loadedKmMeta } from "../domain/sheet-vocabulary.jsx";
import { crewShiftSummary, hhmm, scheduledShiftKey, shiftMeta, shiftWindowAt } from "../domain/shift-helpers.jsx";
import { SHIFT_MS } from "../domain/shifts.jsx";
import { ensureAudioCtx, gregLongDateStr, soundReminderTone } from "../lib/dates.jsx";
import { uid } from "../lib/helpers.jsx";
import { Bell, CalendarClock, ChevronDown, Clock, PhoneIncoming, Plus, Trash } from "../lib/icons.jsx";
import { notifyBookingSoon } from "../lib/notify.jsx";
import { readKey } from "../lib/offline-queue.jsx";
import { useCallback, useEffect, useRef, useState } from "../lib/react.jsx";
import { setSoundLevel, soundLevelMeta, useSoundLevel } from "../lib/sound.jsx";
import { styles } from "../styles.jsx";
import { SectionBanner } from "./AdminView.jsx";
import { AlertToneCheck } from "./AlarmOverlay.jsx";
import { CallRoute, InfoNote } from "./AssistanceTasks.jsx";
import { WhenPicker, bookingsNear, bookingsOnDay } from "./ScheduledRequests.jsx";
import { CallCodingFields, CallTypeTag, LoadedKmTag } from "./StatusBoard.jsx";
import { MIN_LEAD_MS } from "./WhenPicker.jsx";
import { SCHED_CANCEL_REASONS, SCHED_CANCEL_REASON_MAX, SCHED_DUE_SOON_MS, SCHED_LEAD_MS, SCHED_PREALERT_MS, SCHED_PREALERT_TICK_MS, dayHeadingStr, defaultScheduleTs, schedAwaitCall, schedCancelReason, schedOpen, schedStatusMeta, startOfDay, untilStr, whenStr } from "./booking-cancel.jsx";

// ---------- the quarter-hour reminder ----------
//
// A booking that goes out on its own is fine for a transfer nobody has to
// prepare for, but most of them need a word on the radio first: the crew told,
// the ward told, a porter found. So the desk gets a reminder a quarter of an
// hour out — but only for bookings falling inside the shift the person reading
// the board is actually signed on for, because a booking three shifts away is
// not their problem and a desk that chimes for other people's work stops being
// listened to.

// The shift window the dispatcher signed on for, against the one the booking
// falls in. Sessions carry their own window; a session from an older build that
// doesn't gets compared by shift key instead.
export function bookingInUserShift(entry, user) {
  if (!entry || !user) return false;
  const ts = entry.scheduledFor || 0;
  if (!ts) return false;
  if (user.shiftStart && user.shiftEnd) return ts >= user.shiftStart && ts < user.shiftEnd;
  if (!user.shift) return false;
  return scheduledShiftKey(ts) === user.shift;
}

// Which reminders this device has already played. Kept on the device, not on
// the board: five desks are five people, and each of them needs to hear it —
// while the same desk must not chime twice for one booking, however many times
// the page re-renders or is refreshed. Keyed by time as well as id, so moving a
// booking arms a fresh reminder for its new time.
export const PREALERT_KEY = "ems:prealerted";
export const PREALERT_TTL_MS = 24 * 60 * 60 * 1000;

export function preAlertKey(entry) {
  return `${entry.id}@${entry.scheduledFor || 0}`;
}

export function readPreAlerted() {
  try {
    const raw = window.localStorage.getItem(PREALERT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

export function markPreAlerted(key, now) {
  try {
    const current = readPreAlerted();
    const next = {};
    // Yesterday's reminders are dropped on the way past, so a desk that is
    // never closed doesn't accumulate a year of keys.
    Object.keys(current).forEach((k) => {
      if (now - current[k] < PREALERT_TTL_MS) next[k] = current[k];
    });
    next[key] = now;
    window.localStorage.setItem(PREALERT_KEY, JSON.stringify(next));
  } catch (e) {
    // private browsing or a full quota: worst case the reminder repeats
  }
}

// Watches the schedule on its own ten-second clock and returns the bookings
// currently inside the reminder window that haven't been dismissed. The chime,
// the buzz and the system notification are fired here, once each, at the moment
// a booking crosses T-15.
export function useSchedulePreAlerts(user, scheduled, audioCtxRef) {
  const [active, setActive] = useState([]);
  const latest = useRef({ user, scheduled });
  latest.current = { user, scheduled };
  const dismissed = useRef(new Set());

  useEffect(() => {
    function check() {
      const { user: u, scheduled: list } = latest.current;
      if (!u || (u.role !== "dispatcher" && u.role !== "admin")) {
        setActive((prev) => (prev.length ? [] : prev));
        return;
      }
      const now = Date.now();
      const fired = readPreAlerted();
      const showing = [];
      let chime = false;
      (list || []).forEach((entry) => {
        if (!entry || !schedOpen(entry, now)) return;
        const delta = (entry.scheduledFor || 0) - now;
        if (delta <= 0 || delta > SCHED_PREALERT_MS) return;
        if (!bookingInUserShift(entry, u)) return;
        const key = preAlertKey(entry);
        if (!fired[key]) {
          markPreAlerted(key, now);
          chime = true;
          notifyBookingSoon(entry, Math.max(1, Math.round(delta / 60000)));
        }
        if (!dismissed.current.has(key)) showing.push(entry);
      });
      // Two bookings crossing the line together get one chime between them, not
      // a pile of overlapping tones.
      if (chime) {
        soundReminderTone(audioCtxRef);
        buzz([90, 70, 90]);
      }
      setActive((prev) => {
        const same =
          prev.length === showing.length && prev.every((p, i) => preAlertKey(p) === preAlertKey(showing[i]));
        return same ? prev : showing;
      });
    }
    check();
    const t = setInterval(check, SCHED_PREALERT_TICK_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = useCallback(() => {
    setActive((prev) => {
      prev.forEach((entry) => dismissed.current.add(preAlertKey(entry)));
      return [];
    });
  }, []);

  return { active, dismiss };
}

// The reminder itself: on screen until it is dismissed or the booking goes out,
// so a chime heard from across the room can still be acted on a minute later.
export function SchedulePreAlert({ entries, units, now, onDismiss, audioCtxRef }) {
  // Read before the early return: a hook that is only sometimes called is a
  // hook React cannot keep track of.
  const level = useSoundLevel();
  if (!entries || entries.length === 0) return null;
  const silenced = soundLevelMeta(level).gain <= 0;
  const ctx = audioCtxRef ? audioCtxRef.current : null;
  const browserBlocked = !ctx || ctx.state !== "running";

  async function armSound() {
    if (silenced) setSoundLevel("full");
    try {
      const ctx = ensureAudioCtx(audioCtxRef);
      if (ctx) await ctx.resume();
    } catch (e) {
      // audio not available; ignore
    }
    soundReminderTone(audioCtxRef);
  }

  return (
    <div style={styles.preAlert}>
      <div style={styles.preAlertHead}>
        <span style={styles.preAlertTitle}>
          <Bell size={13} /> DUE THIS SHIFT
        </span>
        <span style={styles.preAlertCount}>
          {entries.length === 1 ? "1 booking" : `${entries.length} bookings`} inside 15 minutes
        </span>
        <button style={styles.preAlertDismiss} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      {entries.map((entry) => {
        const unit = units.find((u) => u.id === entry.assignedUnitId);
        const mins = Math.max(0, Math.round(((entry.scheduledFor || 0) - now) / 60000));
        return (
          <div key={entry.id} style={styles.preAlertRow}>
            <span style={styles.preAlertTime}>{hhmm(entry.scheduledFor)}</span>
            <span style={styles.preAlertIn}>in {mins} min</span>
            <span style={styles.preAlertNature}>{entry.nature}</span>
            <span style={styles.preAlertRoute}>{callRoute(entry)}</span>
            <span style={unit ? styles.assignedTag : styles.staffingWarn}>
              {unit ? unit.name : "no team assigned"}
            </span>
          </div>
        );
      })}
      <div style={styles.preAlertFoot}>
        {gregLongDateStr(now)} · the booking is dispatched automatically at its time.
        {silenced
          ? " This desk is silenced, so this reminder arrived without a tone — "
          : browserBlocked
          ? " This browser is holding the reminder tone — "
          : ""}
        {(silenced || browserBlocked) && (
          <button style={styles.preAlertArmBtn} onClick={armSound}>
            turn the tone on
          </button>
        )}
      </div>
    </div>
  );
}

// The scheduling desk. Dispatchers and admins only — it is rendered from those
// two views and nowhere else, and refuses to draw anything for any other role.
// Crews never see a booking: the first they know of one is the call arriving on
// their screen at its dispatch time, exactly like any other call.
// The day the desk is booking into, as a list of times already taken.
//
// Deliberately plain: times, what each one is, and a mark against anything
// inside half an hour of the time being picked. No calendar grid — a booking
// desk wants to read a column of times, and a grid of empty hours would take
// three times the room to say less.
export function DayBookings({ list, station, when }) {
  const day = bookingsOnDay(list, station, when);
  const near = new Set(bookingsNear(list, station, when).map((b) => b.id));

  if (day.length === 0) {
    return (
      <div style={styles.dayBookEmpty}>
        Nothing else booked at {stationLabel(station)} on {gregLongDateStr(when)}.
      </div>
    );
  }

  return (
    <div style={styles.dayBookWrap}>
      <div style={styles.dayBookHead}>
        Already booked · {stationLabel(station)} · {gregLongDateStr(when)}
        <span style={styles.dayBookCount}>
          {day.length} booking{day.length === 1 ? "" : "s"}
        </span>
      </div>
      <div style={styles.dayBookList}>
        {day.map((b) => {
          const clash = near.has(b.id);
          return (
            <div key={b.id} style={clash ? styles.dayBookRowNear : styles.dayBookRow}>
              <span style={clash ? styles.dayBookTimeNear : styles.dayBookTime}>
                {hhmm(b.scheduledFor)}
              </span>
              <span style={styles.dayBookWhat}>
                {b.nature || "Booking"}
                <span style={styles.dayBookRoute}>
                  {" "}
                  {b.locationFrom || "?"} → {b.locationTo || "?"}
                </span>
              </span>
              {clash && <span style={styles.dayBookFlag}>within 30 min</span>}
            </div>
          );
        })}
      </div>
      {near.size > 0 && (
        <div style={styles.dayBookWarn}>
          {near.size} of these {near.size === 1 ? "is" : "are"} within half an hour of {hhmm(when)}.
          Check a truck is free before you add another.
        </div>
      )}
    </div>
  );
}

export function ScheduledRequests({ user, units, requests, scheduled, allScheduled, saveScheduled, addLog, audioCtxRef }) {
  const [open, setOpen] = useState(false);
  // This form's own missing-field marks. It had been calling the dispatch
  // form's setter, which does not exist in this component — so pressing Book
  // threw before it reached the write, and the booking silently never happened.
  const [bookMissing, setBookMissing] = useState([]);
  const [tab, setTab] = useState("upcoming");
  const [showForm, setShowForm] = useState(false);
  const [locationFrom, setLocationFrom] = useState("");
  const [locationTo, setLocationTo] = useState("");
  const [nature, setNature] = useState("");
  const [priority, setPriority] = useState("bls");
  const [mrn, setMrn] = useState("");
  const [requirements, setRequirements] = useState([]);
  const [team, setTeam] = useState("");
  const [notes, setNotes] = useState("");
  // Coded ahead where the desk already knows. A booked transfer is usually the
  // one case where both codes can be answered before the truck moves.
  const [callType, setCallType] = useState("");
  const [loadedKm, setLoadedKm] = useState("");
  // A timestamp, not the string an <input type="datetime-local"> hands back —
  // see WhenPicker for why that input is no longer used here.
  const [when, setWhen] = useState(() => defaultScheduleTs(Date.now()));
  // Optional: when the ambulance has to leave, if that is not the same as when
  // the patient is expected.
  const [dispatchWhen, setDispatchWhen] = useState(null);
  // Set when the ward can't say when the patient will be ready and will phone
  // the desk instead. The booking is then held with no time on it.
  const [awaitCall, setAwaitCall] = useState(false);
  // Does the patient come back? "ready" waits for the ward to ring; "timed"
  // books the journey home for a time they have already given.
  const [returnMode, setReturnMode] = useState("none");
  const [returnWhen, setReturnWhen] = useState(null);
  // Which days of the week this booking repeats on. Empty means once.
  const [repeatOn, setRepeatOn] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Which booking has its controls open.
  //
  // Every card used to carry the whole set — a team picker, a sentence
  // explaining what happens if no team is set, a reschedule button and a cancel
  // button — which came to 167 pixels of controls under 92 pixels of
  // information, on every booking. A day with eight transfers on it could not
  // be read on a phone without scrolling through the same four controls eight
  // times. The card now says what the booking is and who is on it; the controls
  // are one tap away on the one being worked.
  const [openCard, setOpenCard] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editWhen, setEditWhen] = useState(null);
  const [editError, setEditError] = useState("");
  // The booking the desk has pressed cancel on, and the reason being typed
  // against it. Nothing is written while these are set: the cancellation only
  // happens when a reason has been given.
  const [cancellingId, setCancellingId] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState("");

  const preAlerts = useSchedulePreAlerts(user, scheduled, audioCtxRef);

  // A booking crossing the quarter-hour line opens the schedule, so whoever
  // heard the chime is looking at the booking rather than hunting for it.
  const alertCount = preAlerts.active.length;
  useEffect(() => {
    if (alertCount > 0) setOpen(true);
  }, [alertCount]);

  if (!user || (user.role !== "dispatcher" && user.role !== "admin")) return null;

  const now = Date.now();
  // `list` is this station's bookings, for reading. `saveFallback` is every
  // station's, because a write here replaces the whole stored array — if a
  // read ever fails and we fall back to the filtered list, the other
  // station's bookings would be written out of existence.
  const list = scheduled || [];
  const saveFallback = allScheduled || scheduled || [];
  const upcoming = list
    .filter((s) => s && schedOpen(s, now))
    .sort((a, b) => (a.scheduledFor || 0) - (b.scheduledFor || 0));
  // Dispatched and cancelled, scoped to the shift running now.
  //
  // Left unscoped this was every booking the station had ever taken — months of
  // them — and a desk looking for the one it cancelled an hour ago had to scroll
  // through the lot. What a desk asks here is "what happened on my shift", so
  // that is what it shows.
  const shiftFrom = user && user.shiftStart ? user.shiftStart : shiftWindowAt(now).start;
  const shiftTo = user && user.shiftEnd ? user.shiftEnd : shiftFrom + SHIFT_MS;
  const past = list
    .filter((s) => {
      if (!s || schedOpen(s, now)) return false;
      // Judged on when it was dealt with, not when it was booked — a booking
      // made last week and cancelled this morning belongs to this morning.
      const settled = s.cancelledAt || s.releasedAt || s.readyCalledAt || s.scheduledFor || 0;
      return settled >= shiftFrom && settled < shiftTo;
    })
    .sort((a, b) => (b.scheduledFor || 0) - (a.scheduledFor || 0));
  // Bookings waiting on a phone call are held apart from the timed ones: they
  // have no time to be due at, so they can't be "due within the half hour" and
  // they don't belong under any day on the calendar.
  const awaiting = upcoming.filter(schedAwaitCall);
  const timed = upcoming.filter((s) => !schedAwaitCall(s));
  const dueSoon = timed.filter((s) => (s.scheduledFor || 0) - now <= SCHED_DUE_SOON_MS);
  const unassigned = upcoming.filter((s) => !s.assignedUnitId);
  // The standing arrangements: bookings that repeat on named days.
  //
  // These are the dialysis runs and the weekly clinics — a template, not an
  // appointment. They were only visible as the copies they threw off into the
  // forward book, so the desk could see next Tuesday's occurrence but had
  // nowhere to see that the arrangement itself exists, nor stop it. They get
  // their own list, showing the days they run and when the next one is due.
  const repeating = list
    .filter((s) => s && isRecurring(s) && s.status !== "cancelled")
    .sort((a, b) => (a.scheduledFor || 0) - (b.scheduledFor || 0));
  const shown = tab === "upcoming" ? upcoming : tab === "repeating" ? repeating : past;
  // The upcoming list is read as a calendar: bookings under the Gregorian day
  // they go out on, today first, with anything waiting on a phone call held
  // above the calendar because it could be any of those days. Dispatched and
  // cancelled ones stay as a flat list — that tab is history, not a plan.
  // The standing arrangements read as one card per patient — see
  // `groupRepeatsByPatient`. The full booking card is still what the controls
  // live on, so the generic list below carries exactly the one arrangement the
  // desk has opened, and nothing when none is open.
  const repeatGroups = tab === "repeating" ? groupRepeatsByPatient(repeating, now) : [];
  // Counted for the tab whichever tab is showing, so the number does not appear
  // only once somebody has already pressed it.
  const repeatCount = new Set(repeating.map(repeatPatientKey)).size;
  const dayGroups =
    tab === "repeating"
      ? [{ key: "repeating", heading: "", entries: repeating.filter((s) => s.id === openCard) }]
      : tab === "upcoming"
      ? [
          ...(awaiting.length > 0
            ? [{ key: "awaiting", heading: "Waiting on their call · no time yet", entries: awaiting }]
            : []),
          ...timed.reduce((groups, entry) => {
            const day = startOfDay(entry.scheduledFor || now);
            const last = groups[groups.length - 1];
            if (last && last.day === day) last.entries.push(entry);
            else groups.push({ key: String(day), day, heading: dayHeadingStr(day, now), entries: [entry] });
            return groups;
          }, []),
        ]
      : [{ key: "all", heading: null, entries: shown }];

  function toggleRequirement(key) {
    setRequirements((r) => (r.includes(key) ? r.filter((x) => x !== key) : [...r, key]));
  }

  function resetForm() {
    setLocationFrom("");
    setLocationTo("");
    setNature("");
    setPriority("routine");
    setMrn("");
    setRequirements([]);
    setTeam("");
    setNotes("");
    setCallType("");
    setLoadedKm("");
    setWhen(defaultScheduleTs(Date.now()));
    setDispatchWhen(null);
    setAwaitCall(false);
    setReturnMode("none");
    setReturnWhen(null);
    setRepeatOn([]);
    setError("");
  }

  async function book() {
    const ts = awaitCall ? null : when;
    const dispatchTs = awaitCall ? null : dispatchWhen;
    // Which fields are missing, not just that something is. A message at the
    // bottom of a long form makes a desk hunt for the blank; the blank should
    // say so itself.
    const missing = [];
    if (!locationFrom.trim()) missing.push("locationFrom");
    if (!nature.trim()) missing.push("nature");
    if (missing.length) {
      setBookMissing(missing);
      setError(
        missing.length === 1
          ? "One field still needs an answer."
          : `${missing.length} fields still need an answer.`
      );
      return;
    }
    setBookMissing([]);
    // A booking with no time is deliberate — the ward is going to phone — so the
    // time checks below only apply to one that is going out at a set time.
    if (!awaitCall) {
      if (!ts) {
        setError("Pick the date and time the ambulance is needed, or say the time isn't known yet.");
        return;
      }
      // Later today is exactly what this form is for; a time that has already
      // gone is not, because it would be released the moment it was saved.
      if (ts < Date.now() + MIN_LEAD_MS) {
        setError(
          `${hhmm(ts)} on ${gregLongDateStr(ts)} has already passed. Pick a later time — anything from a minute out, including later today.`
        );
        return;
      }
    }
    // Already something at that time? Say so, name them, and let the desk
    // decide. Not a block: more than one ambulance can leave at two o'clock,
    // and a form that refuses would just be worked around.
    const myStation = user && user.station ? user.station : DEFAULT_STATION;
    if (ts) {
      const near = bookingsNear(allScheduled || scheduled, myStation, ts);
      if (near.length > 0) {
        const lines = near
          .slice(0, 6)
          .map((b) => `  ${hhmm(b.scheduledFor)} — ${b.nature || "booking"} (${b.locationFrom || "?"} → ${b.locationTo || "?"})`)
          .join("\n");
        const more = near.length > 6 ? `\n  …and ${near.length - 6} more` : "";
        if (
          !window.confirm(
            `${near.length} booking${near.length === 1 ? " is" : "s are"} already within half an hour of ${hhmm(ts)}:\n\n` +
              lines +
              more +
              `\n\nBook this one as well?`
          )
        ) {
          return;
        }
      }
    }

    setBusy(true);
    setError("");
    const createdAt = Date.now();
    const entry = {
      id: uid("sch"),
      station: myStation,
      locationFrom: locationFrom.trim(),
      locationTo: locationTo.trim(),
      nature: nature.trim(),
      priority,
      mrn: mrn.trim(),
      requirements,
      notes: notes.trim(),
      callType: callTypeMeta(callType) ? callType : null,
      loadedKm: loadedKmMeta(loadedKm) ? loadedKm : null,
      scheduledFor: ts,
      // Optional. Where a transfer needs the ambulance to leave before the
      // appointment — a distance, a lift, a patient who takes time to move —
      // this is when it has to go, and the call is raised fifteen minutes
      // before it. Left blank, the booking goes out at its appointment time as
      // it always has.
      dispatchAt: dispatchTs || null,
      // No time yet: the ward calls when the patient is ready and the desk sends
      // it out then. Nothing about it is automatic, which is the whole point.
      awaitCall: !!awaitCall,
      // The journey home. Made when this leg goes back in service, with the
      // route reversed — nothing about it is typed twice.
      returnMode: returnMode === "none" ? null : returnMode,
      returnAt: returnMode === "timed" ? returnWhen || null : null,
      leg: returnMode === "none" ? null : "out",
      // Days of the week, if this is a standing transfer. The booking itself is
      // the first occurrence; the rest are made a couple of days ahead.
      repeat: repeatOn.length ? { days: repeatOn.slice().sort((a, b) => a - b) } : null,
      // The shift the booking falls in, so it can be read a shift at a time —
      // this is the shift that will be working when it goes out, not the one
      // the desk is on while booking it. A booking with no time belongs to no
      // shift until the call comes in.
      shift: ts ? scheduledShiftKey(ts) : null,
      assignedUnitId: team || null,
      status: "scheduled",
      createdAt,
      createdBy: user.name || "Dispatch",
    };
    // Fresh read before writing: two desks booking at the same moment must not
    // overwrite each other's booking.
    const fresh = await readKey("ems:scheduled", saveFallback);
    await saveScheduled([...fresh, entry]);
    const teamName = team ? (units.find((u) => u.id === team) || {}).name || "" : "";
    await addLog(
      (awaitCall
        ? `Future request booked with no time — the ward will call when the patient is ready — ${entry.nature} (${callRoute(entry)})`
        : `Future request booked for ${whenStr(ts)} — ${entry.nature} (${callRoute(entry)})`) +
        (teamName ? ` · ${teamName} pencilled in` : " · no team yet"),
      "call"
    );
    resetForm();
    setShowForm(false);
    setBusy(false);
    setOpen(true);
    setTab("upcoming");
  }

  async function patchBooking(id, patch, logLine) {
    const fresh = await readKey("ems:scheduled", saveFallback);
    const target = fresh.find((s) => s && s.id === id);
    if (!target) return;
    await saveScheduled(fresh.map((s) => (s && s.id === id ? { ...s, ...patch } : s)));
    if (logLine) await addLog(logLine, "assign");
  }

  async function assignTeam(entry, unitId) {
    const unit = units.find((u) => u.id === unitId);
    await patchBooking(
      entry.id,
      { assignedUnitId: unitId || null, assignedBy: user.name || "Dispatch", assignedAt: Date.now() },
      unit
        ? `${unit.name} assigned to the ${whenStr(entry.scheduledFor)} booking — ${entry.nature} (${callRoute(entry)}). They'll be alerted when it goes out.`
        : `Team stood down from the ${whenStr(entry.scheduledFor)} booking — ${entry.nature}`
    );
  }

  // Changing the time on a booking that is already on the board. Same picker as
  // the booking form, so a time can be nudged by a quarter of an hour or moved
  // to another day without re-entering anything else. Used as well to put a
  // time on a booking that was taken without one.
  async function reschedule(entry) {
    const ts = editWhen;
    if (!ts) return;
    if (ts < Date.now() + MIN_LEAD_MS) {
      setEditError(`${hhmm(ts)} on ${gregLongDateStr(ts)} has already passed — pick a later time.`);
      return;
    }
    const wasAwaiting = schedAwaitCall(entry);
    setEditingId(null);
    setEditError("");
    await patchBooking(
      entry.id,
      {
        scheduledFor: ts,
        shift: scheduledShiftKey(ts),
        awaitCall: false,
        rescheduledAt: Date.now(),
        rescheduledBy: user.name || "Dispatch",
      },
      wasAwaiting
        ? `Booking that was waiting on a call now set for ${whenStr(ts)} — ${entry.nature}`
        : `Booking moved from ${whenStr(entry.scheduledFor)} to ${whenStr(ts)} — ${entry.nature}`
    );
  }

  // The reverse: a booked time the ward can no longer hold to. The booking stays
  // on the schedule with no time on it, waiting for their call, instead of being
  // cancelled and re-taken.
  async function clearBookingTime(entry) {
    setEditingId(null);
    setEditError("");
    await patchBooking(
      entry.id,
      {
        scheduledFor: null,
        shift: null,
        awaitCall: true,
        rescheduledAt: Date.now(),
        rescheduledBy: user.name || "Dispatch",
      },
      `Booking for ${whenStr(entry.scheduledFor)} held with no time — the ward will call when the patient is ready — ${entry.nature}`
    );
  }

  // The ward has called: the patient is ready. Stamping now on the booking is
  // all it takes — the release loop every open desk is already running raises the
  // call within seconds, assigns the team pencilled in and alerts them, exactly
  // as it would for a booking whose time had come round.
  async function markReady(entry) {
    const ts = Date.now();
    await patchBooking(
      entry.id,
      {
        scheduledFor: ts,
        shift: scheduledShiftKey(ts),
        awaitCall: false,
        readyCalledAt: ts,
        readyCalledBy: user.name || "Dispatch",
      },
      `Ward called — patient ready for ${entry.nature} (${callRoute(entry)}); the booking is going out now`
    );
  }

  // Cancelling a booking is two presses, not one. The first opens the banner on
  // the card asking what happened; nothing is written until a reason has been
  // given. A transfer that vanishes off the forward book with no reason on it is
  // one nobody can account for the next morning — and the reason is exactly what
  // the supervisor reading the exported workbook is looking for — so it is
  // required here rather than left to the notes.
  function openCancel(entry) {
    setCancellingId(entry.id);
    setCancelReason("");
    setCancelError("");
    // The reschedule box and the cancel banner are two answers to the same
    // question, so opening one closes the other.
    setEditingId(null);
    setEditError("");
  }

  function closeCancel() {
    setCancellingId(null);
    setCancelReason("");
    setCancelError("");
  }

  async function cancelBooking(entry) {
    const reason = cancelReason.trim().slice(0, SCHED_CANCEL_REASON_MAX);
    if (!reason) {
      setCancelError(
        "Say why this booking is being cancelled — it stays on the record and goes out on the shared sheet."
      );
      return;
    }
    closeCancel();
    await patchBooking(
      entry.id,
      {
        status: "cancelled",
        cancelledAt: Date.now(),
        cancelledBy: user.name || "Dispatch",
        cancelReason: reason,
      },
      // The booking with no time on it has nothing to name it by, so the line
      // says that rather than "Booking for —".
      `${
        entry.scheduledFor ? `Booking for ${whenStr(entry.scheduledFor)}` : "Booking with no time yet"
      } cancelled — ${entry.nature} (${callRoute(entry)}) · reason: ${reason}`
    );
  }

  return (
    <div>
      <SectionBanner
        title="SCHEDULED REQUESTS"
        icon={<CalendarClock size={13} />}
        count={upcoming.length}
        countLabel={upcoming.length === 1 ? "booked" : "booked"}
        action={
          <button style={styles.bannerBtn} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Open"} <ChevronDown size={12} />
          </button>
        }
      />

      <div style={styles.historyNote}>
        {upcoming.length === 0
          ? "Nothing booked ahead"
          : `${upcoming.length} booked ahead${dueSoon.length > 0 ? ` · ${dueSoon.length} due within the half hour` : ""}${
              awaiting.length > 0 ? ` · ${awaiting.length} waiting on their call` : ""
            }${unassigned.length > 0 ? ` · ${unassigned.length} without a team` : ""}`}
      </div>

      <SchedulePreAlert
        entries={preAlerts.active}
        units={units}
        now={now}
        onDismiss={preAlerts.dismiss}
        audioCtxRef={audioCtxRef}
      />

      {open && (
        <React.Fragment>
          <div style={{ ...styles.logTabs, border: "none", padding: "10px 0 0" }}>
            <button style={tab === "upcoming" ? styles.tabBtnActive : styles.tabBtn} onClick={() => setTab("upcoming")}>
              Upcoming{upcoming.length > 0 ? ` (${upcoming.length})` : ""}
            </button>
            <button
              style={tab === "repeating" ? styles.tabBtnActive : styles.tabBtn}
              onClick={() => setTab("repeating")}
            >
              {/* Patients, not arrangements — one card each, so the number on
                  the tab has to count the same thing the tab shows. */}
              Repeating{repeatCount > 0 ? ` (${repeatCount})` : ""}
            </button>
            <button style={tab === "past" ? styles.tabBtnActive : styles.tabBtn} onClick={() => setTab("past")}>
              Past{past.length > 0 ? ` (${past.length})` : ""}
            </button>
            <button style={{ ...styles.primaryBtnSm, marginLeft: "auto" }} onClick={() => setShowForm((s) => !s)}>
              <Plus size={14} /> Book ahead
            </button>
          </div>

          {showForm && (
            <div style={{ ...styles.requestForm, marginTop: 10 }}>
              <div style={styles.formRow}>
                <div style={{ flex: 2, minWidth: 260 }}>
                  <label style={styles.label}>Date &amp; time the ambulance is needed</label>
                  {/* Plenty of transfers are phoned through before anyone can say
                      when the patient will actually be ready — the ward says it
                      will call back. This button books that request without a
                      time, so it is on the schedule and nothing is forgotten,
                      and the desk sends it out the moment the phone rings. */}
                  <button
                    style={awaitCall ? styles.awaitCallToggleOn : styles.awaitCallToggle}
                    onClick={() => { setAwaitCall((a) => !a); setError(""); }}
                  >
                    <PhoneIncoming size={13} />
                    {awaitCall
                      ? "Time not known — they will call when the patient is ready ✓"
                      : "Time not known? They will call when the patient is ready"}
                  </button>
                  {awaitCall ? (
                    <InfoNote>
                      Booked with no time on it. It waits at the top of the schedule until the ward calls —
                      then <strong>Patient ready — send it out now</strong> on the booking raises the call and
                      alerts the team. Nothing goes out on its own, so no reminder chimes for it either.
                    </InfoNote>
                  ) : (
                    <WhenPicker
                      value={when}
                      onChange={setWhen}
                      now={now}
                      hint={
                        when
                          ? `Goes out ${whenStr(when)} — ${untilStr(when, now)}${
                              shiftMeta(scheduledShiftKey(when)) ? ` · ${shiftMeta(scheduledShiftKey(when)).label}` : ""
                            }${
                              bookingInUserShift({ scheduledFor: when }, user)
                                ? ". That is inside your own shift, so you'll be reminded 15 minutes before it goes out."
                                : ". That falls outside your shift — the desk on duty then gets the reminder."
                            }`
                          : "Pick the day on the calendar, then set the hour and minute."
                      }
                    />
                  )}

                  {/* What is already on that day, in time order, with anything
                      inside half an hour of the time being picked marked. This
                      is the whole answer to "are we double-booking?" and it has
                      to be visible while the time is being chosen, not after
                      the booking is saved. */}
                  {!awaitCall && when && (
                    <DayBookings
                      list={allScheduled || scheduled}
                      station={user && user.station ? user.station : DEFAULT_STATION}
                      when={when}
                    />
                  )}

                  {/* Does the patient come back?
                      One question, three answers, and the app does the rest:
                      the journey home is made when this leg goes back in
                      service, with the route reversed. The desk types nothing
                      twice, and the return is a call in its own right — which
                      is what keeps the count and every UHU figure honest. */}
                  <div style={{ marginTop: 14 }}>
                    <label style={styles.label}>Does the patient come back?</label>
                    <div style={styles.kindPick}>
                      {RETURN_MODES.map((m) => (
                        <button
                          key={m.key}
                          style={returnMode === m.key ? styles.kindPickOn : styles.kindPickOff}
                          onClick={() => setReturnMode(m.key)}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    {returnMode === "ready" && (
                      <div style={styles.formHint}>
                        The return waits on the board with no time until the ward rings. How long
                        they wait is recorded.
                      </div>
                    )}
                    {returnMode === "timed" && (
                      <div style={{ marginTop: 8 }}>
                        <WhenPicker value={returnWhen} onChange={setReturnWhen} />
                        <div style={styles.formHint}>
                          The journey home, booked. It appears on the forward book once this leg is
                          finished.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* A standing transfer — dialysis three times a week, the
                      same clinic every Tuesday. The desk says which days once
                      instead of typing the same booking all month. */}
                  {!awaitCall && (
                    <div style={{ marginTop: 14 }}>
                      <label style={styles.label}>Repeat</label>
                      <div style={styles.dayPick}>
                        {DAY_SHORT.map((d, i) => {
                          const on = repeatOn.includes(i);
                          return (
                            <button
                              key={d}
                              style={on ? styles.dayPickOn : styles.dayPickOff}
                              onClick={() =>
                                setRepeatOn((v) =>
                                  v.includes(i) ? v.filter((x) => x !== i) : [...v, i]
                                )
                              }
                            >
                              {d}
                            </button>
                          );
                        })}
                      </div>
                      <div style={styles.formHint}>
                        {repeatOn.length
                          ? `Repeats ${repeatLabel({ repeat: { days: repeatOn } }).toLowerCase()} at this time. The next couple of days are put on the book automatically.`
                          : "Leave all off for a one-off booking."}
                      </div>
                    </div>
                  )}

                  {/* Optional second time. Most transfers need only one —
                          the patient is expected somewhere and the ambulance
                          goes when it goes. A distance, a lift or a patient who
                          takes time to move needs the truck to leave earlier
                          than that, and this is where the desk says so. */}
                      <div style={{ marginTop: 14 }}>
                        <label style={styles.label}>
                          Dispatch time — optional
                        </label>
                        {dispatchWhen ? (
                          <>
                            {/* A time, on the day the appointment is already on.
                                A second calendar is a second chance to pick the
                                wrong day for the same booking. */}
                            {/* Hours and minutes as two fields, not a native
                                time input: that one follows the device's locale
                                and shows AM/PM on a phone set to English, on a
                                board that is 24-hour everywhere else. */}
                            <div style={styles.timeFields}>
                              <select
                                style={styles.timeSelect}
                                value={String(new Date(dispatchWhen).getHours()).padStart(2, "0")}
                                onChange={(e) => {
                                  const base = new Date(dispatchWhen);
                                  base.setHours(Number(e.target.value), base.getMinutes(), 0, 0);
                                  setDispatchWhen(base.getTime());
                                }}
                              >
                                {Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")).map((h) => (
                                  <option key={h} value={h}>{h}</option>
                                ))}
                              </select>
                              <span style={styles.timeColon}>:</span>
                              <select
                                style={styles.timeSelect}
                                value={String(new Date(dispatchWhen).getMinutes()).padStart(2, "0")}
                                onChange={(e) => {
                                  const base = new Date(dispatchWhen);
                                  base.setMinutes(Number(e.target.value), 0, 0);
                                  setDispatchWhen(base.getTime());
                                }}
                              >
                                {Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0")).map((m) => (
                                  <option key={m} value={m}>{m}</option>
                                ))}
                              </select>
                            </div>
                            <div style={styles.formHint}>
                              Call raised at {hhmm(dispatchWhen - SCHED_LEAD_MS)}, fifteen minutes
                              before the ambulance leaves.
                            </div>
                            <button
                              style={{ ...styles.ghostBtnSm, marginTop: 8 }}
                              onClick={() => setDispatchWhen(null)}
                            >
                              Remove dispatch time
                            </button>
                          </>
                        ) : (
                          <button
                            style={styles.ghostBtnSm}
                            onClick={() => setDispatchWhen(when || defaultScheduleTs(Date.now()))}
                          >
                            + Set a separate dispatch time
                          </button>
                        )}
                      </div>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={styles.label}>Level of care</label>
                  <select style={styles.input} value={priority} onChange={(e) => setPriority(e.target.value)}>
                    {PRIORITY_CHOICES.map((k) => [k, PRIORITY[k]]).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}{v.desc ? ` — ${v.desc}` : ""}
                      </option>
                    ))}
                  </select>
                  <AlertToneCheck
                    audioCtxRef={audioCtxRef}
                    priority={priority}
                    label="Alert tone"
                    style={{ marginTop: 7 }}
                  />
                </div>
              </div>

              <div style={styles.formRow}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={styles.label}>Location from (pick-up)</label>
                  <input style={styles.input} value={locationFrom} onChange={(e) => setLocationFrom(e.target.value)} placeholder="e.g. Ward 4B, Bed 12" />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={styles.label}>Location to (destination)</label>
                  <input style={styles.input} value={locationTo} onChange={(e) => setLocationTo(e.target.value)} placeholder="e.g. Oncology Day Unit" />
                </div>
              </div>

              <div style={styles.formRow}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={styles.label}>Nature of call</label>
                  <input style={styles.input} value={nature} onChange={(e) => setNature(e.target.value)} placeholder="e.g. Dialysis appointment, 61F" />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={styles.label}>MRN</label>
                  <input style={styles.input} value={mrn} onChange={(e) => setMrn(e.target.value)} placeholder="Medical record number" />
                </div>
              </div>

              <div>
                <label style={styles.label}>Requirements</label>
                <div style={styles.checklistRow}>
                  {REQUIREMENTS.map((r) => (
                    <label key={r.key} style={requirements.includes(r.key) ? styles.checkPillActive : styles.checkPill}>
                      <input
                        type="checkbox"
                        checked={requirements.includes(r.key)}
                        onChange={() => toggleRequirement(r.key)}
                        style={styles.checkboxInput}
                      />
                      {r.label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label style={styles.label}>Team (optional — can be assigned any time before it goes out)</label>
                <select style={styles.input} value={team} onChange={(e) => setTeam(e.target.value)}>
                  <option value="">No team yet</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {crewShiftSummary(u, now) ? ` (${crewShiftSummary(u, now)})` : " (no crew signed on)"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={styles.label}>Notes (optional)</label>
                <input style={styles.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Porter to meet on arrival" />
              </div>

              <CallCodingFields
                callType={callType}
                setCallType={setCallType}
                loadedKm={loadedKm}
                setLoadedKm={setLoadedKm}
              />

              {error && <div style={styles.loginError}>{error}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button style={styles.primaryBtn} disabled={busy} onClick={book}>
                  {awaitCall ? "Book with no time" : "Book request"}
                </button>
                <button style={styles.ghostBtn} onClick={() => { setShowForm(false); setError(""); }}>Cancel</button>
              </div>
            </div>
          )}

          {shown.length === 0 && (
            <div style={styles.emptyState}>
              {tab === "upcoming"
                ? "Nothing booked ahead yet."
                : tab === "repeating"
                ? "No standing arrangements. A booking becomes one when days of the week are ticked on it."
                : "No bookings have gone out or been cancelled yet."}
            </div>
          )}

          {/* One card per patient, with every day they run on. The days are
              drawn as a week rather than written out as a list of names: a desk
              scanning ten of these is looking for a shape, not reading. */}
          {tab === "repeating" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {repeatGroups.map((g) => {
                const lead = g.lead;
                const priorityMeta = PRIORITY[priorityKeyOf(lead)];
                return (
                  <div
                    key={g.key}
                    style={{ ...styles.schedCard, borderLeftColor: priorityMeta.color, marginBottom: 0 }}
                  >
                    <div style={styles.callCardTop}>
                      <div style={styles.schedCardNature}>{lead.nature}</div>
                      <span style={{ ...styles.pill, background: priorityMeta.color }}>
                        {priorityMeta.label}
                      </span>
                    </div>

                    <div style={styles.schedCardMeta}>
                      <CallRoute req={lead} />
                      <CallTypeTag req={lead} />
                    </div>
                    {lead.mrn && <div style={styles.mrnRow}>MRN: {lead.mrn}</div>}

                    <div style={styles.repeatWeek}>
                      {DAY_SHORT.map((d, i) => (
                        <span key={d} style={g.days.includes(i) ? styles.repeatDayOn : styles.repeatDayOff}>
                          {d[0]}
                        </span>
                      ))}
                      <span style={styles.repeatNext}>
                        {g.nextAt ? `Next ${whenStr(g.nextAt)}` : "Nothing due in the next week"}
                      </span>
                    </div>

                    {/* Each arrangement under the patient: the days it runs and
                        the time it goes at. One patient can have two. */}
                    {g.entries.map((entry) => {
                      const unit = units.find((u) => u.id === entry.assignedUnitId);
                      const at = nextRepeatAt(entry, now);
                      return (
                        <div key={entry.id} style={styles.repeatArrRow}>
                          <span style={styles.repeatArrDays}>
                            {repeatDays(entry).length === 7 ? "EVERY DAY" : repeatLabel(entry)}
                          </span>
                          <span style={styles.repeatArrTime}>
                            {entry.scheduledFor ? hhmm(entry.scheduledFor) : "no time"}
                          </span>
                          <span style={styles.repeatArrWho}>{unit ? unit.name : "No team yet"}</span>
                          <span style={styles.repeatArrNext}>{at ? untilStr(at, now) : ""}</span>
                          <button
                            style={styles.ghostBtnSm}
                            onClick={() => {
                              setOpenCard(openCard === entry.id ? null : entry.id);
                              closeCancel();
                              setEditingId(null);
                            }}
                          >
                            {openCard === entry.id ? "Done" : "Manage"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {dayGroups.map((group) => (
              <React.Fragment key={group.key}>
                {group.heading && (
                  <div style={styles.calDayHeading}>
                    <span style={styles.calDayHeadingText}>{group.heading}</span>
                    <span style={styles.calDayHeadingCount}>
                      {group.entries.length === 1 ? "1 booking" : `${group.entries.length} bookings`}
                    </span>
                  </div>
                )}
                {group.entries.map((entry) => {
              const unit = units.find((u) => u.id === entry.assignedUnitId);
              const meta = schedStatusMeta(entry.status);
              const waiting = schedAwaitCall(entry);
              const shift = waiting ? null : shiftMeta(entry.shift || scheduledShiftKey(entry.scheduledFor));
              const soon = !waiting && schedOpen(entry, now) && (entry.scheduledFor || 0) - now <= SCHED_DUE_SOON_MS;
              const overdue = !waiting && schedOpen(entry, now) && (entry.scheduledFor || 0) <= now;
              // Inside the reminder window and in this desk's own shift: the
              // card says so, so nobody has to work out from a countdown
              // whether the chime is going to come.
              const reminding =
                schedOpen(entry, now) &&
                (entry.scheduledFor || 0) - now > 0 &&
                (entry.scheduledFor || 0) - now <= SCHED_PREALERT_MS &&
                bookingInUserShift(entry, user);
              const priorityMeta = PRIORITY[priorityKeyOf(entry)];
              const releasedCall = entry.releasedRequestId
                ? (requests || []).find((r) => r.id === entry.releasedRequestId)
                : null;
              return (
                <div
                  key={entry.id}
                  style={{
                    ...styles.schedCard,
                    borderLeftColor: entry.status === "cancelled" ? "var(--crit)" : priorityMeta.color,
                    ...(soon ? styles.callCardDueSoon : null),
                    // A booking that was called off should not read the same as
                    // one still coming. It stays legible — somebody may need to
                    // see why — but it stops competing with live work.
                    ...(entry.status === "cancelled" ? styles.schedCancelled : null),
                  }}
                >
                  <div style={styles.callCardTop}>
                    <div style={styles.schedCardNature}>{entry.nature}</div>
                    <span style={{ ...styles.pill, background: priorityMeta.color }}>{priorityMeta.label}</span>
                  </div>

                  {/* Two times, said as two things. A card showing one time when
                      the booking has two is a card somebody will misread. */}
                  {entry.dispatchAt && (
                    <div style={styles.twoTimes}>
                      <span>
                        Leaves <strong>{hhmm(entry.dispatchAt)}</strong>
                      </span>
                      <span style={styles.twoTimesDim}>
                        · appointment {hhmm(entry.scheduledFor)} · call raised{" "}
                        {hhmm(entry.dispatchAt - SCHED_LEAD_MS)}
                      </span>
                    </div>
                  )}

                  <div style={styles.schedCardMeta}>
                    {waiting ? (
                      <span style={styles.awaitCallTag}>
                        <PhoneIncoming size={11} />{" "}
                        {schedOpen(entry, now) ? "NO TIME — THEY WILL CALL" : "NO TIME WAS SET"}
                      </span>
                    ) : (
                      <span style={{ ...styles.scheduledTag, color: meta.color, borderColor: meta.color }}>
                        <CalendarClock size={11} /> {whenStr(entry.scheduledFor)}
                      </span>
                    )}
                    {!waiting && schedOpen(entry, now) && (
                      <span style={overdue ? styles.staffingWarn : styles.historyDuration}>
                        {untilStr(entry.scheduledFor, now)}
                      </span>
                    )}
                    {reminding && (
                      <span style={styles.remindingTag}>
                        <Bell size={10} /> REMINDER RUNNING
                      </span>
                    )}
                    {isOutLeg(entry) && <span style={styles.legOut}>OUT</span>}
                    {isReturnLeg(entry) && <span style={styles.legReturn}>↩ RETURN</span>}
                    {isRecurring(entry) && (
                      <span style={styles.repeatTag}>↻ REPEATS · {repeatLabel(entry)}</span>
                    )}
                    {shift && (
                      <span style={{ ...styles.shiftTag, color: shift.color, borderColor: shift.color }}>
                        {shift.glyph} {shift.short}
                      </span>
                    )}
                    <span style={{ ...styles.pill, background: meta.color }}>{meta.label}</span>
                  </div>

                  {/* What is coming after this leg, said on the card rather
                      than left for the desk to remember. */}
                  {wantsReturn(entry) && !isReturnLeg(entry) && (
                    <div style={styles.legLink}>
                      <span style={styles.legLinkArrow}>↩</span>
                      <span>
                        {entry.returnMode === "timed" && entry.returnAt ? (
                          <>
                            <strong style={styles.legLinkStrong}>
                              Return booked {whenStr(entry.returnAt)}
                            </strong>{" "}
                            — it goes on the book once this leg is finished.
                          </>
                        ) : (
                          <>
                            <strong style={styles.legLinkStrong}>Return journey to follow</strong> —
                            ring when ready. It appears on the board on its own when this leg
                            closes.
                          </>
                        )}
                      </span>
                    </div>
                  )}

                  {/* A return leg waiting on the ward: how long the patient has
                      been sitting there. Nobody could evidence this before. */}
                  {isReturnLeg(entry) && entry.deliveredAt && schedOpen(entry, now) && (
                    <div style={styles.historyClosedBy}>
                      Return leg · patient delivered {clockStr(entry.deliveredAt)} ·{" "}
                      <strong style={styles.legWaiting}>
                        waiting {shortDurationStr(Math.max(0, now - entry.deliveredAt))}
                      </strong>
                    </div>
                  )}

                  <div style={styles.schedCardMeta}>
                    <CallRoute req={entry} />
                    <CallTypeTag req={entry} />
                    <LoadedKmTag req={entry} />
                  </div>

                  {entry.mrn && <div style={styles.mrnRow}>MRN: {entry.mrn}</div>}
                  {entry.notes && <div style={styles.mrnRow}>{entry.notes}</div>}
                  {entry.requirements && entry.requirements.length > 0 && (
                    <div style={styles.checklistRow}>
                      {entry.requirements.map((k) => (
                        <span key={k} style={styles.reqBadge}>
                          {REQUIREMENTS.find((r) => r.key === k) ? REQUIREMENTS.find((r) => r.key === k).label : k}
                        </span>
                      ))}
                    </div>
                  )}

                  {entry.status === "released" && (
                    <div style={styles.historyClosedBy}>
                      Dispatched {entry.releasedAt ? whenStr(entry.releasedAt) : ""}
                      {releasedCall ? ` · now ${REQ_STATUS[releasedCall.status] ? REQ_STATUS[releasedCall.status].label : releasedCall.status}` : ""}
                    </div>
                  )}
                  {entry.status === "cancelled" && (
                    <div style={styles.historyClosedBy}>
                      Cancelled{entry.cancelledBy ? ` by ${entry.cancelledBy}` : ""}
                      {schedCancelReason(entry) ? (
                        <span style={styles.cancelReasonSaid}> — {schedCancelReason(entry)}</span>
                      ) : (
                        " — no reason was recorded"
                      )}
                    </div>
                  )}

                  {schedOpen(entry, now) && openCard !== entry.id && (
                    <div style={styles.schedCardActions}>
                      <span style={unit ? styles.assignedTag : styles.pendingAckTag}>
                        {unit ? unit.name : "No team yet"}
                      </span>
                      <button
                        style={styles.ghostBtnSm}
                        onClick={() => {
                          setOpenCard(entry.id);
                          closeCancel();
                          setEditingId(null);
                        }}
                      >
                        Manage
                      </button>
                    </div>
                  )}

                  <div style={styles.schedCardActions}>
                    {schedOpen(entry, now) && openCard === entry.id ? (
                      <React.Fragment>
                        {/* The ward has phoned: this is the button that turns a
                            booking with no time into a live call, there and then.
                            It stamps the current time on the booking and the
                            normal release path picks it up within seconds, so the
                            crew gets exactly the alarm and timeline they would
                            get from a call phoned in on the spot. */}
                        {waiting && (
                          <button style={styles.readyNowBtn} onClick={() => markReady(entry)}>
                            <PhoneIncoming size={13} />{" "}
                            {isReturnLeg(entry)
                              ? "The ward has rung — send it now"
                              : "Patient ready — send it out now"}
                          </button>
                        )}
                        <select
                          style={styles.assignSelect}
                          value={entry.assignedUnitId || ""}
                          onChange={(e) => assignTeam(entry, e.target.value)}
                        >
                          <option value="">No team yet</option>
                          {units.map((u) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                        {unit ? (
                          <span style={styles.assignedTag}>{unit.name} — alerted when it goes out</span>
                        ) : (
                          <span style={styles.pendingAckTag}>Raised for the desk if nobody is set</span>
                        )}
                        {editingId !== entry.id && cancellingId !== entry.id && (
                          <button
                            style={styles.ghostBtnSm}
                            onClick={() => {
                              setEditingId(entry.id);
                              setEditWhen(entry.scheduledFor || defaultScheduleTs(Date.now()));
                              setEditError("");
                              closeCancel();
                            }}
                          >
                            <Clock size={12} /> {waiting ? "Set a date & time" : "Change date & time"}
                          </button>
                        )}
                        {cancellingId !== entry.id && (
                          <button style={styles.ghostBtnSm} onClick={() => openCancel(entry)}>
                            <Trash size={12} /> Cancel booking
                          </button>
                        )}
                        {cancellingId !== entry.id && editingId !== entry.id && (
                          <button style={styles.ghostBtnSm} onClick={() => setOpenCard(null)}>
                            Done
                          </button>
                        )}
                      </React.Fragment>
                    ) : (
                      !schedOpen(entry, now) && unit && <span style={styles.assignedTag}>{unit.name}</span>
                    )}
                  </div>

                  {/* The banner the desk answers before a booking can be
                      cancelled. It sits on the card itself rather than in a
                      dialog, so the transfer being cancelled stays in front of
                      whoever is typing the reason for it. */}
                  {cancellingId === entry.id && (
                    <div style={styles.cancelReasonBanner}>
                      <div style={styles.cancelReasonHead}>
                        <Trash size={12} /> WHY IS THIS BOOKING BEING CANCELLED?
                      </div>
                      <div style={styles.cancelReasonNote}>
                        {waiting
                          ? "This booking is still waiting on the ward's call."
                          : `Booked for ${whenStr(entry.scheduledFor)}.`}{" "}
                        The reason is kept on the booking, written into the event log, and carried onto the
                        Scheduled Requests sheet of the shared spreadsheet.
                      </div>
                      <div style={styles.checklistRow}>
                        {SCHED_CANCEL_REASONS.map((r) => (
                          <button
                            key={r}
                            style={cancelReason === r ? styles.reasonPillActive : styles.reasonPill}
                            onClick={() => {
                              setCancelReason(r);
                              setCancelError("");
                            }}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                      <input
                        style={{ ...styles.input, marginTop: 8 }}
                        value={cancelReason}
                        maxLength={SCHED_CANCEL_REASON_MAX}
                        placeholder="Reason for cancelling — pick one above or type it"
                        onChange={(e) => {
                          setCancelReason(e.target.value);
                          setCancelError("");
                        }}
                      />
                      {cancelError && <div style={styles.loginError}>{cancelError}</div>}
                      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <button style={styles.dangerBtnSm} onClick={() => cancelBooking(entry)}>
                          <Trash size={12} /> Cancel the booking
                        </button>
                        <button style={styles.ghostBtnSm} onClick={closeCancel}>
                          Keep it on the book
                        </button>
                      </div>
                    </div>
                  )}

                  {editingId === entry.id && (
                    <div style={styles.rescheduleBox}>
                      <div style={styles.label}>{waiting ? "Give this booking a time" : "Move this booking"}</div>
                      <WhenPicker
                        value={editWhen}
                        onChange={setEditWhen}
                        now={now}
                        hint={
                          editWhen
                            ? waiting
                              ? `No time on it at the moment · setting it to ${whenStr(editWhen)} (${untilStr(editWhen, now)}) means it goes out on its own then, without waiting for their call`
                              : `Currently ${whenStr(entry.scheduledFor)} · moving to ${whenStr(editWhen)} (${untilStr(editWhen, now)})`
                            : ""
                        }
                      />
                      {editError && <div style={styles.loginError}>{editError}</div>}
                      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <button style={styles.primaryBtnSm} onClick={() => reschedule(entry)}>
                          {waiting ? "Save this time" : "Save new time"}
                        </button>
                        {/* The other direction: a booked time that has fallen
                            through, where the ward now says it will call back. */}
                        {!waiting && (
                          <button style={styles.ghostBtnSm} onClick={() => clearBookingTime(entry)}>
                            <PhoneIncoming size={12} /> Take the time off — they'll call
                          </button>
                        )}
                        <button style={styles.ghostBtnSm} onClick={() => { setEditingId(null); setEditError(""); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
                })}
              </React.Fragment>
            ))}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}