import { callFrom, callTo } from "./call-locations.jsx";
import { callCloseReason } from "./close-reasons.jsx";
import { REQ_STATUS } from "./constants.jsx";
import { ZAHRAWI_SHIFT_MS, coverageActor, isZahrawi } from "./coverage.jsx";
import { stayWindow } from "./crew-stamps.jsx";
import { STATIONS, stationLabel, stationOf } from "./live-sheet.jsx";
import { clockStr, durationStr, otHoursStr } from "./messages.jsx";
import { opDayEnd, opDayLabel, opDayStart } from "./op-day.jsx";
import { REFUSAL_TIME_KEY } from "./outcomes.jsx";
import { pcrAuthorStamp } from "./pcr-author.jsx";
import { journeyLabel } from "./return-journeys.jsx";
import { assistOf, assistTeamNames, callOutcomeLabel } from "./second-ambulance.jsx";
import { missingLogFields } from "./sheet-gaps.jsx";
import { scheduledShiftKey, seatLabel, shiftDateOf, shiftLabelWithWindow, shiftMeta, shiftWindowFor } from "./shift-helpers.jsx";
import { SHIFT_EVENTS, SHIFT_MS } from "./shifts.jsx";
import { computePersonUhu } from "./uhu.jsx";
import { gregDateTimeStr } from "../lib/dates.jsx";

// ---------- UHU as a person, not as a seat ----------
//
// The sheet used to print one row per stay: a name, the truck it sat in and the
// seat it sat in. Somebody who moved from MEDIC 2 to MEDIC 5 halfway through
// appeared twice, each with a fraction of a shift's worth of calls and a
// percentage that was true of neither half — and a supervisor adding the two
// together got a number that meant nothing.
//
// A shift is a person's, so the row is a person's: name and employee ID, their
// calls across whatever they sat in, and their time on call over their own
// tour. The trucks are still carried for the detailed spreadsheet; the printed
// report drops them, because on the report they were only ever noise.
export function personUhuRows(units, crewIndex, requests, now, from, to) {
  const byPerson = new Map();
  const order = [];

  (units || [])
    .slice()
    .sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" })
    )
    .forEach((unit) => {
      // Belt and braces: a stamp recorded at one station can never be counted
      // into another station's sheet, whatever happened upstream.
      const stamps = (crewIndex.get(unit.id) || []).filter(
        (p) => p && (!p.station || p.station === stationOf(unit))
      );

      stamps.forEach((p) => {
        const name = String(p.name || "").trim();
        if (!name) return;
        // Second guard, on the date this time. A truck carries its current crew
        // and its `lastCrew` regardless of when they sat there, so without this
        // a shift report lists people who were not on it — with nought calls
        // and nought per cent, which reads as a crew who did nothing rather
        // than as a crew who were not there. A stay counts only if it actually
        // overlaps the window being reported.
        if (typeof from === "number" && typeof to === "number") {
          const w = stayWindow(p, now);
          if (!w.start || w.start >= to || w.end <= from) return;
        }
        // Employee ID first — two people can share a name, and one person can
        // be stamped with and without an ID across a changeover.
        const key = p.accountId ? `id:${p.accountId}` : `name:${name.toUpperCase()}`;
        let agg = byPerson.get(key);
        if (!agg) {
          agg = {
            key,
            name,
            id: p.accountId || "",
            teams: [],
            on: null,
            off: null,
            stillOn: false,
            otMs: 0,
            totalMs: 0,
            seen: new Set(),
            onlyZahrawi: true,
          };
          byPerson.set(key, agg);
          order.push(agg);
        }
        const row = computePersonUhu(unit, p, requests, now, from, to);
        agg.totalMs += row.totalMs;
        row.callIds.forEach((id) => agg.seen.add(id));
        if (unit.name && !agg.teams.includes(unit.name)) agg.teams.push(unit.name);
        if (!isZahrawi(unit)) agg.onlyZahrawi = false;
        if (p.signedOnAt) agg.on = agg.on === null ? p.signedOnAt : Math.min(agg.on, p.signedOnAt);
        if (p.signedOffAt) agg.off = agg.off === null ? p.signedOffAt : Math.max(agg.off, p.signedOffAt);
        else agg.stillOn = true;
        agg.otMs += p.overtimeMs || 0;
      });
    });

  return order.map((a) => {
    // One shift, however many trucks it was spent across. Zahrawi's nine and a
    // half only applies to somebody who spent the whole shift on Zahrawi.
    const shiftMs = a.onlyZahrawi ? ZAHRAWI_SHIFT_MS : SHIFT_MS;
    const pct = shiftMs > 0 ? Math.min(100, (a.totalMs / shiftMs) * 100) : 0;
    return {
      name: a.name,
      id: a.id,
      teams: a.teams.join(", "),
      on: a.on ? clockStr(a.on) : "",
      off: a.stillOn ? "Still on" : a.off ? clockStr(a.off) : "",
      ot: a.otMs ? otHoursStr(a.otMs) : "",
      otMs: a.otMs,
      calls: a.seen.size,
      totalMs: a.totalMs,
      shiftMs,
      uhu: pct.toFixed(1),
      pct,
    };
  });
}

