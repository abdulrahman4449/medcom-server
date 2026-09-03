// ---------- exporting the six-week schedule ----------
//
// Two documents, one source. The staff PDF is the department's own sheet — the
// KFSH layout the desk already reads — with the grid and NOTHING that belongs
// to planning: no shift totals, no overtime totals, no per-day team counts.
// The Excel working copy is for the next revision and carries exactly those
// three, so the numbers a preparer works against never travel on the copy the
// staff receive.
import { ORG_NAME } from "../brand/artwork.jsx";
import { APP_NAME, APP_SLUG } from "../brand/brand.jsx";
import {
  SCHEDULE_CODES, SCHEDULE_CODE_ORDER, SCHEDULE_COVERAGE, parseScheduleCode,
  scheduleCoverageCount, scheduleDayIsWeekend, scheduleView, scheduleWorkingPerDay,
  effectiveScheduleCodes,
} from "../domain/schedule.jsx";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["SUN", "MON", "TUS", "WED", "THU", "FRI", "SAT"];
let _hijri = null;
function hijriOf(y, m, d) {
  try {
    if (!_hijri) _hijri = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric" });
    return _hijri.format(new Date(y, m - 1, d));
  } catch (e) { return ""; }
}
function dayMeta(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return { y, m, d, dow: wd, dowLabel: DOW[wd], g: d, mon: MON[m - 1], h: hijriOf(y, m, d), weekend: scheduleDayIsWeekend(dayKey) };
}
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// The screen and both exports read one palette. `bg`/`fg` are the print fills;
// `xl` is the same as an ARGB fill for the workbook.
const CODE_PRINT = {
  D: ["#FFFFFF", "#1F2937"], N: ["#D9E1F2", "#1F2937"],
  H: ["#C6E0B4", "#1F4E23"], P: ["#A9D08E", "#1F4E23"],
  CD: ["#DEEBF7", "#1F3864"], CN: ["#BDD7EE", "#1F3864"], CH: ["#C6E0B4", "#1F4E23"], CP: ["#A9D08E", "#1F4E23"],
  MH: ["#E4DFEC", "#5B2E91"], MP: ["#CCC0DA", "#5B2E91"],
  Z: ["#B1A0C7", "#3F2A5B"], GD: ["#C6E0B4", "#1F4E23"], GN: ["#A9D08E", "#1F4E23"],
  S: ["#FFFFFF", "#334155"], C: ["#FCE3EE", "#9C1E5B"], "&": ["#FFFFFF", "#334155"],
  L: ["#F2F2F2", "#7F7F7F"], SL: ["#F8CBAD", "#843C0C"], CS: ["#F4B6B6", "#8B1A1A"],
  BD: ["#DDD9C4", "#5C5426"], BN: ["#C4BD97", "#3F3A17"],
};
function codePrint(code, CODES) {
  if (CODE_PRINT[code]) return CODE_PRINT[code];
  const meta = CODES && CODES[code];
  if (meta && meta.color) return ["#FFFFFF", meta.color];
  return ["#FFFFFF", "#111111"];
}

// The legend, in the six columns the department groups it in.
const LEGEND_COLS = [
  [["D", "MAIN DAY SHIFT"], ["N", "MAIN NIGHT SHIFT"], ["H", "MAIN DAY OVERTIME"], ["P", "MAIN NIGHT OVERTIME"]],
  [["CD", "CCC DAY SHIFT"], ["CN", "CCC NIGHT SHIFT"], ["CH", "CCC DAY OVERTIME"], ["CP", "CCC NIGHT OVERTIME"]],
  [["GD", "DAY DISPATCH 12H"], ["GN", "NIGHT DISPATCH 12H"], ["H", "DAY DISPATCH 12H OT"], ["P", "NIGHT DISPATCH 12H OT"]],
  [["MH", "DAY ROYAL"], ["MP", "NIGHT ROYAL"], ["S", "DAY OFFICE"], ["&", "HOSPITAL ORIENTATION"]],
  [["CS", "CALL SICK"], ["SL", "SICK LEAVE"], ["L", "LEAVE"], ["C", "MOBILE STROKE UNIT"]],
  [["Z", "ZAHRAWI BUILDING"], ["BD", "ALMATHER DAY (BH=OT)"], ["BN", "ALMATHER NIGHT (BP=OT)"], ["", ""]],
];

function orgTitle() {
  return ORG_NAME ? `${ORG_NAME} — Ambulance Department` : "Ambulance Department — Employees Schedule";
}
function cellGlyph(token, CODES) {
  const { code, hours } = parseScheduleCode(token);
  const meta = (CODES || SCHEDULE_CODES)[code];
  if (!meta) return "";
  const shown = meta.show || code;
  return `${shown}${hours ? `<span class="hh">${hours}</span>` : ""}`;
}

