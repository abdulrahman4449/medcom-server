import { APP_NAME, APP_SLUG } from "../brand/brand.jsx";
import { callFrom, callTo } from "../domain/call-locations.jsx";
import { PRIORITY, priorityKeyOf, reqLabels } from "../domain/constants.jsx";
import { submissionGaps } from "../domain/coverage.jsx";
import { medicCrewIndex } from "../domain/crew-stamps.jsx";
import { STATIONS, atStation, isBoardLogEntry, stationLabel, stationOf, stationShort } from "../domain/live-sheet.jsx";
import { opDayLabel, opDayStart } from "../domain/op-day.jsx";
import { scheduledShiftKey, shiftDateOf, shiftLabelWithWindow, shiftWindowAt, shiftWindowFor } from "../domain/shift-helpers.jsx";
import { XL_FONT, blankOutEmptyCells, buildDispatchLogAOA, dressLogSheet, dressSheet, gridLogSheet, paintRows, personUhuRows, titleSheet } from "../domain/uhu-person.jsx";
import { actorPost } from "./name-stamps.jsx";
import { gregDateStr, gregDateTimeStr } from "../lib/dates.jsx";
import { dedupeById } from "../lib/helpers.jsx";
import { SCHED_LEAD_MS, schedCancelReason, schedIsTemplate, schedStatusMeta } from "../ui/booking-cancel.jsx";

// ---------- making the export readable when it opens ----------
//
// A generated sheet opens at Excel's default column width, which is about eight
// characters — narrower than a single timestamp, let alone a name stamp or a
// call comment. Every column in the export would land either clipped or spilling
// across its neighbour, and a supervisor would have to drag twenty-seven column
// edges before they could read the thing. So every sheet is measured before the
// workbook is written: each column takes the width of its longest value plus a
// small margin, and each row is given a little more height than the cramped
// default so text sits off the gridline.

// Breathing room either side of the longest value in a column.
export const XL_COL_PADDING = 2.5;
// Nothing narrower than this, so a column of one-character values still shows
// its own heading, and nothing wider than this — one long free-text comment
// should not push the other twenty columns off the screen.
export const XL_COL_MIN_WIDTH = 9;
export const XL_COL_MAX_WIDTH = 80;
// Excel's default row is 15pt, which puts the text flush against the gridline.
export const XL_ROW_HEIGHT = 17;
export const XL_HEADER_ROW_HEIGHT = 19;

// What Excel will actually show in the cell: the formatted text where there is
// one, the raw value otherwise.
export function xlCellText(cell) {
  if (!cell) return "";
  if (cell.w) return cell.w;
  if (cell.v === null || cell.v === undefined) return "";
  return String(cell.v);
}