// Builds a sheet matching the column layout of the hospital's own
// "DISPATCH LOG" template (FROM / TO / PT. MRN. / MEDIC TEAM / TRUCK / ...).
// FROM and TO are the pickup point and the destination the call was raised
// with; APPT. TIME is filled in for a call that came off the scheduled board
// and is blank for one phoned in on the spot. PCR AUTHOR is the crew member the
// team named as writing the patient care report for that call, stamped with the
// seat they were in. CAT. OF CALL and KILO METER carry the codes the desk or the
// crew put on the call (A/B/C/D/E/NA and the 1–5 loaded-distance band), as bare
// codes, because that is what the template's own columns expect — a call nobody
// coded leaves them blank exactly as before. The two columns this app still
// doesn't collect (TYPE OF SERVICE, ADDED SERVICE) are
// left blank for the same row so the sheet can still be completed by hand
// afterward. Five extra columns (Priority, Requirements, Shift, Shift Date, and
// the name stamps of the crew who were signed into that medic while the call
// ran) are appended at the end since they don't exist in the original template
// but are data this app already has. SHIFT names the 12-hour window the call
// belongs to and spells the window out — DAY (07:00 – 19:00) or
// NIGHT (19:00 – 07:00) — and SHIFT DATE is the day that window opened, so a
// night that runs past midnight stays one block on the sheet rather than
// splitting across two dates. MEDIC TEAM on its own only names a truck, so the
// stamp column is what ties each line to the people who ran it. The rest follow
// them for what the original sheet has no room for and a supervisor still has to
// be able to read back: whether anyone was actually transported, when the
// patient refused, any second team that was sent to help, the day the call ran
// (the time columns are clock times, and an export can cover more than one day),
// where the call stands, and — for a call that came off the scheduled board —
// the booking behind it.
//
// This is the one sheet in the export that carries a call. Everything the app
// holds about one goes on its row here and is not repeated on another sheet.
// The dispatch log, laid out as the department's own sheet lays it out.
//
// Column order, headings and spelling are taken from the log sheet in use, so a
// month exported from here drops into the same place in the same order as a
// month typed by hand. Where the app knows something the sheet asks for, it is
// filled; where it does not, the cell is left empty rather than guessed at.
//
// The night shift is shaded. A call raised after 19:00 belongs to the night, and
// on a printed month the two shifts were indistinguishable without reading every
// time — so the night's rows carry a black fill and white figures, which is how
// the department already marks them by hand.
export function isNightCall(req) {
  return scheduledShiftKey(req && req.createdAt ? req.createdAt : 0) === "night";
}

// The service the call was run as, in the sheet's own vocabulary.
//
// Two faults here, both of which put nothing in the column. callTypeOf returns
// the whole meta object rather than its key, so every comparison against a
// letter failed; and the mapping itself was wrong — C is the app's CRITICAL,
// which the sheet calls CCT, and D is an auxiliary run, which the sheet has no
// service type for at all.
export function serviceTypeFor(req) {
  const key = req && req.callType ? String(req.callType) : "";
  if (!key) return "";
  const map = { A: "ALS", B: "BLS", C: "CCT", D: "BLS", E: "NA", NA: "NA" };
  return map[key] || key;
}

