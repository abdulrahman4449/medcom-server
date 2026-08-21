import { isStaffed, liveRequestFor } from "./in-service.jsx";
import { STATIONS, stationLabel, stationOf } from "./live-sheet.jsx";
import { msDurationStr } from "./messages.jsx";
import { SHIFT_MS } from "./shifts.jsx";
import { uid } from "../lib/helpers.jsx";
import { readKey, writeKey } from "../lib/offline-queue.jsx";

// ---------- no coverage ----------
//
// The station has nothing left to send: every truck is out with a patient. It is
// a state of the station rather than a call, and it is the single most important
// thing the department has to be able to evidence — how long, how often, and
// when. Until now it lived in somebody's memory of a bad Tuesday.
//
// Zahrawi is excluded from the test. It runs its own service and its
// availability does not mean the main fleet can answer a call.
//
// It is declared by the desk, because the desk is the one who knows a call is
// waiting and nothing is free. It ends on its own the moment any team is back in
// service — nobody has to remember to press it again, which is exactly the
// moment nobody would.
export const COVERAGE_KEY = "ems:coverage";
export const COVERAGE_CAP = 500;

export function isZahrawi(unit) {
  return /ZAHRAWI|^ZAH$/i.test((unit && unit.name) || "");
}

// Zahrawi stands a shorter tour than the rest of the fleet — nine and a half
// hours against twelve. It is the denominator of every UHU figure its crews
// appear in, so it has to be the department's number and not a rounded twelve.
export const ZAHRAWI_SHIFT_HOURS = 9.5;
export const ZAHRAWI_SHIFT_MS = ZAHRAWI_SHIFT_HOURS * 60 * 60 * 1000;

export function shiftMsForUnit(unit) {
  return isZahrawi(unit) ? ZAHRAWI_SHIFT_MS : SHIFT_MS;
}

// The units that count towards coverage at a station.
export function coverageUnits(units, station) {
  return (units || []).filter((u) => stationOf(u) === station && !isZahrawi(u) && isStaffed(u));
}

// Is any of them free to take a call?
export function stationHasCoverage(units, requests, station) {
  const fleet = coverageUnits(units, station);
  if (!fleet.length) return false;
  return fleet.some((u) => !liveRequestFor(u, requests));
}

// Who declared or ended a gap. Anything the board wrote itself reads as
// Automatic; a person's name is kept as it is.
export function coverageActor(text) {
  const t = (text || "").trim();
  if (!t) return "Automatic";
  if (/automatic|first team back|every team|detected/i.test(t)) return "Automatic";
  return t;
}

export function openCoverageGap(list, station) {
  return (list || []).find((c) => c && c.station === station && !c.endedAt) || null;
}

export async function startCoverageGap({ station, by, units, requests, list, addLog }) {
  const existing = (await readKey(COVERAGE_KEY, list)) || [];
  if (openCoverageGap(existing, station)) return false;
  const entry = {
    id: uid("cov"),
    station,
    startedAt: Date.now(),
    startedBy: by || "Dispatch",
    // What the board looked like when it was declared, so the record can be read
    // back without having to reconstruct it.
    unitsOut: coverageUnits(units, station).map((u) => u.name),
    endedAt: null,
    endedBy: null,
  };
  const next = [entry, ...existing].slice(0, COVERAGE_CAP);
  const ok = await writeKey(COVERAGE_KEY, next);
  if (!ok) return false;
  await addLog(
    `NO COVERAGE declared at ${stationLabel(station)} by ${by || "Dispatch"} — ` +
      `${entry.unitsOut.length} team${entry.unitsOut.length === 1 ? "" : "s"} out with patients` +
      (entry.unitsOut.length ? ` (${entry.unitsOut.join(", ")})` : ""),
    "status"
  );
  return true;
}

// Opened by the board as well as closed by it.
//
// Asking the desk to press a button at the exact moment the last ambulance goes
// out gets the record wrong in both directions: it is missed entirely on the
// busiest nights, when the desk has a phone in each hand, and it starts late
// even when it is remembered. The board already knows the moment it becomes
// true — every staffed team out with a patient, Zahrawi aside — so it says so
// itself, and the desk is told rather than asked.
export async function openCoverageGapIfStuck({ units, requests, list, addLog }) {
  const byStation = STATIONS.map((st) => st.key);
  let opened = 0;
  for (const station of byStation) {
    const fleet = coverageUnits(units, station);
    // A station with nobody signed on is not "without coverage" — it is closed.
    // Recording a gap for it every night would bury the real ones.
    if (!fleet.length) continue;
    if (stationHasCoverage(units, requests, station)) continue;
    const existing = (await readKey(COVERAGE_KEY, list)) || [];
    if (openCoverageGap(existing, station)) continue;
    const entry = {
      id: uid("cov"),
      station,
      startedAt: Date.now(),
      startedBy: "Detected automatically",
      auto: true,
      unitsOut: fleet.map((u) => u.name),
      endedAt: null,
      endedBy: null,
    };
    const ok = await writeKey(COVERAGE_KEY, [entry, ...existing].slice(0, COVERAGE_CAP));
    if (!ok) continue;
    opened += 1;
    await addLog(
      `NO COVERAGE at ${stationLabel(station)} — every team is out with a patient ` +
        `(${entry.unitsOut.join(", ")})`,
      "status"
    );
  }
  return opened;
}

// Closed by the board, not by a person: the first team back in service ends it.
export async function closeCoverageGapIfClear({ units, requests, list, addLog }) {
  const existing = (await readKey(COVERAGE_KEY, list)) || [];
  const open = existing.filter((c) => c && !c.endedAt);
  if (!open.length) return 0;
  const now = Date.now();
  let closed = 0;
  const next = existing.map((c) => {
    if (!c || c.endedAt) return c;
    if (!stationHasCoverage(units, requests, c.station)) return c;
    closed += 1;
    return { ...c, endedAt: now, endedBy: "First team back in service" };
  });
  if (!closed) return 0;
  await writeKey(COVERAGE_KEY, next);
  for (const c of next.filter((x) => x && x.endedAt === now)) {
    await addLog(
      `Coverage restored at ${stationLabel(c.station)} after ` +
        `${msDurationStr(c.endedAt - c.startedAt)} with no ambulance available`,
      "status"
    );
  }
  return closed;
}

// The gaps that fall inside a window, for the sheet.
export function coverageGapsIn(list, station, from, to) {
  return (list || [])
    .filter((c) => c && c.station === station && c.startedAt >= from && c.startedAt < to)
    .sort((a, b) => a.startedAt - b.startedAt);
}

// The gaps a submitted shift is answerable for.
//
// Normally they travel with the submission, filed at the moment it was made.
// Shifts filed before that started working carry an empty list, and there is no
// way to tell an empty list apart from a shift that genuinely had no gaps — so
// where the submission has none recorded, the live record is asked instead and
// cut to that shift's own station and window. A shift that really had none
// still comes back with none; one whose gaps were lost gets them back.
export function submissionGaps(sub, liveCoverage) {
  if (!sub) return [];
  if (sub.coverage && sub.coverage.length) return sub.coverage;
  return coverageGapsIn(liveCoverage, sub.station, sub.windowStart, sub.windowEnd);
}