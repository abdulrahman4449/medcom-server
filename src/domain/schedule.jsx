// ---------- the employees' six-week schedule ----------
//
// A roster the department plans ahead: employees in groups, one code per day
// for six weeks, with the rules the department schedules against checked live
// as it is edited. It is NOT the live board — nothing here dispatches or signs
// anyone on. It is the plan, kept in `ems:schedule`, and an administrator (or
// somebody lent the schedule area) fills it in.
//
// A day here is a calendar day, keyed "YYYY-MM-DD" in the operations timezone,
// because a schedule is read as a wall calendar — the 07:00 operational
// boundary belongs to the board, not to a planner drawing six weeks of rows.

export const SCHEDULE_KEY = "ems:schedule";
export const SCHEDULE_WEEKS = 6;
export const SCHEDULE_DAYS = SCHEDULE_WEEKS * 7; // 42
export const SCHEDULE_REQUIRED_SHIFTS = 22;
export const SCHEDULE_MAX_OT_HOURS = 80;
export const SCHEDULE_MAX_OFF_RUN = 5; // no MORE than five off days in a row
export const SCHEDULE_MAX_WORK_RUN = 5; // never a sixth working day in a row

// The codes, from the sheet's own legend. `site`/`period` drive the coverage
// count; `work` is a worked shift that counts toward the required 22; `ot` adds
// overtime hours (the number on the code, or a whole 12h shift when bare);
// `off` is a non-working day. `show` overrides the letters drawn in the cell.
export const SCHEDULE_CODES = {
  D:  { label: "Main · day",        site: "main",  period: "day",   work: true },
  N:  { label: "Main · night",      site: "main",  period: "night", work: true },
  H:  { label: "Main day · OT",     site: "main",  period: "day",   work: true, ot: true },
  P:  { label: "Main night · OT",   site: "main",  period: "night", work: true, ot: true },
  CD: { label: "CCC · day",         site: "ccc",   period: "day",   work: true },
  CN: { label: "CCC · night",       site: "ccc",   period: "night", work: true },
  CH: { label: "CCC day · OT",      site: "ccc",   period: "day",   work: true, ot: true },
  CP: { label: "CCC night · OT",    site: "ccc",   period: "night", work: true, ot: true },
  MH: { label: "Royal · day",       site: "royal", period: "day",   work: true },
  MP: { label: "Royal · night",     site: "royal", period: "night", work: true },
  BD: { label: "Almather · day",    site: "alm",   period: "day",   work: true },
  BN: { label: "Almather · night",  site: "alm",   period: "night", work: true },
  Z:  { label: "Zahrawi · 08:00, 9h", site: "zah", period: "day",   work: true },
  GD: { label: "Dispatch · day",    site: "disp",  period: "day",   work: true, show: "D" },
  GN: { label: "Dispatch · night",  site: "disp",  period: "night", work: true, show: "N" },
  S:  { label: "Day office",        site: "office", period: "day",  work: true, exemptShifts: true },
  C:  { label: "Mobile stroke unit", site: "msu",  period: "day",   work: true },
  "&": { label: "Orientation",      site: "orient", period: "day",  work: true, exemptShifts: true },
  L:  { label: "Leave",             off: true, leave: true },
  SL: { label: "Sick leave",        off: true },
  CS: { label: "Called sick",       off: true },
};

// The order the picker and the legend list them in.
export const SCHEDULE_CODE_ORDER = [
  "D", "N", "H", "P", "CD", "CN", "CH", "CP", "MH", "MP",
  "BD", "BN", "Z", "GD", "GN", "S", "C", "&", "L", "SL", "CS",
];

// A token in a cell: a code and an optional overtime-hours number (H6 → 6).
export function parseScheduleCode(token) {
  const m = /^([A-Z&]+)(\d+)?$/.exec(String(token || "").trim().toUpperCase());
  if (!m) return { code: "", hours: null };
  return { code: m[1], hours: m[2] ? Number(m[2]) : null };
}

export function scheduleCodeMeta(token) {
  return SCHEDULE_CODES[parseScheduleCode(token).code] || null;
}

// A worked day: a code the department counts as being at work.
export function scheduleIsWork(token, codes) {
  const map = codes || SCHEDULE_CODES;
  const meta = map[parseScheduleCode(token).code];
  return !!(meta && meta.work);
}

// The most recent Sunday at or before `now`, at local midnight in OPS_TZ, as a
// timestamp — the natural start of a six-week block.
export function dayKeyOf(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Local midnight of the most recent Sunday at or before `now` — the natural
// start of a six-week block. The device runs in the department's timezone.
export function defaultScheduleStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // getDay: 0 = Sunday
  return d.getTime();
}

// The 42 day keys of the block, "YYYY-MM-DD", starting at `startMs`.
export function scheduleDayKeys(startMs) {
  const out = [];
  const base = new Date(startMs);
  base.setHours(0, 0, 0, 0);
  for (let i = 0; i < SCHEDULE_DAYS; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    out.push(dayKeyOf(d.getTime()));
  }
  return out;
}

