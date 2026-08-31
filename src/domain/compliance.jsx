import { callWasCancelled } from "./close-reasons.jsx";

// ---------- emergency response compliance ----------
//
// The department's own standard: an internal emergency should be with the
// patient inside ten minutes. Measured from the moment dispatch raises the call
// to the moment the crew reaches the destination — the whole journey the
// patient waits through, not the part that flatters the figure.
//
// Only internal emergencies are counted. An external call is a drive, and
// mixing the two produced an average that described neither.
export const RESPONSE_TARGET_MS = 10 * 60 * 1000;
export const RESPONSE_GOOD = 90; // per cent, at which the gauge reads green

// The other three department measures, and where each one stops being
// comfortable. Two of them are compliance figures and want to be high; UHU is
// not — it is how much of the fleet's time is already spoken for, and a service
// running above this has no capacity left for the call it has not had yet.
export const PCR_GOOD = 95;
export const CHECKLIST_GOOD = 90;
export const UHU_HEADROOM = 50;

// What the department set itself: 45 per cent of a shift spent on calls,
// measured across every member of crew rather than across the vehicles. A
// truck's utilisation counts the hours the truck existed; a department is
// staffed by people, and people are what it rosters, pays and runs out of.
//
// Dispatchers are deliberately not in this figure. Their work is not measured
// by time on a call and counting them at nought would drag the department's
// number down while describing nobody - they need a measure of their own, and
// it has not been defined yet.
export const UHU_TARGET = 45;

export function isInternalEmergency(req) {
  return (req && req.callCategory) === "EMERGENCY (INTERNAL)";
}

// The clock that is being judged: raised → arrived at the destination.
export function responseMsFor(req) {
  const t = (req && req.times) || {};
  if (!req || !req.createdAt || !t.arrivalDestination) return null;
  return t.arrivalDestination - req.createdAt;
}

export function responseCompliance(requests, from, to) {
  const measured = (requests || []).filter(
    (r) =>
      isInternalEmergency(r) &&
      r.createdAt >= from &&
      r.createdAt < to &&
      responseMsFor(r) !== null
  );
  const within = measured.filter((r) => responseMsFor(r) <= RESPONSE_TARGET_MS);
  // Calls with no response time on them, split by WHY they have none.
  //
  // They used to be one number under one sentence — "not yet measurable, still
  // running or closed without arriving" — and on a real month that number was
  // fifty-two against thirty-four measured, which reads as a department with a
  // huge backlog of open emergencies. It is not. Almost all of them are calls
  // the desk stood down before the crew reached anybody: there is no response
  // time, there never will be one, and nothing is outstanding.
  //
  // A call called off is not a call waiting, so the two are counted apart. A
  // stood-down call is excluded from the figure with no apology; one still
  // running is genuinely not measured YET and is the only one worth a line.
  const noTime = (requests || []).filter(
    (r) => isInternalEmergency(r) && r.createdAt >= from && r.createdAt < to && responseMsFor(r) === null
  );
  // "Still open" must mean literally open on the board. A CLOSED call with no
  // arrival time will never get one, whatever the reason it closed for — a
  // refusal never reaches a destination, a timeline the desk closed unfinished
  // has no stamp to read, and a call closed before the close-reason box existed
  // carries no reason for the cancellation test to match. Every one of those
  // used to read "still open" for ever, which dressed a pile of unmeasurable
  // history up as a backlog of live emergencies.
  const running = noTime.filter((r) => r.status !== "completed").length;
  const closed = noTime.filter((r) => r.status === "completed");
  const calledOff = closed.filter((r) => callWasCancelled(r)).length;
  const closedNoTime = closed.length - calledOff;
  const pct = measured.length ? (within.length / measured.length) * 100 : null;
  const avg = measured.length
    ? measured.reduce((sum, r) => sum + responseMsFor(r), 0) / measured.length
    : null;
  return {
    pct,
    avg,
    total: measured.length,
    within: within.length,
    running,
    calledOff,
    closedNoTime,
    // Everything excluded from the figure, as one number for one sentence.
    notCounted: calledOff + closedNoTime,
    // Kept for anything still reading the old name.
    unmeasured: noTime.length,
  };
}