// The kilometre band, as the sheet numbers it. Same fault: the helper hands
// back a description, and the column wants the band.
export function loadedKmFor(req) {
  return req && req.loadedKm ? String(req.loadedKm) : "";
}

// Fill a set of rows with a colour and a legible figure colour.
export function paintRows(sheet, rows, offset, bg, fg) {
  if (!rows || !rows.length || !sheet["!ref"]) return sheet;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  rows.forEach((r) => {
    const rowIdx = r + (offset || 0);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIdx, c })];
      if (!cell) continue;
      cell.s = {
        ...(cell.s || {}),
        fill: { patternType: "solid", fgColor: { rgb: bg } },
        font: { ...((cell.s || {}).font || {}), color: { rgb: fg }, bold: true },
      };
    }
  });
  return sheet;
}

// A colour per call category, so a month is readable by scanning.
//
// Grouped by what the department does rather than by a palette: emergencies
// red, codes deep red, scheduled work blue, programmes green, administrative
// grey. Somebody looking for how many emergencies ran last Tuesday should not
// have to read twenty rows to count them.
export const CATEGORY_FILLS = {
  "EMERGENCY (INTERNAL)": ["FFC00000", "FFFFFFFF"],
  "EMERGENCY (EXTERNAL)": ["FFE06666", "FF1A1A1A"],
  "PROTOCOL EMERGENCY": ["FFC55A11", "FFFFFFFF"],
  CODE: ["FF7F0000", "FFFFFFFF"],
  "MOBILE STROKE UNIT": ["FF7F0000", "FFFFFFFF"],
  "CHEST PAIN PROGRAM": ["FFE06666", "FF1A1A1A"],
  "RRT TRANSPORT": ["FFE06666", "FF1A1A1A"],
  ROUTINE: ["FF2E75B6", "FFFFFFFF"],
  "CCC ROUTINE": ["FF9DC3E6", "FF1A1A1A"],
  DISCHARGE: ["FF9DC3E6", "FF1A1A1A"],
  "DIRECT ADMISSION": ["FFBDD7EE", "FF1A1A1A"],
  "DEM ADMISSION": ["FFBDD7EE", "FF1A1A1A"],
  "STAT PROCEDURE": ["FF2E75B6", "FFFFFFFF"],
  "HOME HEALTH CARE": ["FF548235", "FFFFFFFF"],
  "HOME VENT PROGRAM": ["FF548235", "FFFFFFFF"],
  TRANSPLANT: ["FF375623", "FFFFFFFF"],
  MEDEVAC: ["FF7030A0", "FFFFFFFF"],
  "COMMERCIAL FLIGHT": ["FFB4A7D6", "FF1A1A1A"],
  "FLIGHT ASSESSMENT": ["FFB4A7D6", "FF1A1A1A"],
  ADMINISTRATIVE: ["FFBFBFBF", "FF1A1A1A"],
  CANCELLED: ["FF808080", "FFFFFFFF"],
  "NO COVERAGE": ["FF000000", "FFFFFFFF"],
  NA: ["FFD9D9D9", "FF1A1A1A"],
};

// The two coded columns, coloured by what they mean.
//
// Service level runs cool to hot: a basic transfer green, an advanced one
// amber, a critical care transfer red. Cat. of call follows the same idea, with
// C in yellow as the department reads it. Anything marked NA goes dark grey —
// it is a deliberate "not applicable", not a gap, and it should look settled
// rather than missing.
export const SERVICE_FILLS = {
  BLS: ["FF2E7D32", "FFFFFFFF"],
  ALS: ["FFE8A33D", "FF1A1A1A"],
  CCT: ["FFC62828", "FFFFFFFF"],
  E: ["FF6A1B9A", "FFFFFFFF"],
  NA: ["FF4A4A4A", "FFFFFFFF"],
};

export const CALLTYPE_FILLS = {
  A: ["FF2E7D32", "FFFFFFFF"],
  B: ["FF1565C0", "FFFFFFFF"],
  // C is the critical call; CCT is the critical transfer. Same level of work,
  // so the same red — a reader should not have to learn two colours for one idea.
  C: ["FFC62828", "FFFFFFFF"],
  D: ["FF6A1B9A", "FFFFFFFF"],
  E: ["FF8D6E63", "FFFFFFFF"],
  NA: ["FF4A4A4A", "FFFFFFFF"],
};

