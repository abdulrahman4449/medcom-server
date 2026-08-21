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

// The occurrences a repeating booking should have in the window ahead. Only two
// days: the forward book is something a desk reads, and forty copies of the
// dialysis run stretching into next month is not a book, it is a wall.
export const REPEAT_HORIZON_DAYS = 2;

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