// ---------- the staff PDF: grid only, the KFSH look ----------
export function buildSchedulePdfHtml({ view, dayKeys, meta }) {
  const CODES = (meta && meta.codes) || SCHEDULE_CODES;
  const metas = dayKeys.map(dayMeta);
  const today = meta && meta.todayKey ? dayKeys.indexOf(meta.todayKey) : -1;
  const dcell = (i, extra) => `class="d${metas[i].dow === 0 ? " wk" : ""}${i === today ? " today" : ""}"${extra || ""}`;

  const legend = LEGEND_COLS.map((col) => `<td class="lgcol">${col.map(([k, label]) => {
    if (!k) return "";
    const c = codePrint(k, CODES);
    const glyph = (SCHEDULE_CODES[k] && SCHEDULE_CODES[k].show) || k;
    return `<div class="lgrow"><b style="background:${c[0]};color:${c[1]}">${glyph}</b><span>${label}</span></div>`;
  }).join("")}</td>`).join("");

  const hij = metas.map((m, i) => `<td ${dcell(i)} style="font-size:5.3px;color:#7A8896">${m.h}</td>`).join("");
  const gnum = metas.map((m, i) => `<td ${dcell(i)} style="font-size:7.2px;color:#111;font-weight:700">${m.g}</td>`).join("");
  const dow = metas.map((m, i) => `<td ${dcell(i)} style="font-size:5.6px;color:${m.weekend ? "#123a66" : "#4A5A68"};font-weight:700">${m.dowLabel}</td>`).join("");
  const secHead = () => `<tr class="sec"><td class="nm">NAME</td><td class="id">ID</td>${metas.map((m, i) => `<td ${dcell(i)} style="font-size:5.6px;font-weight:700">${m.dowLabel}</td>`).join("")}</tr>`;

  let body = "";
  view.groups.forEach((g, gi) => {
    if (gi > 0) body += secHead();
    body += `<tr class="grpname"><td class="nm">${esc(g.name)}</td><td class="id"></td>${metas.map((m, i) => `<td ${dcell(i)}></td>`).join("")}</tr>`;
    g.rows.forEach((r, ri) => {
      body += `<tr class="${ri % 2 ? "alt" : ""}"><td class="nm">${esc(r.name)}</td><td class="id">${esc(r.empId)}</td>${r.cells.map((t, i) => {
        const { code } = parseScheduleCode(t);
        const known = !!CODES[code];
        const c = known ? codePrint(code, CODES) : null;
        const bg = c ? c[0] : (i === today ? "#FFF2CC" : (metas[i].weekend ? "#EAF0F6" : "#FFFFFF"));
        const fg = c ? c[1] : "#000";
        const bold = (CODES[code] && CODES[code].ot) || parseScheduleCode(t).hours;
        return `<td ${dcell(i)} style="background:${bg};color:${fg};font-weight:${bold ? 800 : 600}">${cellGlyph(t, CODES)}</td>`;
      }).join("")}</tr>`;
    });
  });

  const approved = meta && meta.status === "approved";
  const stamp = approved
    ? `V${meta.version || 1} · APPROVED${meta.approvedBy ? ` by ${esc(meta.approvedBy)}` : ""}${meta.approvedAt ? ` on ${meta.approvedAt}` : ""}`
    : `${(meta && meta.statusLabel) || "DRAFT"} — NOT FOR DISTRIBUTION`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(orgTitle())} — Schedule</title><style>
