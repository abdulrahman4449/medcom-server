import { DEFAULT_STATION, stationOf } from "./live-sheet.jsx";
import { opDayStart } from "./op-day.jsx";
import { overtimeMs } from "./shift-helpers.jsx";
import { crewStampText } from "../export/name-stamps.jsx";

// ---------- who was signed into each medic ----------
//
// A medic number is not a person. Across one day the same MEDIC 3 can be worked
// by a day crew, then a night crew, then whoever swapped in when one of them ran
// into overtime — so a spreadsheet line that says only "MEDIC 3" is unsigned,
// and a supervisor reading the export back weeks later has no way to tell which
// of them it belongs to. Every medic in the export therefore carries a name
// stamp, and a medic that was signed in by more than one employee is listed
// again for each of them instead of squashing the names into one cell.
//
// The board itself only holds who is sitting in a seat right now, plus the last
// person to leave it (unit.lastCrew), so the full occupancy of a medic is
// reconstructed from the shift lines on the log sheet: SIGNED ON and a takeover
// SHIFT SWAP open a stay, SIGNED OFF closes it, OVERTIME records time carried
// past the shift end. The live seats and lastCrew are then folded in on top,
// which covers a board whose sign-on line was written before the log window
// currently held in memory.
export function medicCrewStamps(unit, log, now) {
  const at = now || Date.now();
  const stays = new Map();

  // One stay per employee, per seat, per shift they worked that seat. A crew
  // member who swapped from day to night without leaving the truck really did
  // work two shifts on that medic, so they are listed for both.
  //
  // Identity is resolved before it is keyed. The key used to be
  // `accountId || name`, so a sign-on line carrying the employee ID and a
  // sign-off line carrying only the name became two different people on the same
  // truck in the same seat — each holding half the record, which is why one name
  // appeared twice with different overtime against each. Names seen alongside an
  // ID are mapped to it first, so every line about one person lands on one key.
  const idByName = new Map();
  (log || []).forEach((e) => {
    const d = e && e.detail;
    if (d && d.role === "team" && d.accountId && d.name) {
      idByName.set(d.name.trim().toLowerCase(), d.accountId);
    }
  });
  const identityOf = (p) =>
    p.accountId ||
    idByName.get((p.name || "").trim().toLowerCase()) ||
    (p.name || "?").trim().toLowerCase();

  // A tour is a shift *on a date*, not the word "day".
  //
  // The key used to end in `p.shift`, which is only ever "day" or "night" — so
  // the same person, in the same seat, on the same kind of shift, two weeks
  // apart, was one stay. The merge then took the earliest sign-on and the
  // latest sign-off, producing a single stay that appeared to run for a
  // fortnight and therefore overlapped every call in between. That is a
  // date leak: it put people on shifts they had not worked, and it is exactly
  // what "no leaks from a certain day into the wrong date" is asking about.
  //
  // The window a stay was booked against is the tour. Where a line has no
  // window — an older board — the operational day it happened on stands in,
  // which still separates one Tuesday from the next.
  const tourOf = (p) =>
    p.shiftStart
      ? `w${p.shiftStart}`
      : `d${opDayStart(p.tourAt || p.signedOnAt || p.signedOffAt || at)}|${p.shift || ""}`;

  const keyOf = (p) => [identityOf(p), p.seat || "", tourOf(p)].join("|");

  const earlier = (a, b) => (a && b ? Math.min(a, b) : a || b || null);
  const later = (a, b) => (a && b ? Math.max(a, b) : a || b || null);

  const record = (p) => {
    if (!p || !p.name) return;
    const key = keyOf(p);
    const prev = stays.get(key);
    if (!prev) {
      stays.set(key, { ...p });
      return;
    }
    // A stay is pieced together from several lines (sign-on, overtime, sign-off),
    // each carrying only part of it — so a known value is never overwritten with
    // a blank one from another line.
    stays.set(key, {
      name: prev.name || p.name,
      accountId: prev.accountId || p.accountId,
      seat: prev.seat || p.seat,
      shift: prev.shift || p.shift,
      shiftStart: prev.shiftStart || p.shiftStart,
      shiftEnd: prev.shiftEnd || p.shiftEnd,
      signedOnAt: earlier(prev.signedOnAt, p.signedOnAt),
      signedOffAt: later(prev.signedOffAt, p.signedOffAt),
      // Two half-records merging: take the larger overtime rather than the
      // first, since either line may be the one that carried it.
      overtimeMs: Math.max(prev.overtimeMs || 0, p.overtimeMs || 0),
      onDutyNow: prev.onDutyNow || p.onDutyNow,
      tourAt: earlier(prev.tourAt, p.tourAt),
    });
  };

  const blank = (d, ts) => ({
    // When this line was written, so a stay with no shift window recorded can
    // still be placed on the right day.
    tourAt: ts || null,
    name: d.name || "",
    accountId: d.accountId || "",
    // Where this stamp was made. Carried on the stamp itself so the sheet can
    // refuse it if it ever reaches the wrong station's page — the check does not
    // depend on the matching above being right.
    station: d.station || null,
    unitId: d.unitId || null,
    seat: d.seat || null,
    shift: d.shift || null,
    shiftStart: d.shiftStart || null,
    shiftEnd: d.shiftEnd || null,
    signedOnAt: null,
    signedOffAt: null,
    overtimeMs: d.overtimeMs || 0,
    onDutyNow: false,
  });

  (log || [])
    .filter((e) => e.type === "shift" && e.detail && e.detail.role === "team")
    // Matched on the unit's id, not its name.
    //
    // Both stations run a MEDIC 1. Matching on the name alone meant a crew at
    // CCC could be counted against the Main Office truck of the same name, and
    // — worse for the statistics — anybody whose sign-on line carried an id but
    // a slightly different name string matched nothing at all and vanished from
    // the figures entirely. They had done the calls; they simply were not
    // findable. The id is the thing that is actually unique, so it decides, and
    // the name is only a fallback for older lines that predate it.
    // The name fallback must also match the station.
    //
    // Both stations run a MEDIC 1. A log line written before unit ids existed
    // carries only a name, so falling back to the name alone put Main Office's
    // crew onto CCC's UHU sheet and the other way round — somebody appeared on a
    // station they had never worked. Where there is an id it decides; where
    // there is not, the name must agree with the station as well.
    .filter((e) => {
      const d = e.detail || {};

      // The id decides, and nothing overrides it.
      //
      // A line that names a unit id belongs to that unit and to no other. The
      // old code fell through to a name comparison whenever the id was absent
      // on either side, and a renamed truck made that fallback dangerous:
      // rename CCC's MEDIC 1 to MEDIC 7 and a stale line could still find its
      // way onto the wrong sheet. Where both sides have ids, only the id counts.
      if (d.unitId && unit.id) return d.unitId === unit.id;

      // Neither side has an id: this is a board from before ids existed, and
      // those boards had one station. The name must match AND the line must be
      // from this truck's station — a line with no station recorded is treated
      // as the default station, never as "matches anywhere".
      if ((d.unitName || "") !== unit.name) return false;
      const lineStation = d.station || DEFAULT_STATION;
      return lineStation === stationOf(unit);
    })
    .slice()
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .forEach((e) => {
      const d = e.detail;
      if (d.kind === "off") {
        record({ ...blank(d, e.ts), signedOffAt: e.ts || null });
        return;
      }
      // A swap that names the shift it came from is one person re-basing their
      // own window mid-seat, so it also closes the stay they were on before it.
      // The overtime on that line was worked past the end of the shift being
      // left, so it stays with that stay rather than opening the new one an hour
      // already in hand.
      if (d.kind === "swap" && d.fromShift && d.fromShift !== d.shift) {
        record({ ...blank(d, e.ts), shift: d.fromShift, shiftStart: null, shiftEnd: null, signedOffAt: e.ts || null });
        record({ ...blank(d, e.ts), overtimeMs: 0, signedOnAt: e.ts || null });
        return;
      }
      record({ ...blank(d, e.ts), signedOnAt: e.ts || null });
    });

  ["alpha", "bravo"].forEach((slot) => {
    const seated = unit[slot];
    if (seated) {
      record({
        ...blank({ ...seated, seat: slot }, seated.signedOnAt || at),
        signedOnAt: seated.signedOnAt || null,
        overtimeMs: overtimeMs(seated, at),
        onDutyNow: true,
      });
    }
    const last = unit.lastCrew ? unit.lastCrew[slot] : null;
    if (last) {
      record({
        ...blank({ ...last, seat: slot }, last.signedOnAt || last.signedOffAt || null),
        signedOnAt: last.signedOnAt || null,
        signedOffAt: last.signedOffAt || null,
      });
    }
  });

  // Oldest stay first, so the medic's rows read down the sheet in the order the
  // seats actually changed hands. Anything with no recorded sign-on time sorts
  // last rather than pretending to be the first crew of the day.
  return Array.from(stays.values())
    // Someone who signed off and then took the same seat again on the same shift
    // is one stay holding an old sign-off time. They are sitting there now, so
    // the sign-off is dropped rather than left contradicting the duty column.
    .map((p) => (p.onDutyNow ? { ...p, signedOffAt: null } : p))
    .sort((a, b) => {
      const on = (p) => (p.signedOnAt == null ? Infinity : p.signedOnAt);
      if (on(a) !== on(b)) return on(a) - on(b);
      return String(a.seat).localeCompare(String(b.seat));
    });
}

// When a stay held the medic, for lining crew up against the calls they ran. A
// stay still open runs to the moment the export was taken.
export function stayWindow(person, now) {
  const start = person.signedOnAt || person.shiftStart || null;
  const end = person.signedOffAt || (person.onDutyNow ? now : person.shiftEnd) || now;
  return { start, end };
}

// Every medic's crew stays, worked out once and reused for each call row rather
// than rebuilt from the log for each of them.
export function medicCrewIndex(units, log, now) {
  return new Map(units.map((u) => [u.id, medicCrewStamps(u, log, now)]));
}

// The name stamps of whoever was signed into this medic while a call was running.
// A stay with no recorded sign-on time can't be placed against a call, so it is
// left out here rather than attributed to a call it may have had nothing to do
// with — the medic sheet still lists it in full.
export function medicCrewStampsDuring(unit, crewIndex, from, to, now) {
  if (!unit || !from) return "";
  return (crewIndex.get(unit.id) || [])
    .filter((p) => {
      const w = stayWindow(p, now);
      return w.start && w.start <= (to || from) && w.end >= from;
    })
    .map((p) => crewStampText(unit.name, p))
    .filter(Boolean)
    .join(" / ");
}