export function paintCodedColumn(sheet, colIndex, table, headerRow) {
  if (colIndex < 1 || !sheet["!ref"]) return sheet;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c: colIndex })];
    if (!cell || !cell.v) continue;
    const fill = table[String(cell.v).trim().toUpperCase()];
    if (!fill) continue;
    cell.s = {
      ...(cell.s || {}),
      fill: { patternType: "solid", fgColor: { rgb: fill[0] } },
      font: { name: XL_FONT, color: { rgb: fill[1] }, bold: true, sz: 10 },
      alignment: { horizontal: "center", vertical: "center" },
    };
  }
  return sheet;
}

export function paintCategoryColumn(sheet, aoa, offset, colIndex) {
  if (colIndex < 0 || !sheet["!ref"]) return sheet;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c: colIndex })];
    if (!cell || !cell.v) continue;
    const fill = CATEGORY_FILLS[String(cell.v).trim()];
    if (!fill) continue;
    cell.s = {
      ...(cell.s || {}),
      fill: { patternType: "solid", fgColor: { rgb: fill[0] } },
      font: { name: XL_FONT, ...((cell.s || {}).font || {}), color: { rgb: fill[1] }, bold: true, sz: 10 },
      alignment: { horizontal: "center", vertical: "center" },
    };
  }
  return sheet;
}

// The header band, and the panes that keep it in view.
// The workbook in the same house style as the report.
//
// The two were arriving looking like they came from different departments: the
// PDF set in Helvetica with a green band and generous rows, the spreadsheet in
// whatever Excel opened with. Somebody receiving both should not have to work
// out they are the same document in two formats — so the font, the sizes, the
// title block and the colours are set here once and used by every sheet.
export const XL_FONT = "Helvetica Neue";

export function titleSheet(sheet, title, subtitle) {
  const t = sheet["A1"];
  if (t) {
    t.s = {
      font: { name: XL_FONT, sz: 16, bold: true, color: { rgb: "FF16222E" } },
      alignment: { vertical: "center", horizontal: "left", wrapText: false },
    };
  }
  const sub = sheet["A2"];
  if (sub) {
    sub.s = {
      font: { name: XL_FONT, sz: 10, color: { rgb: "FF5A6B7B" } },
      alignment: { vertical: "center", horizontal: "left", wrapText: false },
    };
  }
  // Room for the title at its own size. The row was 26 points high carrying
  // 16-point type, so a station name with a descender in it was being clipped
  // rather than shown.
  const rows = sheet["!rows"] || [];
  rows[0] = { ...(rows[0] || {}), hpt: 34 };
  rows[1] = { ...(rows[1] || {}), hpt: 20 };
  sheet["!rows"] = rows;
  return sheet;
}

export function dressSheet(sheet, headerRowIndex, firstDataCol) {
  if (!sheet["!ref"]) return sheet;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRowIndex, c })];
    if (!cell) continue;
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "FF0A5540" } },
      font: { name: XL_FONT, color: { rgb: "FFFFFFFF" }, bold: true, sz: 10 },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        bottom: { style: "thin", color: { rgb: "FF063A2C" } },
        right: { style: "hair", color: { rgb: "FF2F6B57" } },
      },
    };
  }
  // Scrolling a month of calls with the headings off the top is how a column
  // gets read as the wrong column.
  sheet["!freeze"] = { xSplit: firstDataCol || 1, ySplit: headerRowIndex + 1 };
  // Room for a wrapped name. At the default height a two-part surname was
  // clipped rather than wrapped, and looked like it had run into the column
  // beside it.
  const rows = sheet["!rows"] || [];
  for (let r = headerRowIndex; r <= XLSX.utils.decode_range(sheet["!ref"]).e.r; r++) {
    rows[r] = { ...(rows[r] || {}), hpt: r === headerRowIndex ? 34 : 30 };
  }
  sheet["!rows"] = rows;
  sheet["!autofilter"] = {
    ref: XLSX.utils.encode_range(
      { r: headerRowIndex, c: range.s.c },
      { r: range.e.r, c: range.e.c }
    ),
  };
  return sheet;
}

