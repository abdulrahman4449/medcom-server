import { APP_NAME, APP_SLUG } from "../brand/brand.jsx";
import { stationLabel } from "../domain/live-sheet.jsx";
import { otHoursStr } from "../domain/messages.jsx";
import { overtimeApprovedMs, overtimeStatusLabel } from "../domain/overtime.jsx";
import { seatLabel, shiftLabelWithWindow } from "../domain/shift-helpers.jsx";
import { dressSheet, paintRows, titleSheet } from "../domain/uhu-person.jsx";
import { autoFitSheet } from "../export/workbook.jsx";
import { gregDateStr, gregDateTimeStr } from "../lib/dates.jsx";

// ---------- the overtime sheet ----------
//
// A month of decisions, as a workbook. The period is whatever an administrator
// asked for — 19 August to 18 September is a pay period, not a calendar month,
// and a report that can only do calendar months is a report somebody retypes.
export async function exportOvertime(claims, from, to, label) {
  const wb = XLSX.utils.book_new();

  const rows = claims.map((c) => {
    const approved = overtimeApprovedMs(c);
    return {
      Date: c.shiftStart ? gregDateStr(c.shiftStart) : "",
      Name: c.name || "",
      "Employee ID": c.accountId || "",
      Station: stationLabel(c.station),
      Medic: c.unitName || "",
      Seat: c.seat ? seatLabel(c.seat) : "",
      Shift: shiftLabelWithWindow(c.shift),
      "Shift End": c.shiftEnd ? gregDateTimeStr(c.shiftEnd) : "",
      "Signed Off": c.signedOffAt ? gregDateTimeStr(c.signedOffAt) : "",
      "On a call at shift end": c.granted ? "" : c.onCall ? "Yes" : "No",
      "Held by": c.onCallNature || "",
      // Hours as decimals as well as written out: payroll adds the column up,
      // a supervisor reads the sentence.
      "Claimed": c.claimedMs ? otHoursStr(c.claimedMs) : "",
      "Claimed (hrs)": c.claimedMs ? Number((c.claimedMs / 3600000).toFixed(2)) : 0,
      Status: overtimeStatusLabel(c),
      "Approved": approved === null ? "" : otHoursStr(approved),
      "Approved (hrs)": approved === null ? "" : Number((approved / 3600000).toFixed(2)),
      "Decided By": (c.decision && c.decision.decidedBy) || "",
      "Decided At": c.decision && c.decision.decidedAt ? gregDateTimeStr(c.decision.decidedAt) : "",
      Note: (c.decision && c.decision.note) || "",
    };
  });

  const headers = rows.length
    ? Object.keys(rows[0])
    : ["Date", "Name", "Employee ID", "Station", "Medic", "Seat", "Shift", "Claimed", "Status", "Approved"];

  const aoa = [
    ["OVERTIME"],
    [label],
    [],
    headers,
    ...rows.map((r) => headers.map((h) => r[h])),
  ];

  const sheet = autoFitSheet(XLSX.utils.aoa_to_sheet(aoa), 3);
  titleSheet(sheet);
  dressSheet(sheet, 3, 1);

  // Anything still waiting on a decision is marked, because a pay period closed
  // with undecided hours in it is the thing somebody needs to see first.
  const pendingRows = [];
  const declinedRows = [];
  rows.forEach((r, i) => {
    if (r.Status === "AWAITING APPROVAL") pendingRows.push(i + 1);
    if (r.Status === "DECLINED") declinedRows.push(i + 1);
  });
  paintRows(sheet, pendingRows, 3, "FFFFE08A", "FF7A4E00");
  paintRows(sheet, declinedRows, 3, "FFE9E9E9", "FF5A6B7B");
  XLSX.utils.book_append_sheet(wb, sheet, "Overtime");

  // A second sheet totalling by person, because that is what goes to payroll.
  //
  // There is deliberately no "claimed" total on this sheet. It used to carry
  // one, and it added declined hours in with approved ones — so the biggest
  // figure against a name was the number nobody was being paid, sitting next to
  // the number they were, and the two had to be told apart by column heading.
  // Approved hours are the total; declined hours are shown so a refusal is on
  // the record, in their own column, adding to nothing.
  const byPerson = new Map();
  claims.forEach((c) => {
    const key = (c.accountId || c.name || "?").toUpperCase();
    if (!byPerson.has(key)) {
      byPerson.set(key, {
        Name: c.name || "",
        "Employee ID": c.accountId || "",
        Station: stationLabel(c.station),
        Claims: 0,
        "Approved (hrs)": 0,
        "Awaiting a decision (hrs)": 0,
        "Declined (hrs)": 0,
      });
    }
    const row = byPerson.get(key);
    const approved = overtimeApprovedMs(c);
    const declined = !!(c.decision && c.decision.status === "declined");
    row.Claims += 1;
    if (approved === null) row["Awaiting a decision (hrs)"] += (c.claimedMs || 0) / 3600000;
    else if (declined) row["Declined (hrs)"] += (c.claimedMs || 0) / 3600000;
    else row["Approved (hrs)"] += approved / 3600000;
  });
  const sumRows = Array.from(byPerson.values())
    .map((r) => ({
      ...r,
      "Approved (hrs)": Number(r["Approved (hrs)"].toFixed(2)),
      "Awaiting a decision (hrs)": Number(r["Awaiting a decision (hrs)"].toFixed(2)),
      "Declined (hrs)": Number(r["Declined (hrs)"].toFixed(2)),
    }))
    .sort((a, b) => b["Approved (hrs)"] - a["Approved (hrs)"]);
  const sumHeaders = ["Name", "Employee ID", "Station", "Claims", "Approved (hrs)", "Awaiting a decision (hrs)", "Declined (hrs)"];
  const sumAoa = [
    ["OVERTIME BY PERSON — APPROVED HOURS ARE THE TOTAL"],
    [label],
    [],
    sumHeaders,
    ...sumRows.map((r) => sumHeaders.map((h) => r[h])),
  ];
  const sumSheet = autoFitSheet(XLSX.utils.aoa_to_sheet(sumAoa), 3);
  titleSheet(sumSheet);
  dressSheet(sumSheet, 3, 1);
  XLSX.utils.book_append_sheet(wb, sumSheet, "By Person");

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  // Local date parts, not toISOString.
  //
  // The period is picked as local midnights, and toISOString converts to UTC —
  // so east of Greenwich the file claimed to start the day before the one that
  // was chosen. A pay period that names the wrong dates is a pay period
  // somebody has to check by hand.
  const ymd = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const filename = `${APP_SLUG}-overtime-${ymd(from)}-to-${ymd(to - 1)}.xlsx`;
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const file = new File([blob], filename, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: `${APP_NAME} — Overtime, ${label}` });
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