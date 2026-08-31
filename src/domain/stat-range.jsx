import { gregDateStr } from "../lib/dates.jsx";
import { opDayStart } from "./op-day.jsx";
import { shiftMeta, shiftWindowAt } from "./shift-helpers.jsx";
import { SHIFT_MS } from "./shifts.jsx";

// ---------- which period the statistics are describing ----------
//
// Split out of `Statistics.jsx` so it can be tested. The page is React and
// XLSX and a thousand lines of table; this is date arithmetic, and date
// arithmetic is where an off-by-one quietly retitles a report.
export const STAT_RANGES = [
  { key: "shift", label: "This shift" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
];

// The operational week: Sunday 07:00 to the next Sunday 07:00. Anchored on the
// same boundary as the operational day — before 07:00 the board is still
// inside yesterday, so the small hours of Sunday morning belong to the week
// that is ending, not the one about to start. Sunday because that is when the
// department's week starts; the working days run Sunday to Thursday.
export function statWeekStart(ts) {
  const d = new Date(opDayStart(ts));
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

// A period, and what to call it.
//
// "This month" is fine on a screen somebody is looking at now. On a report that
// will be filed, forwarded and read in November it says nothing — it has to say
// August. So each window carries both: the phrase for the screen and the name
// for the page.
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// A chosen period is written into the range key: "month" is this month, and
// "month:2026-4" is May 2026.
//
// Which month or quarter somebody is looking at is not a second piece of state
// held beside the range — it IS the range, and keeping it as one string means
// every place that already passes `range` around, names a file after it or
// titles a report with it keeps working without knowing that periods can now be
// chosen. `statRangeBase` is what the tabs highlight on.
export function statRangeBase(key) {
  return String(key || "month").split(":")[0];
}

function statRangeArg(key) {
  const parts = String(key || "").split(":");
  return parts.length > 1 ? parts[1] : "";
}

export function statRangeWindow(key, now) {
  const base = statRangeBase(key);
  const arg = statRangeArg(key);
  const d = new Date(now);
  if (base === "shift") {
    // "shift:1725000000000" — the window's own start, so a chosen shift stays
    // chosen however the clock moves. A minute inside the window resolves it
    // back through `shiftWindowAt`, the one place that knows where a shift's
    // edges are.
    const w = shiftWindowAt(arg ? Number(arg) + 60000 : now);
    const current = w.start === shiftWindowAt(now).start;
    const meta = shiftMeta(w.key);
    return {
      start: w.start,
      end: w.start + SHIFT_MS,
      label: current
        ? "this shift"
        : `the ${meta ? meta.short.toLowerCase() : ""} shift of ${gregDateStr(w.start)}`,
      title: `${meta ? meta.label : "Shift"} — ${gregDateStr(w.start)}`,
    };
  }
  if (base === "week") {
    // "week:2026-7-30" — year, month INDEX and day of the Sunday the week
    // opened on, month index for the same reason as the month range. Resolved
    // through `opDayStart` so the 07:00 boundary has exactly one definition.
    const [wy, wm, wd] = arg.split("-").map(Number);
    const start = arg
      ? opDayStart(new Date(wy, wm, wd, 12, 0, 0, 0).getTime())
      : statWeekStart(now);
    const endD = new Date(start);
    endD.setDate(endD.getDate() + 7);
    const lastD = new Date(start);
    lastD.setDate(lastD.getDate() + 6);
    const current = start === statWeekStart(now);
    return {
      start,
      end: endD.getTime(),
      label: current ? "this week" : `the week of ${gregDateStr(start)}`,
      title: `Week ${gregDateStr(start)} – ${gregDateStr(lastD.getTime())}`,
    };
  }
  if (base === "month") {
    // "2026-4" — the month index, not the month number, so it lines up with
    // MONTH_NAMES and with Date without an off-by-one anywhere in between.
    const [ys, ms] = arg.split("-");
    const year = Number(ys) || d.getFullYear();
    const month = arg ? Number(ms) : d.getMonth();
    const current = year === d.getFullYear() && month === d.getMonth();
    return {
      start: new Date(year, month, 1).getTime(),
      end: new Date(year, month + 1, 1).getTime(),
      label: current ? "this month" : `${MONTH_NAMES[month]} ${year}`,
      title: `${MONTH_NAMES[month]} ${year}`,
    };
  }
  if (base === "quarter") {
    // "2026-2" — Q2, one-based, because that is what a quarter is called.
    const [ys, qs] = arg.split("-");
    const year = Number(ys) || d.getFullYear();
    const qIndex = arg ? Math.min(3, Math.max(0, Number(qs) - 1)) : Math.floor(d.getMonth() / 3);
    const q = qIndex * 3;
    const current = year === d.getFullYear() && qIndex === Math.floor(d.getMonth() / 3);
    const title = `Q${qIndex + 1} ${year} — ${MONTH_NAMES[q]} to ${MONTH_NAMES[q + 2]}`;
    return {
      start: new Date(year, q, 1).getTime(),
      end: new Date(year, q + 3, 1).getTime(),
      label: current ? "this quarter" : `Q${qIndex + 1} ${year}`,
      title,
    };
  }
  const year = arg ? Number(arg) || d.getFullYear() : d.getFullYear();
  return {
    start: new Date(year, 0, 1).getTime(),
    end: new Date(year + 1, 0, 1).getTime(),
    label: year === d.getFullYear() ? "this year" : String(year),
    title: String(year),
  };
}

// What the picker offers: this period and the ones behind it, never ahead.
//
// A statistics page is read backwards — "how did we do in May" — and a period
// that has not happened yet has nothing in it to read, so offering it is only a
// way to land on an empty page and wonder what is broken.
export function statPeriodOptions(key, now) {
  const base = statRangeBase(key);
  const d = new Date(now);
  const out = [];
  if (base === "shift") {
    // The last fortnight of shifts — twenty-eight of them, this one first.
    // Stepping to the millisecond before a window's start lands inside the
    // shift before it, so the walk backwards needs no idea of its own about
    // where a day or a night begins.
    let w = shiftWindowAt(now);
    for (let i = 0; i < 28; i++) {
      const meta = shiftMeta(w.key);
      out.push({
        key: `shift:${w.start}`,
        label: `${meta ? meta.label : "SHIFT"} — ${gregDateStr(w.start)}` + (i === 0 ? " (this shift)" : ""),
      });
      w = shiftWindowAt(w.start - 1);
    }
    return out;
  }
  if (base === "week") {
    // Half a year of weeks, each named by both ends — a week is the one period
    // whose name alone ("week 35") nobody can place on a calendar.
    const first = statWeekStart(now);
    for (let i = 0; i < 26; i++) {
      const s = new Date(first);
      s.setDate(s.getDate() - i * 7);
      const last = new Date(s);
      last.setDate(last.getDate() + 6);
      out.push({
        key: `week:${s.getFullYear()}-${s.getMonth()}-${s.getDate()}`,
        label: `${gregDateStr(s.getTime())} – ${gregDateStr(last.getTime())}` + (i === 0 ? " (this week)" : ""),
      });
    }
    return out;
  }
  if (base === "month") {
    for (let i = 0; i < 24; i++) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push({
        key: `month:${m.getFullYear()}-${m.getMonth()}`,
        label: i === 0 ? `${MONTH_NAMES[m.getMonth()]} ${m.getFullYear()} (this month)`
          : `${MONTH_NAMES[m.getMonth()]} ${m.getFullYear()}`,
      });
    }
    return out;
  }
  if (base === "quarter") {
    const thisQ = Math.floor(d.getMonth() / 3);
    for (let i = 0; i < 8; i++) {
      const n = thisQ - i;
      const year = d.getFullYear() + Math.floor(n / 4);
      const qIndex = ((n % 4) + 4) % 4;
      out.push({
        key: `quarter:${year}-${qIndex + 1}`,
        label: `Q${qIndex + 1} ${year} · ${MONTH_NAMES[qIndex * 3].slice(0, 3)}–${MONTH_NAMES[qIndex * 3 + 2].slice(0, 3)}` +
          (i === 0 ? " (this quarter)" : ""),
      });
    }
    return out;
  }
  if (base === "year") {
    for (let i = 0; i < 5; i++) {
      const y = d.getFullYear() - i;
      out.push({ key: `year:${y}`, label: i === 0 ? `${y} (this year)` : String(y) });
    }
    return out;
  }
  return out;
}

