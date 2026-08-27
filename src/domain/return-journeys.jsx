import { callFrom, callTo } from "./call-locations.jsx";
import { stationOf } from "./live-sheet.jsx";
import { callTypeMeta } from "./sheet-vocabulary.jsx";
import { scheduledShiftKey } from "./shift-helpers.jsx";
import { uid } from "../lib/helpers.jsx";
import { localDayKey } from "../ui/Escalations.jsx";

// ---------- return journeys and repeating bookings ----------
//
// A transfer that comes back is two dispatches, not one. Each leg has its own
// five timestamps, its own response, its own loaded kilometres and its own crew
// time; one record cannot hold two journeys, and forcing it to would put the
// call count and every UHU figure out. So: two calls, linked, each a full row
// on the sheet — which is also how the department counts them.
//
// The return is created when the outbound goes back in service, with the route
// reversed. Where the ward gives a time it is booked for that time; where they
// say "ring when ready" it waits, which is the awaitCall state the board has
// had all along.
export const RETURN_MODES = [
  { key: "none", label: "No" },
  { key: "ready", label: "Yes — ring when ready" },
  { key: "timed", label: "Yes — at a set time" },
];

export function wantsReturn(x) {
  const m = x && x.returnMode;
  return m === "ready" || m === "timed";
}

export function isReturnLeg(x) {
  return !!(x && x.leg === "return");
}

export function isOutLeg(x) {
  return !!(x && x.leg === "out");
}

// OUT / RETURN / blank, for the column appended to the sheet.
export function journeyLabel(x) {
  return isReturnLeg(x) ? "RETURN" : isOutLeg(x) ? "OUT" : "";
}

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function repeatDays(x) {
  const d = x && x.repeat && x.repeat.days;
  return Array.isArray(d) ? d.filter((n) => n >= 0 && n <= 6) : [];
}

export function isRecurring(x) {
  return repeatDays(x).length > 0;
}

export function repeatLabel(x) {
  const d = repeatDays(x);
  if (!d.length) return "";
  if (d.length === 7) return "EVERY DAY";
  return d
    .slice()
    .sort((a, b) => a - b)
    .map((n) => DAY_SHORT[n].toUpperCase())
    .join(" ");
}

// One occurrence of a repeat is keyed by its local calendar day — local rather
// than UTC, because a booking at 08:00 belongs to the day the department is
// standing in, not the day Greenwich is having. `localDayKey` further down
// already does exactly this and is what the history filter compares against, so
// this uses that rather than keeping a second idea of what a day is.

// How far ahead a repeating booking throws off real occurrences: today only.
//
// It was two days, on the reasoning that a desk wants some warning. In practice
// that put tomorrow's and the next day's dialysis runs on the board beside the
// calls actually being worked, and a dispatcher reading the board could not
// tell at a glance which of them were today's. The arrangement itself is
// visible in Schedule → Repeating, which is where somebody goes to see what is
// coming; the board carries what is happening now.
//
// Zero means the loop below runs for today alone, and the `at <= now` guard
// already drops one whose time has passed.
export const REPEAT_HORIZON_DAYS = 0;

export function repeatOccurrencesDue(template, now) {
  const days = repeatDays(template);
  if (!days.length || !template.scheduledFor) return [];
  const src = new Date(template.scheduledFor);
  const out = [];
  for (let i = 0; i <= REPEAT_HORIZON_DAYS; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    if (!days.includes(d.getDay())) continue;
    d.setHours(src.getHours(), src.getMinutes(), 0, 0);
    const at = d.getTime();
    // Never behind the clock, and never the template's own occurrence.
    if (at <= now) continue;
    if (localDayKey(at) === localDayKey(template.scheduledFor)) continue;
    out.push({ at, key: localDayKey(at) });
  }
  return out;
}