// Capitals and digits are wider than lowercase in Excel's default font, and the
// headings in this export are all caps — measured at face value they are the
// first thing to get clipped.
export function xlTextWidth(text) {
  let width = 0;
  for (const ch of text) width += /[A-Z0-9@#%&]/.test(ch) ? 1.15 : 1;
  return width;
}

// headerRow is the index of the row holding the column captions (0 for the
// sheets built from objects; further down on the DISPATCH LOG sheet, which
// carries a title and a date above its header). That row and anything above it
// get the taller height.
// A column is sized by what it holds, not by the banner above it.
//
// Widths were measured over every row including the title lines, so a sheet
// headed "AMBULANCE DISPATCH LOG — MAIN OFFICE" made its first column —
// the row counter — as wide as that whole sentence. Titles are now skipped, and
// a few columns that are always short are capped outright.
export const NARROW_COLUMNS = {
  "#": 4.5,
  // Five characters of content. Sized by the heading above them they came out
  // three times the width of the value in them.
  "App. Time": 9,
  "Dispatch time": 9,
  "En-route time": 9,
  "On-scene time": 9,
  "Departure time": 9,
  "Arrived on destination": 9,
  "Back in service": 9,
  "RESPONSE TIME": 9,
  "PT. REFUSED TIME": 9,
  "READY CALL TAKEN": 9,
  "ASSIST REQ. TIME": 9,
  STARTED: 9,
  ENDED: 9,
  DURATION: 9,
  MRN: 12,
  TRUCK: 9,
  "KILO METER": 8,
  "ADDED SERVICE": 9,
  "TYPE OF SERVICE": 11,
  "MEDIC TEAM": 12,

  // Names, not codes. Capped short they spilled into the column beside them.
  BRAVO: 22,
  "E-PCR AUTHOR": 22,
};

// A column holding nothing but short whole numbers — a counter, not data.
// At least one value, every value a number of four characters or fewer.
function isCounterColumn(ws, range, heading, c) {
  let seen = 0;
  for (let r = heading + 1; r <= range.e.r; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (!cell || cell.v === undefined || cell.v === null || cell.v === "") continue;
    const text = String(cell.v).trim();
    if (!text) continue;
    if (!/^\d{1,4}$/.test(text)) return false;
    seen += 1;
  }
  return seen > 0;
}

// The green header band, on every sheet in the workbook.
//
// It lived in `dressSheet`, which only some sheets were passed through — so
// the dispatch log had captions a reader could see at a glance and the event
// log, the utilisation and the origins beside it had plain black text on
// white. One workbook that looks like two is one somebody has to work out
// twice. Painted here, where every sheet already comes, so a new sheet cannot
// be added without it.
export function paintHeaderRow(ws, headerRowIndex) {
  if (!ws || !ws["!ref"]) return ws;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: headerRowIndex, c })];
    if (!cell) continue;
    cell.s = {
      ...(cell.s || {}),
      fill: { patternType: "solid", fgColor: { rgb: "FF0A5540" } },
      font: { name: XL_FONT, color: { rgb: "FFFFFFFF" }, bold: true, sz: 10 },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        bottom: { style: "thin", color: { rgb: "FF063A2C" } },
        right: { style: "hair", color: { rgb: "FF2F6B57" } },
      },
    };
  }
  return ws;
}

export function autoFitSheet(ws, headerRow, foldFrom) {
  if (!ws || !ws["!ref"]) return ws;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const heading = headerRow || 0;

  const cols = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    let widest = 0;
    const headText = xlCellText(ws[XLSX.utils.encode_cell({ r: heading, c })]) || "";
    for (let r = range.s.r; r <= range.e.r; r++) {
      // Rows above the header are titles and captions spanning the page; they
      // say nothing about how wide this column needs to be.
      if (r < heading) continue;
      const text = xlCellText(ws[XLSX.utils.encode_cell({ r, c })]);
      if (text) widest = Math.max(widest, xlTextWidth(text));
    }
    // A column of numbers is as wide as its numbers.
    //
    // Every column starts at the 9-character minimum and grows to fit its
    // heading, so a row-number column headed anything longer than "#" came out
    // wide enough for a sentence with "12" sitting in the middle of it. Three
    // digits is the most a shift will ever number, and that is what it gets.
    // Judged on the CONTENT rather than only on the caption, because each sheet
    // in this workbook heads its counter differently.
    const cap = NARROW_COLUMNS[headText.trim()] || (isCounterColumn(ws, range, heading, c) ? 6 : 0);
    let wch = Math.min(XL_COL_MAX_WIDTH, Math.max(XL_COL_MIN_WIDTH, Math.ceil(widest + XL_COL_PADDING)));
    if (cap) wch = Math.min(wch, cap);
    // Everything past the shift log's own columns is folded away: grouped one
    // level down and hidden, so the sheet opens looking exactly like the filed
    // log sheet and the rest is one click on the + away. Nothing is dropped.
    const folded = typeof foldFrom === "number" && foldFrom > 0 && c >= foldFrom;
    cols.push(folded ? { wch, level: 1, hidden: true } : { wch });
  }
  ws["!cols"] = cols;

  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    rows.push({ hpt: r <= heading ? XL_HEADER_ROW_HEIGHT : XL_ROW_HEIGHT });
  }
  ws["!rows"] = rows;

  paintHeaderRow(ws, heading);
  // The space around the table is paper, not a ruled box — see
  // `blankOutEmptyCells`. Every sheet in every workbook comes through here, so
  // a new one cannot be added without it.
  blankOutEmptyCells(ws);
  return ws;
}