// Everything a finished log sheet needs, in one place and in the right order:
// the header band and frozen panes, the night shift shaded, and the call
// category coloured. Order matters — the category colour is applied last so a
// night row does not blacken over it.
// A hairline around every data cell.
//
// Applying a fill replaces a cell's style object, so the shaded rows and the
// coloured categories were landing with their borders stripped and the sheet
// lost its grid wherever it was most colourful. Borders go on last, merged into
// whatever style each cell already has.
// Every blank on a row that is a call becomes NA, before anything is painted.
export function fillBlankCells(sheet, headerRowIndex, dataRows) {
  if (!sheet["!ref"]) return sheet;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let r = headerRowIndex + 1; r <= range.e.r; r++) {
    if (dataRows && !dataRows.has(r)) continue;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell || cell.v === "" || cell.v === null || cell.v === undefined) {
        sheet[addr] = { t: "s", v: "NA" };
      }
    }
  }
  return sheet;
}

export function gridLogSheet(sheet, headerRowIndex, dataRows) {
  if (!sheet["!ref"]) return sheet;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const hair = { style: "thin", color: { rgb: "FFB7C2CC" } };
  // Only rows that are a call. A blank on a call means "not applicable" and is
  // worth saying; a blank on a spacer row, or on a sheet with no calls at all,
  // means there is nothing there — and writing NA across it made an empty day
  // look like a day full of gaps.
  const isDataRow = (r) =>
    dataRows ? dataRows.has(r) : r > headerRowIndex;
  for (let r = headerRowIndex; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell) continue;
      cell.s = {
        ...(cell.s || {}),
        border: { top: hair, bottom: hair, left: hair, right: hair },
        font: { name: XL_FONT, sz: 10, ...(((cell.s || {}).font) || {}) },
        // Centred, horizontally and vertically. A sheet of times, codes and
        // short names reads as a grid when the values line up on an axis; left
        // alignment leaves every column looking ragged against its heading.
        alignment: {
          horizontal: "center",
          vertical: "center",
          wrapText: true,
          ...(((cell.s || {}).alignment) || {}),
        },
      };
    }
  }
  return sheet;
}

export function dressLogSheet(sheet, aoa) {
  const headerRow = typeof aoa.headerRowIndex === "number" ? aoa.headerRowIndex : 4;
  titleSheet(sheet);
  dressSheet(sheet, headerRow, 2);
  // Blanks are answered first. Created after the shading, a night row's NA
  // cells were new cells on an already-painted row and came out white against
  // grey.
  fillBlankCells(sheet, headerRow, aoa.callRows instanceof Set ? aoa.callRows : null);
  shadeNightRows(sheet, aoa, 0);
  paintCategoryColumn(sheet, aoa, 0, typeof aoa.categoryCol === "number" ? aoa.categoryCol : -1);
  paintCodedColumn(sheet, typeof aoa.serviceCol === "number" ? aoa.serviceCol : -1, SERVICE_FILLS, headerRow);
  paintCodedColumn(sheet, typeof aoa.callTypeCol === "number" ? aoa.callTypeCol : -1, CALLTYPE_FILLS, headerRow);
  // Last, so nothing painted above can strip it back off again.
  gridLogSheet(sheet, headerRow, aoa.callRows instanceof Set ? aoa.callRows : null);
  return sheet;
}

// Paint the night shift. The row indices come back on the AOA itself, because
// only the builder knows which call belongs to which shift — by the time it is a
// sheet the times are strings.
export function shadeNightRows(sheet, aoa, offset) {
  // A softer red for coverage: it must stand out on the page without making the
  // rows underneath it hard to read.
  paintRows(sheet, (aoa && aoa.coverageRows) || [], offset, "FFF4B6B6", "FF7F0000");
  const rows = (aoa && aoa.nightRows) || [];
  if (!rows.length) return sheet;
  const ref = sheet["!ref"];
  if (!ref) return sheet;
  const range = XLSX.utils.decode_range(ref);
  rows.forEach((r) => {
    const rowIdx = r + (offset || 0);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: rowIdx, c });
      const cell = sheet[addr];
      if (!cell) continue;
      cell.s = {
        ...(cell.s || {}),
        // Light grey, not black. Solid black across forty rows made the sheet
        // painful to read for the sake of a distinction that only needs to be
        // noticeable, not loud.
        fill: { patternType: "solid", fgColor: { rgb: "FFD9D9D9" } },
        font: { name: XL_FONT, ...((cell.s || {}).font || {}), color: { rgb: "FF1A1A1A" }, bold: false, sz: 10 },
      };
    }
  });
  return sheet;
}

