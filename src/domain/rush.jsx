import { ON_CALL_STATUSES, effectiveStatus, isStaffed } from "./in-service.jsx";
import { stationOf } from "./live-sheet.jsx";
import { callEndTs, callStartTs, isCallLive } from "./uhu.jsx";

// ---------- rush ----------
//
// How hard the department is being worked, right now and by hour of day.
//
// A rush is not calls per hour — it is demand against capacity. Two trucks busy
// is a rush when two are staffed and a quiet spell when five are, so the live
// meter reads the calls that are running against the trucks that are staffed to
// run them, plus the one number that outranks both: whether anything is waiting
// with nothing free to send.
//
// Nothing here is stored. The live reading is derived from the same `units` and
// `requests` the three-second poll already carries, and the history is derived
// from call intervals the archive already holds — so the history reaches back
// through every filed month from the day this shipped, there is nothing new to
// back up, and nothing that can be lost.
//
// Staffing is judged by `effectiveStatus`, never the stored status field, so
// this meter can never disagree with the AVAILABLE / ON A CALL counts drawn
// beside it from the same rule.

export const RUSH_LEVELS = {
  quiet: { key: "quiet", label: "QUIET", color: "var(--ink-4)" },
  steady: { key: "steady", label: "STEADY", color: "var(--ok)" },
  busy: { key: "busy", label: "BUSY", color: "var(--hold)" },
  // Amber-red, but by way of --hold-2: on this board plain red already means a
  // critical call and NO COVERAGE, and it must not also mean "we are busy".
  rush: { key: "rush", label: "RUSH", color: "var(--hold-2)" },
};

export function rushMeta(key) {
  return RUSH_LEVELS[key] || RUSH_LEVELS.quiet;
}

// The reading itself. `station` narrows to one station; null is the whole
// department. Zahrawi is deliberately NOT excluded here the way coverage
// excludes it: a rush meter asks what is out working, and Zahrawi out working
// is a truck out working.
export function rushNow(units, requests, station, now) {
  const at = now || Date.now();
  const mine = (units || []).filter((u) => u && (!station || stationOf(u) === station));
  const staffed = mine.filter((u) => isStaffed(u)).length;
  const busy = mine.filter((u) => ON_CALL_STATUSES.includes(effectiveStatus(u, requests))).length;
  const free = Math.max(0, staffed - busy);

  const liveCalls = (requests || []).filter(
    (r) => r && isCallLive(r) && (!station || stationOf(r) === station)
  );
  // Waiting means no truck has it yet. A call assigned but not yet acknowledged
  // is somebody's; a pending one is nobody's, and it is the number that turns
  // the meter regardless of arithmetic.
  const waiting = liveCalls.filter((r) => r.status === "pending").length;

  let level = "quiet";
  if (liveCalls.length > 0 || waiting > 0) level = "steady";
  if (staffed > 0 && busy / staffed >= 0.5) level = "busy";
  // Everything out, or something waiting with nothing free: whichever way it is
  // said, the next call has nowhere to go.
  if ((staffed > 0 && busy >= staffed) || (waiting > 0 && free === 0)) level = "rush";

  return { level, live: liveCalls.length, waiting, busy, staffed, free };
}

// ---------- the history: which hours actually run hot ----------

// One operational day of hour buckets, anchored at 07:00 so the profile reads
// in the department's own order — the day shift on the left, the night that
// follows it on the right — exactly as every sheet splits the same day.
export const RUSH_HOURS = Array.from({ length: 24 }, (_, i) => (7 + i) % 24);

export function rushHourLabel(h) {
  return `${String(h).padStart(2, "0")}:00`;
}

// How loaded each hour of the day is, averaged across the period.
//
// Each bucket is the time calls spent RUNNING inside that hour of day, summed
// over the period and divided by the days in it — so a bar at 2.0 means that on
// an ordinary day, two ambulances are tied up through that hour. Counting calls
// raised instead would score a three-hour transfer the same as a twenty-minute
// one, and the whole point of this panel is how long the busy spells last.
//
// Intervals come from `callStartTs`/`callEndTs`, which already cap an open call
// at one shift — so the abandoned 48-hour call that once carried a UHU to 81%
// cannot paint this chart busy either.
export function rushHourProfile(requests, from, to, now) {
  const at = now || Date.now();
  const end = Math.min(to, at);
  const dayMs = 24 * 3600000;
  const days = Math.max(1, (end - from) / dayMs);

  const busyMs = new Array(24).fill(0);
  const raised = new Array(24).fill(0);
  (requests || []).forEach((r) => {
    if (!r || !r.createdAt || r.createdAt < from || r.createdAt >= to) return;
    raised[new Date(r.createdAt).getHours()] += 1;
    const s = callStartTs(r);
    if (!s) return;
    const e = Math.min(callEndTs(r, at) || s, end);
    // Walk the interval hour by hour, clipping each end. A call from 09:40 to
    // 11:10 contributes 20 minutes to 9, the whole of 10, and 10 minutes to 11.
    let cursor = Math.max(s, from);
    while (cursor < e) {
      const d = new Date(cursor);
      const hourStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
      const hourEnd = hourStart + 3600000;
      const slice = Math.min(e, hourEnd) - cursor;
      if (slice > 0) busyMs[d.getHours()] += slice;
      cursor = hourEnd;
    }
  });

  const rows = RUSH_HOURS.map((h) => ({
    hour: h,
    label: rushHourLabel(h),
    // Average ambulances tied up through this hour, across the period.
    avg: busyMs[h] / 3600000 / days,
    raised: raised[h],
  }));
  const max = rows.reduce((m, r) => Math.max(m, r.avg), 0);
  const total = raised.reduce((n, x) => n + x, 0);

  // The answer in words: the hours somebody would name in a meeting. Peaks are
  // hours within 85% of the busiest; quiet is the emptiest stretch.
  const peaks = max > 0 ? rows.filter((r) => r.avg >= max * 0.85).map((r) => r.hour) : [];
  return { rows, max, total, days, peaks };
}

// "09:00–11:00 and 19:00–20:00" — consecutive hours folded into ranges, in the
// operational day's own order.
export function rushHourRanges(hours) {
  if (!hours || !hours.length) return "";
  const order = new Map(RUSH_HOURS.map((h, i) => [h, i]));
  const sorted = hours.slice().sort((a, b) => order.get(a) - order.get(b));
  const ranges = [];
  sorted.forEach((h) => {
    const last = ranges[ranges.length - 1];
    if (last && order.get(h) === order.get(last.to) + 1) last.to = h;
    else ranges.push({ from: h, to: h });
  });
  return ranges
    .map((r) => `${rushHourLabel(r.from)}–${rushHourLabel((r.to + 1) % 24)}`)
    .join(" and ");
}