// The return leg of a call that has just finished, with the route reversed and
// everything about the patient carried across so nothing is retyped.
export function returnBookingFor(req, now) {
  const mode = req.returnMode;
  const at = mode === "timed" && req.returnAt ? req.returnAt : null;
  return {
    id: uid("sch"),
    station: stationOf(req),
    // Reversed. This is the whole point.
    locationFrom: callTo(req),
    locationTo: callFrom(req),
    nature: req.nature,
    priority: req.priority || "routine",
    mrn: req.mrn || "",
    requirements: req.requirements || [],
    notes: req.notes || "",
    callType: callTypeMeta(req.callType) ? req.callType : null,
    loadedKm: null,
    scheduledFor: at,
    dispatchAt: null,
    // No time given: it waits for the ward, which is the state the board
    // already knows how to hold.
    awaitCall: mode !== "timed",
    shift: at ? scheduledShiftKey(at) : null,
    // Deliberately unassigned. If the truck that took the patient out is on
    // something else when the ward rings, the patient should not wait for it.
    assignedUnitId: null,
    status: "scheduled",
    leg: "return",
    returnOf: req.id,
    // When the patient was actually delivered, so the wait for the ward to ring
    // is measurable — the gap nobody can currently evidence.
    deliveredAt: (req.times || {}).arrivalDestination || null,
    createdAt: now,
    createdBy: "Return leg",
  };
}

// Calls that have finished, were booked with a return, and have not had one
// made for them yet.
export function callsNeedingReturn(requests, scheduled) {
  const made = new Set(
    (scheduled || []).filter((s) => s && s.returnOf).map((s) => s.returnOf)
  );
  return (requests || []).filter(
    (r) =>
      r &&
      r.status === "completed" &&
      wantsReturn(r) &&
      !isReturnLeg(r) &&
      !made.has(r.id)
  );
}
// The next time an arrangement actually runs, looking a week forward. Unlike
// `repeatOccurrencesDue` this is not about putting anything on the board — it
// is the line on the card that answers "when is this patient next in", which
// the desk had to work out from a row of day names.
export function nextRepeatAt(template, now) {
  const days = repeatDays(template);
  if (!days.length || !template.scheduledFor) return null;
  const src = new Date(template.scheduledFor);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    if (!days.includes(d.getDay())) continue;
    d.setHours(src.getHours(), src.getMinutes(), 0, 0);
    const at = d.getTime();
    if (at > now) return at;
  }
  return null;
}

// One card per patient, not one per arrangement.
//
// A dialysis patient booked Monday, Wednesday and Friday at eight, and again on
// Saturday at two, is one patient with two standing arrangements. Drawn one
// card each they read as two unrelated runs, and a desk scanning the tab for
// "who is in this week" counted the same person twice. Keyed by MRN where there
// is one — the only thing on a booking that identifies a patient — and by the
// journey itself where there is not, because the same nature going from the
// same ward to the same clinic is the same standing run.
export function repeatPatientKey(x) {
  const mrn = String((x && x.mrn) || "").trim().toUpperCase();
  if (mrn) return `mrn:${mrn}`;
  const part = (s) => String(s || "").trim().toLowerCase();
  return `run:${part(x && x.nature)}|${part(callFrom(x))}|${part(callTo(x))}`;
}

// The arrangements grouped by patient, each group carrying the union of the
// days they run on and the next one that is actually due.
export function groupRepeatsByPatient(templates, now) {
  const groups = new Map();
  (templates || []).forEach((t) => {
    if (!t) return;
    const key = repeatPatientKey(t);
    if (groups.has(key)) groups.get(key).push(t);
    else groups.set(key, [t]);
  });
  return [...groups.entries()]
    .map(([key, list]) => {
      const entries = list
        .slice()
        .sort((a, b) => (a.scheduledFor || 0) - (b.scheduledFor || 0));
      const days = new Set();
      entries.forEach((e) => repeatDays(e).forEach((d) => days.add(d)));
      const nexts = entries.map((e) => nextRepeatAt(e, now)).filter((x) => x);
      return {
        key,
        entries,
        // The arrangement the card is titled from: the earliest in the day.
        lead: entries[0],
        days: [...days].sort((a, b) => a - b),
        nextAt: nexts.length ? Math.min(...nexts) : null,
      };
    })
    // Whoever is next through the door first. A group with nothing due — every
    // arrangement in it stopped or timeless — sinks to the bottom rather than
    // sorting as if it were due at midnight on the first of January.
    .sort((a, b) => (a.nextAt || Infinity) - (b.nextAt || Infinity));
}