// `station` is the station whose book this is, or null for an administrator
// exporting the department as a whole. When it is set, every sheet below is
// that station's and nothing else — the two stations keep separate log sheets,
// so an export that quietly mixed them would be worse than no export at all.
export async function exportAndShareLog(log, requests, units, scheduled, station, coverage, uhuFrom, dayStart, periodLabel) {
  if (station) {
    units = atStation(units, station);
    requests = atStation(requests, station);
    scheduled = atStation(scheduled, station);
    // A log line belongs to the station of whoever wrote it. Lines written
    // before stations existed carry none, and belong to the Main Office.
    log = (log || []).filter((e) => stationOf(e) === station);
  }
  // One record per id, before anything is counted or drawn.
  //
  // Every sheet in this workbook is built off these two lists, and they arrive
  // from several places at once — the live board, a filed shift log's snapshot,
  // a kept operational day, a restored backup. Each of those merges by id on
  // the way in; this is the last gate, and the only one anybody actually reads.
  // A call printed twice is a call that was run twice as far as the sheet is
  // concerned, and every figure summed off the page is then wrong by one.
  requests = dedupeById(requests);
  log = dedupeById(log);

  const wb = XLSX.utils.book_new();
  // A call still running, and a seat still held, are both measured up to the
  // moment the export was taken.
  const exportedAt = Date.now();
  // Who was signed into each medic, and when — every sheet that names a medic
  // stamps it from here.
  const crewIndex = medicCrewIndex(units, log, exportedAt);

  // ---------- one fact, one place ----------
  //
  // Each sheet below owns a different record: the calls, the event feed, the
  // medic utilisation, the shift changes, the forward book. Nothing that has
  // already been written on one of them is written again on another — a
  // supervisor reading the export should not have to work out which of five
  // tabs is the current one, and a duplicated column is a column that can
  // disagree with itself once anything is filtered or edited. Where a sheet
  // needs something another one owns, it says where to look instead of
  // repeating it.

  // Sheet 1: every call. Matches the hospital's own DISPATCH LOG template column
  // layout, with the fields the template has no room for appended after it. Its
  // captions sit on the fifth row, under the title, the export stamp and the
  // line naming the two shift windows.
  const dispatchAoa = buildDispatchLogAOA(
    requests, units, crewIndex, scheduled, exportedAt, station, coverage, dayStart, periodLabel
  );
  const dispatchLogSheet = dressLogSheet(
    autoFitSheet(XLSX.utils.aoa_to_sheet(dispatchAoa), dispatchAoa.headerRowIndex || 4, dispatchAoa.coreColumns),
    dispatchAoa
  );
  XLSX.utils.book_append_sheet(wb, dispatchLogSheet, "DISPATCH LOG");

  // Sheet 2: the chronological event feed (assignments, status changes, etc),
  // each line carrying the name stamp of whoever was signed in when it was
  // written — the spreadsheet form of the log sheet's name stamps.
  //
  // This is now the full record rather than a copy of one. The log sheet on the
  // boards only shows acknowledgements and en-route stamps, so everything else
  // dispatch and the crews did during the shift is read back here and nowhere
  // else. Each line is filed against the 12-hour window it happened in — day
  // 07:00–19:00, night 19:00–07:00 the next morning — and against the date that
  // window opened, so sorting or filtering on Shift Date gives one shift at a
  // time even when the night crosses midnight. "On Log Sheet" marks the lines
  // that were also visible live on the board.
  //
  // Shift lines are left out here: the Shift Handover sheet already carries
  // every one of them, message and all, broken out into columns. They are on
  // that sheet, not on both.
  const logRows = log
    .slice()
    .reverse()
    .filter((entry) => entry.type !== "shift")
    .map((entry) => {
      const ts = entry.ts || null;
      const w = ts ? shiftWindowAt(ts) : null;
      return {
        Timestamp: ts ? gregDateTimeStr(ts) : entry.time,
        Shift: w ? shiftLabelWithWindow(w.key) : "",
        Type: entry.type || "",
        Message: entry.message || "",
        "On Log Sheet": isBoardLogEntry(entry) ? "Yes" : "No",
        "Logged By": entry.actor && entry.actor.name ? entry.actor.name : "",
        Post: actorPost(entry.actor),
        Station: stationLabel(stationOf(entry)),
      };
    });
  // One event sheet per station when the export covers both, as the dispatch
  // log has. A single feed with a station column meant anybody reading CCC's day
  // had to filter it before they could read it.
  const eventGroups = station
    ? [{ key: station, label: stationLabel(station) }]
    : STATIONS.map((st) => ({ key: st.key, label: st.label }));
  eventGroups.forEach((g) => {
    const rows = logRows.filter((r) => !r.Station || r.Station === g.label);
    const sheet = dressSheet(
      autoFitSheet(
        rows.length > 0
          ? XLSX.utils.json_to_sheet(rows.map(({ Station, ...rest }) => rest))
          : XLSX.utils.aoa_to_sheet([["Nothing logged for this station."]]),
        0
      ),
      0,
      1
    );
    XLSX.utils.book_append_sheet(
      wb,
      sheet,
      eventGroups.length > 1 ? `Event Log — ${stationShort(g.key)}` : "Event Log"
    );
  });

  // Sheet 3: UHU — how long each medic was tied up on calls, with a name stamp
  // against every one of them. A call still running is counted up to the moment
  // the export was taken.
  //
  // One row per medic per employee who was signed into it: a medic number worked
  // by two crews over the day is listed twice, once under each name, rather than
  // collapsing them into a single cell nobody can read back. The medic's own
  // totals (calls, time on call) sit on the first of its rows only — repeating
  // them down the group would make a plain SUM of the column count the same
  // minutes once per crew member.
  //
  // There is no Seat column: the seat is part of the name stamp already
  // ("R. CHEN (MEDIC 3 · ALPHA)"), and writing it twice on one row is one more
  // cell that can be filtered out of agreement with the other.
  //
  // The sign-on, sign-off and overtime of each stay do stay here even though the
  // Shift Handover sheet also records shift events, because a stay can be
  // reconstructed from a seat that is filled right now, or from unit.lastCrew,
  // with no shift line behind it — for those this sheet is the only record there
  // is, and dropping the columns would lose them rather than deduplicate them.
  // Sheet 3: UHU — one sheet per station, ordered by truck and seat.
  //
  // Rebuilt around how the department reads it. Previously it listed whoever
  // signed on first, so MEDIC 1's Alpha could sit six rows above its Bravo, and
  // eight columns repeated things the reader already had: the seat was in the
  // name stamp, the shift and its date were the same on every row, and "on duty
  // now" and "on a call now" describe the second the file was made rather than
  // the shift it documents.
  //
  // What is left is what somebody actually asks of this page: who was on which
  // truck, in which seat, for how long, how much of that was on a call, and did
  // they run over. Ordered MEDIC 1 Alpha, MEDIC 1 Bravo, MEDIC 2 Alpha — so the
  // truck is read down the page rather than searched for.
  const uhuGroups = station
    ? [{ key: station, label: stationLabel(station) }]
    : STATIONS.map((st) => ({ key: st.key, label: st.label }));

  uhuGroups.forEach((g) => {
    const stationUnitsForUhu = atStation(units, g.key);
    // One row per person, not per seat. Somebody who moved trucks mid-shift is
    // one line with one percentage, and the trucks they sat in are named in
    // their own column rather than splitting them into two half-shifts.
    const rows = personUhuRows(
      stationUnitsForUhu,
      crewIndex,
      requests,
      exportedAt,
      uhuFrom,
      exportedAt
    ).map((r) => ({
      Name: r.name,
      "Employee ID": r.id,
      "Team(s)": r.teams,
      "Signed On": r.on,
      "Signed Off": r.off || "Still signed on",
      Overtime: r.ot,
      Calls: r.calls,
      "UHU %": Number(r.uhu),
    }));

    const headers = ["Name", "Employee ID", "Team(s)", "Signed On", "Signed Off", "Overtime", "Calls", "UHU %"];
    const aoa = [
      [`UHU — ${g.label}`],
      [periodLabel ? `${periodLabel} · time on call, per employee` : "Time on call, per employee"],
      [],
      headers,
      ...rows.map((r) => headers.map((h) => r[h])),
    ];

    const sheet = autoFitSheet(XLSX.utils.aoa_to_sheet(aoa), 3);
    titleSheet(sheet);
    dressSheet(sheet, 3, 1);

    // Overtime is the column an administrator is looking for, so it is the one
    // that is marked. A blank cell stays blank — colouring every row would tell
    // nobody anything.
    const otCol = headers.indexOf("Overtime");
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    for (let r = 4; r <= range.e.r; r++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: otCol })];
      if (!cell || !cell.v) continue;
      cell.s = {
        ...(cell.s || {}),
        fill: { patternType: "solid", fgColor: { rgb: "FFFFE08A" } },
        font: { bold: true, color: { rgb: "FF7A4E00" }, sz: 10 },
        alignment: { horizontal: "center", vertical: "center" },
      };
    }
    gridLogSheet(sheet, 3);

    XLSX.utils.book_append_sheet(
      wb,
      sheet,
      uhuGroups.length > 1 ? `UHU — ${stationShort(g.key)}` : "UHU"
    );
  });

  // Sheet 5: the forward book — the bookings that have not gone out yet, the
  // ones still waiting on the ward's phone call, and the ones that were
  // cancelled before an ambulance was raised.
  //
  // A booking that has already been dispatched is a call, and its whole row is
  // on the DISPATCH LOG sheet — transfer details and booking side alike (booked
  // by, booked at, the ready call, the notes). Those are left out here rather
  // than written a second time under a different heading, so a transfer is only
  // ever on one sheet: on this one while it is still planned, on the DISPATCH
  // LOG once it has actually gone out.
  const onDispatchLog = (s) =>
    requests.some((r) => r && (r.scheduledId === s.id || (s.releasedRequestId && r.id === s.releasedRequestId)));
  const scheduledRows = (scheduled || [])
    // A standing arrangement is not a booking that happened. Its occurrences
    // are on this sheet, or on the dispatch log once they went out; the
    // arrangement itself is the rule they came from, and putting it here counts
    // one dialysis run as two.
    .filter((s) => s && !onDispatchLog(s) && !schedIsTemplate(s))
    .slice()
    .sort((a, b) => (a.scheduledFor || 0) - (b.scheduledFor || 0))
    .map((s) => {
      const unit = units.find((u) => u.id === (s.releasedUnitId || s.assignedUnitId));
      // A booking taken without a time belongs to no shift until the ward calls,
      // so both columns say so rather than guessing at one.
      const shiftKey = s.scheduledFor ? s.shift || scheduledShiftKey(s.scheduledFor) : null;
      const shiftRun = shiftKey ? shiftWindowFor(shiftKey, s.scheduledFor) : null;
      return {
        "Scheduled For": s.scheduledFor
          ? gregDateTimeStr(s.scheduledFor)
          : "No time — ward to call when patient ready",
        // Blank on most bookings, and that is the honest answer: most transfers
        // go out at the appointment time and have no separate departure.
        "Dispatch Time": s.dispatchAt ? gregDateTimeStr(s.dispatchAt) : "",
        "Call Raised At": s.dispatchAt ? gregDateTimeStr(s.dispatchAt - SCHED_LEAD_MS) : "",
        Shift: shiftKey ? shiftLabelWithWindow(shiftKey) : "",
        "Shift Date": shiftRun ? shiftDateOf(shiftRun.start) : "",
        Station: stationLabel(stationOf(s)),
        Status: schedStatusMeta(s.status).label,
        "Nature of Call": s.nature || "",
        "Location From": callFrom(s),
        "Location To": callTo(s),
        Priority: PRIORITY[priorityKeyOf(s)] ? PRIORITY[priorityKeyOf(s)].label : "",
        MRN: s.mrn || "",
        Requirements: reqLabels(s).join(", "),
        Team: unit ? unit.name : "",
        Notes: s.notes || "",
        "Booked By": s.createdBy || "",
        "Booked At": s.createdAt ? gregDateTimeStr(s.createdAt) : "",
        "Dispatched At": s.releasedAt ? gregDateTimeStr(s.releasedAt) : "",
        "Ready Call Taken": s.readyCalledAt
          ? `${gregDateTimeStr(s.readyCalledAt)}${s.readyCalledBy ? ` (${s.readyCalledBy})` : ""}`
          : "",
        "Cancelled By": s.cancelledBy || "",
        "Cancelled At": s.cancelledAt ? gregDateTimeStr(s.cancelledAt) : "",
        // The one thing a cancelled row cannot be read without. A booking that
        // was cancelled before the desk was asked for a reason says so, rather
        // than leaving an empty cell that reads as an unanswered question.
        "Cancellation Reason":
          s.status === "cancelled"
            ? schedCancelReason(s) || "Not recorded"
            : "",
      };
    });
  // Which rows are a cancelled booking, so they can be marked after the sheet
  // is built. A cancelled row that reads like a live one is the kind of thing
  // somebody acts on by mistake.
  const cancelledRows = [];
  scheduledRows.forEach((r, i) => {
    if ((r.Status || "").toUpperCase().includes("CANCEL")) cancelledRows.push(i + 1);
  });
  const scheduledSheet = autoFitSheet(
    scheduledRows.length > 0
      ? XLSX.utils.json_to_sheet(scheduledRows)
      : XLSX.utils.aoa_to_sheet([
          ["Nothing is waiting on the forward book — every booking taken has gone out and is on the DISPATCH LOG sheet."],
        ]),
    0
  );
  dressSheet(scheduledSheet, 0, 1);
  paintRows(scheduledSheet, cancelledRows, 0, "FFF4B6B6", "FF7F0000");
  gridLogSheet(scheduledSheet, 0, null);
  XLSX.utils.book_append_sheet(wb, scheduledSheet, "Scheduled Requests");

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const stationTag = station ? `-${stationShort(station).toLowerCase()}` : "-all-stations";
  const filename = `${APP_SLUG}-dispatch-log${stationTag}-${new Date().toISOString().slice(0, 10)}.xlsx`;

  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const file = new File([blob], filename, { type: blob.type });

  // Prefer the native share sheet on mobile if the browser supports sharing files.
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: `${APP_NAME} — Dispatch Log` });
      return;
    }
  } catch (e) {
    // fall through to download
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Downloading a kept day. One workbook, one sheet per station, built from the
// archive rather than from the live board.
//
// Calls are taken from the archive, but if a call has moved on since the day was
// closed — a crew's offline stamps arriving late, a correction the desk
// confirmed the next morning — the current version is used and the sheet says
// the day was amended. That is the honest way round: the record is complete, and
// it admits it changed rather than quietly differing from what was filed.
export async function exportArchivedDay(archive, liveRequests) {
  if (!archive) return;
  const byId = new Map((liveRequests || []).filter((r) => r && r.id).map((r) => [r.id, r]));

  let amended = 0;
  const requests = (archive.requests || []).map((snap) => {
    const live = byId.get(snap.id);
    if (!live) return snap;
    // The archive added openAtClose; the live copy has never carried it. Compare
    // without it, so the flag itself does not read as a change.
    const { openAtClose, ...asFiled } = snap;
    if (JSON.stringify(live) === JSON.stringify(asFiled)) return snap;
    amended += 1;
    return { ...live, openAtClose };
  });

  const units = archive.units && archive.units.length ? archive.units : [];
  const log = archive.log || [];
  const scheduled = archive.scheduled || [];
  const at = archive.dayEnd;
  const crewIndex = medicCrewIndex(units, log, at);

  const wb = XLSX.utils.book_new();

  STATIONS.forEach((st) => {
    const stationRequests = atStation(requests, st.key);
    const stationUnits = atStation(units, st.key);
    const stationScheduled = atStation(scheduled, st.key);
    // The gaps this station actually had. An empty array was being passed here,
    // so an archived sheet never carried a no-coverage table and anything
    // reading it concluded the station never ran out of ambulances.
    const stationCoverage = (archive.coverage || []).filter(
      (c) => c && c.station === st.key
    );
    // archive.dayStart, not `at`. Without it the builder falls back to the
    // operational day of the moment the file is made, so a day downloaded from
    // the archive a week later was titled with today's date and had its day and
    // night shifts worked out against today's 07:00 - the calls in it fall
    // under the wrong date, which is the one thing this sheet cannot do.
    const aoa = buildDispatchLogAOA(
      stationRequests, stationUnits, crewIndex, stationScheduled, at, st.key, stationCoverage,
      archive.dayStart
    );
    const nightRows = aoa.nightRows || [];
    // A line at the top of each sheet saying what this book is and whether it
    // has changed since the day was closed.
    aoa.splice(1, 0, [
      // Named by the date it OPENED. A day runs 07:00 to 07:00 and files under
      // the date it started on, so printing both ends of it asked a reader to
      // work out which of the two dates the file is filed under.
      `OPERATIONAL DAY: ${opDayLabel(archive.dayStart)} · 07:00 to 07:00` +
        (archive.reason === "live"
          ? ` · LIVE BOARD, taken ${gregDateTimeStr(archive.closedAt)} — this day is still running`
          : ` · closed ${gregDateTimeStr(archive.closedAt)}${archive.closedBy ? ` by ${archive.closedBy}` : ""}`) +
        (amended > 0 ? ` · AMENDED SINCE CLOSING (${amended} call${amended === 1 ? "" : "s"} updated)` : ""),
    ]);
    const sheet = dressLogSheet(
      autoFitSheet(XLSX.utils.aoa_to_sheet(aoa), aoa.headerRowIndex || 4, aoa.coreColumns),
      aoa
    );
    XLSX.utils.book_append_sheet(wb, sheet, `DISPATCH LOG — ${stationShort(st.key)}`);
  });

  // The event feed for the day, both stations, with the station on each line.
  // One sheet per station, as the dispatch log is. A single feed with a station
  // column meant anybody reading CCC's day had to filter it first.
  const eventRowsFor = (stationKey) =>
    log
      .filter((e) => !stationKey || stationOf(e) === stationKey)
      .slice()
      .sort((a, b) => (a.ts || 0) - (b.ts || 0))
      .map((e) => ({
        Time: e.ts ? gregDateTimeStr(e.ts) : e.time || "",
        Type: (e.type || "").toUpperCase(),
        Event: e.message || "",
        "Logged By": e.actor && e.actor.name ? e.actor.name : "",
        Post: actorPost(e.actor),
      }));
  // One per station, matching the dispatch log above. This read a bare
  // `station` that is not in scope here, so exporting a kept day threw a
  // ReferenceError and produced no file at all.
  STATIONS.forEach((st) => {
    const eventRows = eventRowsFor(st.key);
    XLSX.utils.book_append_sheet(
      wb,
      autoFitSheet(
        eventRows.length
          ? XLSX.utils.json_to_sheet(eventRows)
          : XLSX.utils.aoa_to_sheet([["No events recorded for this day."]]),
        0
      ),
      `EVENTS — ${stationShort(st.key)}`
    );
  });

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const filename =
    archive.reason === "live"
      ? `${APP_SLUG}-live-board-${archive.dayKey}.xlsx`
      : `${APP_SLUG}-dispatch-log-${archive.dayKey}.xlsx`;
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const file = new File([blob], filename, { type: blob.type });

  try {
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: `${APP_NAME} — Dispatch Log, ${opDayLabel(archive.dayStart)}` });
      return;
    }
  } catch (e) {
    // fall through to download
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Downloading a submitted shift log. One station, one shift, one sheet — the
// two stations are kept apart because they are submitted apart.
// The archive's spreadsheet, built by the same route as the live export.
//
// It was producing two sheets — the dispatch log and the events — while the
// Export button produced seven. A file downloaded from the archive should not
// be a lesser version of the same shift, so it now goes through the same
// builder with the submission's own data, and comes out with the same sheets in
// the same order and the same house style.
export async function exportSubmission(sub, liveRequests, liveCoverage) {
  if (!sub) return;
  const byId = new Map((liveRequests || []).filter((r) => r && r.id).map((r) => [r.id, r]));
  const requests = (sub.requests || []).map((snap) => {
    const live = byId.get(snap.id);
    return live && JSON.stringify(live) !== JSON.stringify(snap) ? live : snap;
  });

  await exportAndShareLog(
    sub.log || [],
    requests,
    sub.units || [],
    sub.scheduled || [],
    sub.station,
    submissionGaps(sub, liveCoverage),
    // The shift this submission covers — without it the UHU sheet is measured
    // against whatever shift is running today and comes out empty.
    sub.windowStart,
    opDayStart(sub.windowStart),
    `${gregDateStr(sub.windowStart)} · ${shiftLabelWithWindow(sub.shiftKey)}`
  );
}