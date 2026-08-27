import { callFrom, callTo } from "./call-locations.jsx";
import { stationOf } from "./live-sheet.jsx";
import { callStartTs } from "./uhu.jsx";

// ---------- the patient record ----------
//
// The desk takes a call about a patient it has moved eleven times already, and
// has no way to know that. Everything the board holds about them is on the
// board — spread across eleven separate call cards, in three closed shifts and
// two archived days, findable only by remembering roughly when.
//
// This gathers them by the one thing on a transfer that identifies a person:
// the MRN. Not a name — names on this board are typed by whoever answered the
// phone and are spelled three ways by Thursday. An MRN is the hospital's own
// key and it is the field the desk already fills in.
//
// It is a read, and only a read. Nothing here writes anything, nothing is kept
// that the board was not already keeping, and a patient with no MRN on their
// calls simply does not appear — which is correct: there is nothing to join
// them by, and guessing from a ward name would put two people's journeys on
// one record.

// The same patient, however it was typed.
//
// One dispatcher writes MRN-1234, the next writes mrn 1234, and a third writes
// MRN1234. They are one person, and joining on the raw string made them three
// records with four journeys between them — which is worse than no record at
// all, because it answers "have we had them before" with "no". Spaces and
// hyphens are the only things people vary; nothing else is stripped, so two
// genuinely different numbers can never collide.
export function normalMrn(x) {
  return String((x && x.mrn) || "").replace(/[\s-]/g, "").toUpperCase();
}

// One journey, whether it was a call that ran or a booking that has not yet.
function journeyOf(x, kind) {
  const at = kind === "call" ? callStartTs(x) || x.createdAt || x.ts || 0 : x.scheduledFor || x.createdAt || 0;
  return {
    id: x.id,
    kind,
    mrn: normalMrn(x),
    at,
    nature: x.nature || "",
    from: callFrom(x),
    to: callTo(x),
    priority: x.priority || "",
    callType: x.callType || null,
    station: stationOf(x),
    unitId: x.assignedUnitId || null,
    status: x.status || "",
    requirements: Array.isArray(x.requirements) ? x.requirements : [],
    notes: x.notes || "",
  };
}

// Every journey the board can still see: what is live, what is booked, and what
// has been archived into a kept day. Deduplicated by id, because an archived
// day holds its own copy of calls that may still be on the live board.
export function allJourneys(requests, scheduled, archives) {
  const seen = new Set();
  const out = [];
  const push = (x, kind) => {
    if (!x || !x.id || seen.has(x.id)) return;
    if (!normalMrn(x)) return;
    seen.add(x.id);
    out.push(journeyOf(x, kind));
  };
  (requests || []).forEach((r) => push(r, "call"));
  (scheduled || []).forEach((s) => push(s, "booking"));
  (archives || []).forEach((a) => {
    (a && a.requests ? a.requests : []).forEach((r) => push(r, "call"));
    (a && a.scheduled ? a.scheduled : []).forEach((s) => push(s, "booking"));
  });
  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}

// The most common value in a list, and how often. Used for "the journey this
// patient usually makes" — which is the answer a desk taking a repeat booking
// actually wants, rather than the most recent one, since the most recent one
// might be the outlier.
function commonest(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  let best = null;
  let n = 0;
  counts.forEach((c, v) => {
    if (c > n) { n = c; best = v; }
  });
  return best;
}

// One record per patient, newest first.
export function patientRecords(requests, scheduled, archives) {
  const byMrn = new Map();
  allJourneys(requests, scheduled, archives).forEach((j) => {
    if (byMrn.has(j.mrn)) byMrn.get(j.mrn).push(j);
    else byMrn.set(j.mrn, [j]);
  });
  return [...byMrn.entries()]
    .map(([mrn, journeys]) => {
      const reqs = new Set();
      journeys.forEach((j) => j.requirements.forEach((r) => reqs.add(r)));
      const route = commonest(journeys.map((j) => (j.from && j.to ? `${j.from} → ${j.to}` : "")));
      // "Last" has to mean the last time they were actually moved, and a
      // patient with a booking on the book has a journey dated next Tuesday. It
      // was being reported as "last 3 September" — a date in the future, under
      // a word that means the past.
      const now = Date.now();
      const past = journeys.filter((j) => j.at && j.at <= now);
      const ahead = journeys.filter((j) => j.at && j.at > now);
      return {
        mrn,
        journeys,
        count: journeys.length,
        lastAt: past.length ? past[0].at : 0,
        nextAt: ahead.length ? ahead[ahead.length - 1].at : 0,
        firstAt: journeys[journeys.length - 1] ? journeys[journeys.length - 1].at : 0,
        usualRoute: route || "",
        usualNature: commonest(journeys.map((j) => j.nature)) || "",
        station: commonest(journeys.map((j) => j.station)) || "",
        requirements: [...reqs],
        // Anything still to come: a booking on the book, or a call running now.
        openCount: journeys.filter(
          (j) => (j.kind === "booking" && j.status === "scheduled") ||
                 (j.kind === "call" && j.status !== "completed" && j.status !== "cancelled")
        ).length,
      };
    })
    // Whoever the desk is most likely to be asked about: the most recent
    // activity either way round, so a patient booked for tomorrow morning
    // outranks one last moved a fortnight ago.
    .sort((a, b) => Math.max(b.lastAt || 0, b.nextAt || 0) - Math.max(a.lastAt || 0, a.nextAt || 0));
}

// What a desk types when it is looking for somebody: the MRN off the referral,
// or the ward, or what was wrong with them.
export function recordMatches(record, q) {
  if (!q) return true;
  const hay = [
    record.mrn,
    record.usualRoute,
    record.usualNature,
    ...record.journeys.map((j) => `${j.nature} ${j.from} ${j.to} ${j.notes}`),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}