export function scheduleDayIsWeekend(dayKey) {
  // Friday or Saturday.
  const [y, m, d] = dayKey.split("-").map(Number);
  const wd = new Date(y, m - 1, d).getDay(); // 5=Fri, 6=Sat
  return wd === 5 || wd === 6;
}

export function scheduleCellKey(accountId, dayKey) {
  return `${accountId}::${dayKey}`;
}

// Everything a single employee's row is judged on.
export function employeeScheduleSummary(cells, accountId, dayKeys, codes) {
  const map = codes || SCHEDULE_CODES;
  const tokens = dayKeys.map((k) => (cells || {})[scheduleCellKey(accountId, k)] || "");
  let shifts = 0, otHours = 0, exempt = false;
  tokens.forEach((t) => {
    const { code, hours } = parseScheduleCode(t);
    const meta = map[code];
    if (!meta) return;
    if (meta.exemptShifts) exempt = true;
    if (meta.ot) { otHours += hours != null ? hours : 12; if (meta.work) shifts += 1; }
    else if (meta.work) shifts += 1;
  });
  let maxWorkRun = 0, workRun = 0, maxOffRun = 0, offRun = 0;
  tokens.forEach((t) => {
    if (scheduleIsWork(t, map)) { workRun += 1; maxWorkRun = Math.max(maxWorkRun, workRun); offRun = 0; }
    else { offRun += 1; maxOffRun = Math.max(maxOffRun, offRun); workRun = 0; }
  });
  const flags = [];
  if (!exempt && shifts < SCHEDULE_REQUIRED_SHIFTS) flags.push(`${shifts} of ${SCHEDULE_REQUIRED_SHIFTS} shifts`);
  if (!exempt && shifts > SCHEDULE_REQUIRED_SHIFTS) flags.push(`${shifts} shifts — ${shifts - SCHEDULE_REQUIRED_SHIFTS} over, code the extra as overtime`);
  if (otHours > SCHEDULE_MAX_OT_HOURS) flags.push(`${otHours}h overtime, over ${SCHEDULE_MAX_OT_HOURS}`);
  if (maxWorkRun > SCHEDULE_MAX_WORK_RUN) flags.push(`${maxWorkRun} days in a row`);
  if (maxOffRun > SCHEDULE_MAX_OFF_RUN) flags.push(`${maxOffRun} off days in a row`);
  // A leave must be worked into and out of: the day before and the day after a
  // block of L must be a worked day (not off, not the edge of the block).
  tokens.forEach((t, i) => {
    if (parseScheduleCode(t).code !== "L") return;
    const prevIsL = i > 0 && parseScheduleCode(tokens[i - 1]).code === "L";
    const nextIsL = i < tokens.length - 1 && parseScheduleCode(tokens[i + 1]).code === "L";
    if (!prevIsL) { if (i === 0 || !scheduleIsWork(tokens[i - 1], map)) flags.push("leave not worked into"); }
    if (!nextIsL) { if (i === tokens.length - 1 || !scheduleIsWork(tokens[i + 1], map)) flags.push("leave not worked out of"); }
  });
  // One message per kind, in order.
  return { shifts, otHours, exempt, flags: [...new Set(flags)] };
}

// The coverage a site/period needs on a given day. A team is two people, so
// these are people, not teams.
export const SCHEDULE_COVERAGE = [
  { key: "main-day",  label: "Main · day",       codes: ["D", "H"],  need: () => 8,  target: () => 10 },
  { key: "main-night", label: "Main · night",    codes: ["N", "P"],  need: () => 6 },
  { key: "disp-day",  label: "Dispatch · day",   codes: ["GD"],       need: () => 2, people: true },
  { key: "disp-night", label: "Dispatch · night", codes: ["GN"],      need: () => 2, people: true },
  { key: "ccc-day",   label: "CCC · day",        codes: ["CD", "CH"], need: (wknd) => (wknd ? 2 : 6) },
  { key: "ccc-night", label: "CCC · night",      codes: ["CN", "CP"], need: () => 2 },
  { key: "royal-day", label: "Royal · day",      codes: ["MH"],       need: () => 2 },
  { key: "royal-night", label: "Royal · night",  codes: ["MP"],       need: () => 2 },
  { key: "alm-day",   label: "Almather · day",   codes: ["BD"],       need: () => 2 },
  { key: "alm-night", label: "Almather · night", codes: ["BN"],       need: () => 2 },
  { key: "zah",       label: "Zahrawi · Sun–Thu", codes: ["Z"],       need: (wknd) => (wknd ? 0 : 2) },
];