@page{size:A3 landscape;margin:7mm}
*{box-sizing:border-box}
body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff}
table{border-collapse:collapse;width:100%;table-layout:fixed}
td{border:0.4pt solid #B9C4CE}
.titlebar td{border:0.4pt solid #9AA7B4}
.crest{width:64px;text-align:center;vertical-align:middle}
.crest .em{width:40px;height:40px;border-radius:50%;background:#123a66;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;margin:2px auto}
.crest .hj{font-size:5.5px;color:#555;margin-top:1px}
.ttl{text-align:center;font-size:12.5px;font-weight:800;color:#123a66;letter-spacing:.3px;padding:3px}
.lgcol{vertical-align:top;padding:2px 4px;font-size:6.6px}
.lgrow{display:flex;align-items:center;gap:3px;line-height:1.35}
.lgrow b{display:inline-flex;align-items:center;justify-content:center;min-width:12px;height:9px;padding:0 2px;border:0.3pt solid #B9C4CE;font-size:6px}
.periodbar td{background:#1F3864;color:#fff;font-weight:800;font-size:9px;letter-spacing:.5px;padding:3px 6px;border-color:#12224a}
.periodbar .sdate{text-align:right;font-weight:600}
.nm{width:44mm;text-align:left;padding:1px 4px;font-size:7.2px;font-weight:600;background:#fff}
.id{width:12mm;text-align:left;padding:1px 3px;font-size:6.6px;color:#334;background:#fff}
td.d{width:6.6mm;text-align:center;font-size:7px;padding:0;height:12.5px}
.wk{border-left:0.9pt solid #7f8c99}
.today{outline:0.9pt solid #C9A000}
tr.sec td{background:#1F3864;color:#fff;font-weight:800;font-size:6.4px;height:11px;border-color:#12224a}
tr.sec td.nm,tr.sec td.id{background:#1F3864;color:#fff;font-size:7px}
tr.grpname td{background:#EEF3F6;font-weight:800;font-size:7px;color:#33475A;height:12px}
tr.grpname td.nm{background:#E4ECF1}
tr.alt td.nm,tr.alt td.id{background:#F4F8FB}
.hh{font-size:5px;vertical-align:super}
.foot{display:flex;justify-content:space-between;margin-top:8px;font-size:8.5px;color:#5B6B7A;border-top:0.7pt solid #C9D4DD;padding-top:5px}
</style></head><body>
<table class="titlebar"><tr>
  <td class="crest" rowspan="2"><div class="em">${esc((ORG_NAME || "EMS").slice(0, 4).toUpperCase())}</div><div class="hj">${esc((meta && meta.hijriRange) || "")}</div></td>
  <td class="ttl" colspan="6">${esc(orgTitle())}</td>
</tr><tr>${legend}</tr></table>
<table class="periodbar"><tr><td colspan="30">${esc((meta && meta.periodLabel) || "EMPLOYEES SCHEDULE")}</td><td class="sdate" colspan="14">${esc(stamp)}</td></tr></table>
<table>
 <tr><td class="nm" style="background:#1F3864;color:#fff;font-weight:800;font-size:7px">NAME</td><td class="id" style="background:#1F3864;color:#fff">ID</td>${hij}</tr>
 <tr><td class="nm"></td><td class="id"></td>${gnum}</tr>
 <tr><td class="nm"></td><td class="id"></td>${dow}</tr>
 ${body}
</table>
<div class="foot"><span>${esc(APP_NAME)} — the schedule the department shares</span><span>${esc((meta && meta.generated) || "")}</span></div>
</body></html>`;
}

// Open the staff PDF in a new tab and send it to print.
export function openSchedulePdf({ schedule, accounts, dayKeys, meta }) {
  const codes = effectiveScheduleCodes(schedule);
  const view = scheduleView(schedule, accounts, dayKeys, codes);
  const html = buildSchedulePdfHtml({ view, dayKeys, meta: { ...(meta || {}), codes } });
  const w = window.open("", "_blank");
  if (!w) { window.alert("Allow pop-ups for this site to produce the schedule PDF."); return false; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* the user can print by hand */ } }, 400);
  return true;
}

// ---------- the Excel working copy: grid + the three planning extras ----------
const XL_ARGB = {};
Object.keys(CODE_PRINT).forEach((k) => { XL_ARGB[k] = "FF" + CODE_PRINT[k][0].slice(1); });
const XL_FG = {};
Object.keys(CODE_PRINT).forEach((k) => { XL_FG[k] = "FF" + CODE_PRINT[k][1].slice(1); });

export async function exportScheduleExcel({ schedule, accounts, dayKeys, meta }) {
  const CODES = effectiveScheduleCodes(schedule);
  const view = scheduleView(schedule, accounts, dayKeys, CODES);
  const cells = (schedule && schedule.cells) || {};
  const metas = dayKeys.map(dayMeta);
  const nDay = dayKeys.length;
  // Columns: NAME, ID, 42 days, SHIFTS, OT — the last two are the planning
  // extras the staff PDF never shows.
  const header1 = ["NAME", "ID", ...metas.map((m) => m.g), "SHIFTS", "OT h"];
  const header2 = ["", "", ...metas.map((m) => m.dowLabel), "", ""];
  const aoa = [
    [orgTitle()],
    [(meta && meta.periodLabel) || "EMPLOYEES SCHEDULE", "", ...Array(nDay - 1).fill(""), (meta && meta.statusLabel) || "DRAFT"],
    header1,
    header2,
  ];
  const rowKinds = [];
  view.groups.forEach((g) => {
    aoa.push([g.name, "", ...Array(nDay + 2).fill("")]); rowKinds.push("group");
    g.rows.forEach((r) => {
      aoa.push([r.name, r.empId, ...r.cells.map((t) => { const { code, hours } = parseScheduleCode(t); const m = CODES[code]; return m ? (m.show || code) + (hours ? hours : "") : ""; }), r.summary.exempt ? "" : r.summary.shifts, r.summary.otHours || ""]);
      rowKinds.push("emp");
    });
  });
  // Coverage rows — people per site each day — and the total-teams row.
  aoa.push(["COVERAGE — PEOPLE ON, PER DAY", "", ...Array(nDay + 2).fill("")]); rowKinds.push("group");
  SCHEDULE_COVERAGE.forEach((c) => {
    aoa.push([c.label, "", ...metas.map((m) => { const need = c.need(m.weekend); const n = scheduleCoverageCount(cells, view.allIds, dayKeys[metas.indexOf(m)], c.codes); return need === 0 ? "" : n; }), "", ""]);
    rowKinds.push("cover");
  });
  const perDay = scheduleWorkingPerDay(cells, view.allIds, dayKeys, CODES);
  aoa.push(["TOTAL TEAMS ON DUTY (people ÷ 2)", "", ...perDay.map((n) => (n ? Math.floor(n / 2) : "")), "", ""]); rowKinds.push("total");
  aoa.push(["TOTAL PEOPLE ON DUTY", "", ...perDay.map((n) => n || ""), "", ""]); rowKinds.push("total");

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 26 }, { wch: 10 }, ...metas.map(() => ({ wch: 3.5 })), { wch: 7 }, { wch: 6 }];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: nDay + 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: nDay } },
  ];
  const set = (r, c, style) => { const ref = XLSX.utils.encode_cell({ r, c }); const cell = ws[ref]; if (cell) cell.s = { ...(cell.s || {}), ...style }; };
  const thin = { style: "thin", color: { rgb: "FFB9C4CE" } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  // title + period bands
  set(0, 0, { font: { bold: true, sz: 13, color: { rgb: "FF123A66" } }, alignment: { horizontal: "center" } });
  for (let c = 0; c <= nDay + 3; c++) set(1, c, { fill: { patternType: "solid", fgColor: { rgb: "FF1F3864" } }, font: { bold: true, color: { rgb: "FFFFFFFF" }, sz: 10 } });
  // header rows
  for (let c = 0; c < header1.length; c++) { set(2, c, { fill: { patternType: "solid", fgColor: { rgb: "FF1F3864" } }, font: { bold: true, color: { rgb: "FFFFFFFF" }, sz: 8 }, alignment: { horizontal: "center" }, border }); set(3, c, { fill: { patternType: "solid", fgColor: { rgb: "FFEEF2F6" } }, font: { bold: true, sz: 7 }, alignment: { horizontal: "center" }, border }); }
  // body
  let r = 4;
  rowKinds.forEach((kind) => {
    if (kind === "group") { for (let c = 0; c <= nDay + 3; c++) set(r, c, { fill: { patternType: "solid", fgColor: { rgb: "FFE4ECF1" } }, font: { bold: true, sz: 8, color: { rgb: "FF33475A" } }, border }); }
    else if (kind === "emp") {
      set(r, 0, { font: { sz: 8, bold: true }, border });
      set(r, 1, { font: { sz: 7, color: { rgb: "FF334455" } }, border });
      for (let i = 0; i < nDay; i++) {
        const token = (aoa[r][2 + i] || "");
        const code = parseScheduleCode(token).code;
        const fill = XL_ARGB[code];
        const custColor = !fill && CODES[code] && CODES[code].color ? "FF" + String(CODES[code].color).replace("#", "") : null;
        set(r, 2 + i, { alignment: { horizontal: "center" }, font: { sz: 8, bold: !!code, color: { rgb: XL_FG[code] || custColor || "FF000000" } }, border, ...(fill ? { fill: { patternType: "solid", fgColor: { rgb: fill } } } : (metas[i].weekend ? { fill: { patternType: "solid", fgColor: { rgb: "FFEAF0F6" } } } : {})) });
      }
      set(r, nDay + 2, { alignment: { horizontal: "center" }, font: { sz: 9, bold: true }, border });
      set(r, nDay + 3, { alignment: { horizontal: "center" }, font: { sz: 9, bold: true, color: { rgb: "FF8A5A00" } }, border });
    } else if (kind === "cover" || kind === "total") {
      set(r, 0, { font: { sz: 8, bold: kind === "total", color: { rgb: "FF33475A" } }, border });
      for (let i = 0; i < nDay; i++) set(r, 2 + i, { alignment: { horizontal: "center" }, font: { sz: 8, bold: kind === "total" }, border, ...(metas[i].weekend ? { fill: { patternType: "solid", fgColor: { rgb: "FFEAF0F6" } } } : {}) });
    }
    r += 1;
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Schedule");
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const filename = `${APP_SLUG}-schedule-${(meta && meta.fileTag) || new Date().toISOString().slice(0, 10)}.xlsx`;
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const file = new File([blob], filename, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: `${APP_NAME} — Schedule (working copy)` });
      return true;
    }
  } catch (e) { /* fall through to download */ }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