export function buildDispatchLogAOA(requests, units, crewIndex, scheduled, now, station, coverage, dayStart) {
  // Section 1 as the sheet has it, with the two changes asked for: where the
  // patient is coming from leads the sheet rather than trailing it, and the call
  // category sits immediately after the category of call it qualifies.
  const header = [
    "Location where the patient is coming from",
    "Coming from?",
    "Transported to?",
    "MRN",
    "App. Time",
    "Dispatch time",
    "En-route time",
    "On-scene time",
    "Departure time",
    "Arrived on destination",
    "Back in service",
    "MEDIC TEAM",
    "TRUCK",
    "TYPE OF SERVICE",
    "KILO METER",
    "ADDED SERVICE",
    // Category of call and type of service said the same thing in two
    // vocabularies — A and ALS, C and CCT. The service column carries it now.
    // What the desk judged the call needed when it raised it, beside what it
    // was actually run as. They usually agree; where they do not, that is worth
    "CALL CATEGORY",
    "CODES AND EMERGENCIES",
    "E-PCR AUTHOR",
    "BRAVO",
    // One interval, not seven. The other six were the clock times above
    // subtracted from each other — arithmetic a reader can do from the columns
    // already in front of them, and the sheet was half again as wide for it.
    "RESPONSE TIME",
    "DISPATCH DATA ENTRY STATUS",
    // What the app records that the sheet has no column for, kept at the end so
    // the department's own columns stay exactly where they are.
    "SHIFT",
    "STATUS",
    "OUTCOME",
    "PT. REFUSED TIME",
    "REFUSED BY (NAME)",
    "REFUSED BY (NATIONAL ID)",
    "REFUSED BY (RELATION)",
    "RECEIVED BY (NAME)",
    "RECEIVER ID",
    "RECEIVER RECORDED BY",
    "ASSISTING TEAM(S)",
    "ASSIST REQ. TIME",
    "ASSIST REQ. BY",
    "ASSIST STATUS",
    "BOOKED BY",
    // A booking made with no time waits for the ward to ring back. This is
    // the moment the desk released it — the only part of that arrangement
    // anybody needs afterwards.
    "READY CALL TAKEN",
    "BOOKING NOTES",
    "CLOSED BY",
    "CLOSE REASON",
    // Which leg of a there-and-back this row is. Appended at the end with the
    // app's other extra columns, so the department's own columns stay exactly
    // where they are. Filter it and the sheet answers how much of the work is
    // return legs, and how long patients wait to be collected.
    "JOURNEY",
  ];

  const rowFor = (r) => {
    const unit = units.find((u) => u.id === r.assignedUnitId) || {};
    const t = r.times || {};
    const assist = assistOf(r);
    const shiftKey = scheduledShiftKey(r.createdAt);
    const shiftRun = shiftWindowFor(shiftKey, r.createdAt);
    const shift = shiftMeta(shiftKey);
    return [
      r.patientOrigin || "",
      callFrom(r),
      callTo(r),
      r.mrn || "",
      clockStr(r.scheduledFor),
      clockStr(r.createdAt),
      clockStr(t.enroute),
      clockStr(t.arrival),
      clockStr(t.departure),
      clockStr(t.arrivalDestination),
      clockStr(t.backInService),
      unit.name || "",
      unit.ambulanceNumber || "",
      serviceTypeFor(r),
      loadedKmFor(r),
      r.addedService || "",
      r.callCategory || "",
      r.emergencyCode || "",
      pcrAuthorStamp(r, unit),
      r.pcrAuthor && r.pcrAuthor.seat === "alpha"
        ? (unit.bravo ? unit.bravo.name : "")
        : (unit.alpha ? unit.alpha.name : ""),
      // Dispatch to arrival at the destination — the whole wait, which is the
      // one the department is judged on.
      durationStr(r.createdAt, t.arrivalDestination),
      // The sheet's own completeness check: a row with every time on it is done.
      // Complete when the fields this particular call needs are filled.
      //
      // It used to demand three timestamps and nothing else, which called a
      // fully coded call incomplete for want of a stamp and a half-empty one
      // complete. And a blank that reads NA — no refusal, no assisting team —
      // is an answer, not a gap: it must not hold the row open.
      missingLogFields(r).length === 0 && t.backInService ? "Completed" : "Incomplete",
      shift ? shift.short : "",
      r.status ? REQ_STATUS[r.status].label : "",
      callOutcomeLabel(r),
      clockStr(t[REFUSAL_TIME_KEY]),
      r.refusal ? r.refusal.name : "",
      r.refusal ? r.refusal.nationalId : "",
      r.refusal ? r.refusal.relation : "",
      r.receiver ? r.receiver.name : "",
      r.receiver ? r.receiver.receiverId : "",
      r.receiver ? r.receiver.takenBy : "",
      assistTeamNames(r, units),
      assist ? clockStr(assist.requestedAt) : "",
      assist ? assist.requestedByUnitName || assist.requestedBy || "" : "",
      assist ? (assist.status || "").toUpperCase() : "",
      r.scheduledBy || "",
      r.readyCalledAt ? clockStr(r.readyCalledAt) : "",
      r.bookingNotes || "",
      r.closedBy || "",
      r.status === "completed" ? callCloseReason(r) || "Not recorded" : "",
      journeyLabel(r),
    ];
  };

  // Ordered the way the department works through a day: the day shift's calls in
  // the order they were dispatched, then the night shift's in the order they
  // were dispatched. Sorting purely by clock time put a 02:00 call from the
  // night before at the top of the sheet, above the morning that followed it.
  const sorted = (requests || [])
    .slice()
    .sort((a, b) => {
      const da = opDayStart(a.createdAt);
      const dbb = opDayStart(b.createdAt);
      if (da !== dbb) return da - dbb;
      const sa = scheduledShiftKey(a.createdAt) === "day" ? 0 : 1;
      const sb = scheduledShiftKey(b.createdAt) === "day" ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return a.createdAt - b.createdAt;
    });

  // An export covering both stations keeps them apart on the page: the Main
  // Office's calls run first as their own numbered block, then CCC underneath as
  // a second one. Interleaving them by time made a sheet nobody could read down.
  const groups = station
    ? [{ key: station, rows: sorted }]
    : STATIONS.map((st) => ({ key: st.key, rows: sorted.filter((r) => stationOf(r) === st.key) })).filter(
        (g) => g.rows.length
      );

  // The date belongs at the top of the page, once, not repeated down a column
  // on every one of forty rows that all happened on the same day.
  // The window that was asked for, not whatever the data happens to contain.
  const dayOf = typeof dayStart === "number" ? dayStart : opDayStart(now);
  // The same title block the report carries: what this is, then when and how
  // much of it, then air. Two lines, not a banner spread across four columns.
  const out = [
    [
      station
        ? `Dispatch log — ${stationLabel(station)}`
        : "Dispatch log — all stations",
    ],
    [
      // Both shifts named, because both are in the file.
      `${opDayLabel(dayOf)} 07:00 → ${opDayLabel(opDayEnd(dayOf))} 07:00 · ` +
        `day and night shift · ${sorted.length} call${sorted.length === 1 ? "" : "s"}`,
    ],
    [],
  ];

  // Which rows are night calls, so the sheet can be shaded after it is built.
  const nightRows = [];
  // Which rows are a call, so the blanks on them can be answered and the blanks
  // everywhere else left alone.
  const callRows = new Set();
  let firstHeaderRow = 4;
  // And which are periods with no ambulance available — these are the rows the
  // department will be asked about, so they are marked in red and carry the
  // sheet's own NO COVERAGE category rather than being invented as a new idea.
  const coverageRows = [];

  groups.forEach((g, gi) => {
    if (gi > 0) out.push([]);
    out.push([`${stationLabel(g.key).toUpperCase()} — ${g.rows.length} call${g.rows.length === 1 ? "" : "s"}`]);
    if (gi === 0) firstHeaderRow = out.length;
    out.push(["#", ...header]);
    g.rows.forEach((r, idx) => {
      if (isNightCall(r)) nightRows.push(out.length);
      callRows.add(out.length);
      out.push([idx + 1, ...rowFor(r)]);
    });

    // The gaps for this station, under its calls, in the order they happened.
    const gaps = (coverage || []).filter((c) => c && c.station === g.key)
      .sort((a, b) => a.startedAt - b.startedAt);
    if (gaps.length) {
      out.push([]);
      out.push([`${stationLabel(g.key).toUpperCase()} — NO COVERAGE`]);
      // The teams-out list takes the first content column, which is the widest
      // on the sheet because the dispatch log puts a ward name there. In the old
      // order it landed in the MRN column and "MEDIC 1, MEDIC 2, MEDIC 3" was cut
      // off — column widths belong to the sheet, not to one table on it.
      out.push(["#", "TEAMS OUT", "STARTED", "ENDED", "DURATION", "DECLARED BY", "ENDED BY"]);
      gaps.forEach((c, idx) => {
        coverageRows.push(out.length);
        out.push([
          idx + 1,
          (c.unitsOut || []).join(", "),
          clockStr(c.startedAt),
          c.endedAt ? clockStr(c.endedAt) : "STILL RUNNING",
          c.endedAt ? durationStr(c.startedAt, c.endedAt) : "",
          // The board raises these itself. "Automatic" said in one word is
          // clearer than a sentence explaining that nobody declared it.
          // Both of these are usually the board itself. It writes a sentence
          // about how it decided; the column only wants to know who, and the
          // answer is nobody — so it says Automatic and leaves the sentence to
          // the event log.
          coverageActor(c.startedBy),
          coverageActor(c.endedBy),
        ]);
      });
    }
  });

  out.nightRows = nightRows;
  out.coverageRows = coverageRows;
  // Where the treatments need to land. Reported by the builder rather than
  // guessed at by the code that dresses the sheet — it is the only thing that
  // knows how many title lines it wrote.
  out.headerRowIndex = firstHeaderRow;
  out.callRows = callRows;
  out.categoryCol = header.indexOf("CALL CATEGORY") + 1; // +1 for the "#" column
  out.serviceCol = header.indexOf("TYPE OF SERVICE") + 1;
  // The service column now carries the level, so it is the one that gets the
  // colour. There is no separate category-of-call column any more.
  out.callTypeCol = -1;
  return out;
}