// How many people are on a given site/period on a given day.
export function scheduleCoverageCount(cells, accountIds, dayKey, codes) {
  const set = new Set(codes);
  let n = 0;
  (accountIds || []).forEach((id) => {
    const code = parseScheduleCode((cells || {})[scheduleCellKey(id, dayKey)] || "").code;
    if (set.has(code)) n += 1;
  });
  return n;
}

// ---------- the draft → submitted → approved workflow ----------
//
// A preparer lent the schedule area fills in a draft and submits it; a real
// administrator approves it or sends it back. Any edit reopens it to draft, so
// an approved sheet on screen is always the one that was approved. The status
// lives in the object with the cells; the version climbs on each approval.
export const SCHEDULE_STATUSES = {
  draft: "DRAFT",
  submitted: "WAITING FOR APPROVAL",
  approved: "APPROVED",
};

export function scheduleStatusLabel(schedule) {
  const s = schedule && schedule.status;
  return SCHEDULE_STATUSES[s] || SCHEDULE_STATUSES.draft;
}

export function scheduleIsApproved(schedule) {
  return !!schedule && schedule.status === "approved";
}

// The owner/admin's own account never appears on the roster — it is not a crew
// slot on the board and it is not scheduled. `accounts` from `/api/accounts`
// carries `isOwner` on that one row.
export function scheduleEligibleAccounts(accounts) {
  return (accounts || []).filter((a) => a && !a.isOwner);
}

// The whole sheet as the exports and the grid read it: groups in order, each
// with its rows (name, id, the 42 tokens, and the row's summary), the owner
// account filtered out, plus the flat list of everyone on it for the coverage
// count.
export function scheduleView(schedule, accounts, dayKeys, codes) {
  const model = schedule && typeof schedule === "object" ? schedule : {};
  const cells = model.cells && typeof model.cells === "object" ? model.cells : {};
  const byId = new Map((accounts || []).map((a) => [a.id, a]));
  const ownerIds = new Set((accounts || []).filter((a) => a && a.isOwner).map((a) => a.id));
  const groups = (Array.isArray(model.groups) ? model.groups : []).map((g) => ({
    id: g.id,
    name: g.name || "",
    rows: (g.memberIds || [])
      .filter((id) => !ownerIds.has(id))
      .map((id) => {
        const a = byId.get(id);
        return {
          accountId: id,
          name: a ? (a.name || id) : id,
          empId: id,
          cells: dayKeys.map((k) => cells[scheduleCellKey(id, k)] || ""),
          summary: employeeScheduleSummary(cells, id, dayKeys, codes),
        };
      }),
  }));
  const allIds = groups.flatMap((g) => g.rows.map((r) => r.accountId));
  return { groups, allIds };
}

// The per-day team totals the Excel working copy carries and the staff PDF
// never does. A team is two people; the count is the working people that day.
export function scheduleWorkingPerDay(cells, allIds, dayKeys, codes) {
  return dayKeys.map((k) =>
    (allIds || []).reduce((n, id) => (scheduleIsWork(cells[scheduleCellKey(id, k)], codes) ? n + 1 : n), 0)
  );
}

// The code set in force for THIS schedule: the built-in legend the department
// started from, minus any the admin hid, plus any the admin added, and with
// label/colour overrides applied. Every reader — the picker, the legend, the
// grid, the summary and both exports — goes through this so a custom code is
// the same code everywhere.
export const SCHEDULE_CODE_KINDS = {
  day: { work: true, period: "day" },
  night: { work: true, period: "night" },
  overtime: { work: true, ot: true, period: "day" },
  office: { work: true, exemptShifts: true, period: "day" },
  off: { off: true },
};
export function effectiveScheduleCodes(schedule) {
  const custom = (schedule && schedule.customCodes) || {};
  const hidden = new Set((schedule && schedule.hiddenCodes) || []);
  const out = {};
  SCHEDULE_CODE_ORDER.forEach((k) => {
    if (hidden.has(k)) return;
    const ov = custom[k] || {};
    out[k] = { ...SCHEDULE_CODES[k] };
    if (ov.label != null) out[k].label = ov.label;
    if (ov.color) out[k].color = ov.color;
  });
  Object.keys(custom).forEach((k) => {
    if (SCHEDULE_CODES[k] || hidden.has(k)) return;
    const c = custom[k];
    const kind = SCHEDULE_CODE_KINDS[c.kind] ? c.kind : "day";
    out[k] = { label: c.label || k, color: c.color, custom: true, kind, ...SCHEDULE_CODE_KINDS[kind] };
  });
  return out;
}
export function effectiveScheduleCodeOrder(schedule) {
  const hidden = new Set((schedule && schedule.hiddenCodes) || []);
  const builtins = SCHEDULE_CODE_ORDER.filter((k) => !hidden.has(k));
  const custom = Object.keys((schedule && schedule.customCodes) || {}).filter((k) => !SCHEDULE_CODES[k] && !hidden.has(k));
  return [...builtins, ...custom];
}
