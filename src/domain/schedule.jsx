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
export function scheduleIsWork(token) {
  const meta = scheduleCodeMeta(token);
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
export function employeeScheduleSummary(cells, accountId, dayKeys) {
  const tokens = dayKeys.map((k) => (cells || {})[scheduleCellKey(accountId, k)] || "");
  let shifts = 0, otHours = 0, exempt = false;
  tokens.forEach((t) => {
    const { code, hours } = parseScheduleCode(t);
    const meta = SCHEDULE_CODES[code];
    if (!meta) return;
    if (meta.exemptShifts) exempt = true;
    if (meta.ot) { otHours += hours != null ? hours : 12; if (meta.work) shifts += 1; }
    else if (meta.work) shifts += 1;
  });
  let maxWorkRun = 0, workRun = 0, maxOffRun = 0, offRun = 0;
  tokens.forEach((t) => {
    if (scheduleIsWork(t)) { workRun += 1; maxWorkRun = Math.max(maxWorkRun, workRun); offRun = 0; }
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
    if (!prevIsL) { if (i === 0 || !scheduleIsWork(tokens[i - 1])) flags.push("leave not worked into"); }
    if (!nextIsL) { if (i === tokens.length - 1 || !scheduleIsWork(tokens[i + 1])) flags.push("leave not worked out of"); }
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