// Every shift sign-on, sign-off, swap and overtime crossing, in the order it
// happened — the spreadsheet form of the log sheet's Shift Swaps tab, so a
// supervisor reading the export can see who handed over to whom and how much
// of it ran past the 12 hours.
export function buildShiftHandoverRows(log) {
  return log
    .filter((e) => e.type === "shift")
    .slice()
    .reverse()
    .map((e) => {
      const d = e.detail || {};
      const from = shiftMeta(d.fromShift);
      const relieved = shiftMeta(d.relievedShift);
      return {
        Timestamp: e.ts ? gregDateTimeStr(e.ts) : e.time,
        Event: SHIFT_EVENTS[d.kind] ? SHIFT_EVENTS[d.kind].label : "SHIFT",
        Role: d.role === "team" ? "Crew" : d.role === "dispatcher" ? "Dispatcher" : "",
        Name: d.name || "",
        Team: d.unitName || "",
        Seat: d.seat ? seatLabel(d.seat) : "",
        Shift: shiftLabelWithWindow(d.shift),
        "Shift Date": shiftDateOf(d.shiftStart),
        "Shift Start": d.shiftStart ? gregDateTimeStr(d.shiftStart) : "",
        "Shift End": d.shiftEnd ? gregDateTimeStr(d.shiftEnd) : "",
        Overtime: d.overtimeMs ? otHoursStr(d.overtimeMs) : "",
        "Swapped From": from ? shiftLabelWithWindow(from.key) : "",
        Relieved: d.relievedName || "",
        "Relieved Shift": relieved ? shiftLabelWithWindow(relieved.key) : "",
        "Relieved Overtime": d.relievedOvertimeMs ? otHoursStr(d.relievedOvertimeMs) : "",
        Details: e.message || "",
      };
    });
}