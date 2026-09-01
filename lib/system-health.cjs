// ---------- what the system says about itself ----------
//
// The owner's System page shows everything the platform knows about its own
// health: errors devices reported, which phones the server has heard from,
// how fast requests are answered. The rules for that live here, apart from
// the routes, so `npm test` holds them the way it holds the merge and the
// delegation list.

// A device's error report crosses the network and lands in a store the owner
// reads, so it is bounded and scrubbed before it is kept. The caps stop one
// looping page from writing a novel; the digit mask stops an error message
// that happens to quote a form field from carrying an MRN into the store —
// an MRN is a run of digits, and no stack trace needs one to be debuggable.
const REPORT_CAPS = { message: 300, stack: 900, screen: 80, build: 40, role: 20, unit: 40, platform: 20 };
const REPORT_LIST_CAP = 100;

function scrubText(s, max) {
  return String(s == null ? "" : s).slice(0, max).replace(/\d{5,}/g, "#####");
}

function cleanReport(raw, now) {
  if (!raw || typeof raw !== "object") return null;
  const message = scrubText(raw.message, REPORT_CAPS.message).trim();
  if (!message) return null;
  return {
    ts: now,
    message,
    stack: scrubText(raw.stack, REPORT_CAPS.stack),
    screen: scrubText(raw.screen, REPORT_CAPS.screen),
    build: scrubText(raw.build, REPORT_CAPS.build),
    role: scrubText(raw.role, REPORT_CAPS.role),
    unit: scrubText(raw.unit, REPORT_CAPS.unit),
    platform: scrubText(raw.platform, REPORT_CAPS.platform),
    count: 1,
  };
}

// The same fault firing on a loop is one fault, not a hundred rows. A report
// matching an existing one (same message, same build) bumps that row's count
// and freshens its timestamp instead of burying every other error under
// copies of itself. The list is newest-first and capped.
function addReport(list, report) {
  const held = Array.isArray(list) ? list.slice() : [];
  const i = held.findIndex((r) => r && r.message === report.message && r.build === report.build);
  if (i >= 0) {
    const merged = { ...held[i], ts: report.ts, count: (held[i].count || 1) + 1 };
    held.splice(i, 1);
    held.unshift(merged);
    return held;
  }
  held.unshift(report);
  return held.slice(0, REPORT_LIST_CAP);
}

// ---------- findings: what the server refused or quietly corrected ----------
//
// The ghost-reset bug taught this: the worst faults do not error. A stale
// device replaying an old write, a screen offering what the server refuses,
// somebody working through the sign-in limiter — the server SEES all of it,
// says no, and used to say no silently. Every silent correction now leaves a
// note on the owner's System page, so "the server refused something odd" is
// a line a person reads rather than a thing nobody ever learns.
//
// Same discipline as the error reports: deduped (the same finding firing on
// a loop is one row counted up), capped, and message text bounded — some of
// these quote what a STRANGER typed, and that text is data, never trusted.
const FINDING_LIST_CAP = 100;

function addFinding(list, kind, message, now) {
  const held = Array.isArray(list) ? list.slice() : [];
  // Bounded but NOT digit-masked: findings are composed by the SERVER and
  // name employee IDs on purpose — "which device is fighting the board" is
  // the answer the owner opens this page for, and an ID is a staff
  // identifier, not patient data. A caller quoting a STRANGER's text must
  // scrubText() that part itself before it gets here (the sign-in limiter
  // does), because a stranger can type anything — an MRN included.
  const msg = String(message == null ? "" : message).slice(0, 240);
  const k = String(kind || "finding").slice(0, 40);
  const i = held.findIndex((f) => f && f.kind === k && f.message === msg);
  if (i >= 0) {
    const merged = { ...held[i], ts: now, count: (held[i].count || 1) + 1 };
    held.splice(i, 1);
    held.unshift(merged);
    return held;
  }
  held.unshift({ ts: now, kind: k, message: msg, count: 1 });
  return held.slice(0, FINDING_LIST_CAP);
}

// Latency over a ring of recent durations. Percentiles, not averages — one
// slow archive read must be visible beside a thousand fast polls, and an
// average hides exactly that.
function latencyStats(durations) {
  const v = (durations || []).filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!v.length) return { n: 0, p50: 0, p95: 0, max: 0 };
  const at = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  return { n: v.length, p50: at(0.5), p95: at(0.95), max: v[v.length - 1] };
}

// A phone the server has stopped hearing from is a crew that will miss a
// call. "Stale" is judged against the fast poll: at 3 seconds per poll, a
// minute of silence is twenty missed polls — a frozen WebView, a dead
// battery, or a phone in a pocket with the app killed. Two minutes is the
// line where the page says so out loud.
const FLEET_STALE_MS = 2 * 60 * 1000;

function fleetRow(entry, now) {
  const silentMs = now - (entry.lastSeen || 0);
  return { ...entry, silentMs, stale: silentMs > FLEET_STALE_MS };
}

// ---------- the watchdog: a silent truck on a live call ----------
//
// The one condition worth waking the owner for. A crew's phone that has
// stopped reaching the server WHILE their truck is on a call is a crew that
// will not hear the stand-down, the reassignment or the next message — and
// silence is a thing only the server can see. A truck counts as silent when
// EVERY seated crew member's account has been quiet past the threshold: one
// dead phone with a live partner is the partner's to mention, not an alarm.
function silentActiveTrucks(units, seenMap, now, staleMs) {
  const out = [];
  for (const u of units || []) {
    if (!u || !u.assignedRequestId) continue;
    const seats = ["alpha", "bravo"]
      .map((s) => u[s] && u[s].accountId)
      .filter(Boolean);
    if (!seats.length) continue;
    const quietest = Math.min(
      ...seats.map((id) => now - (seenMap.get ? seenMap.get(id) || 0 : 0))
    );
    if (quietest > staleMs) out.push({ unit: u.name || u.id, silentMs: quietest, seats });
  }
  return out;
}

// ---------- one line of history per day ----------
//
// Everything else on the System page is NOW — counters even reset with the
// process, deliberately. One tiny row per day is what lets "the board has
// been getting slower since Tuesday" be a thing the page can show. Bounded
// hard: the history must never become the storage problem it watches for.
const HISTORY_CAP = 90;

function historyAppend(list, row) {
  const held = (Array.isArray(list) ? list : []).filter((r) => r && r.day !== row.day);
  held.push(row);
  held.sort((a, b) => String(a.day).localeCompare(String(b.day)));
  return held.slice(-HISTORY_CAP);
}

// A burst of device errors — many faults in a short window — is a deploy
// gone wrong or a server fault echoing on every screen, and is worth one
// notice on its own even though each report is already listed.
function errorBurst(times, now, windowMs, threshold) {
  return (times || []).filter((t) => now - t <= windowMs).length >= threshold;
}

module.exports = {
  REPORT_LIST_CAP,
  FINDING_LIST_CAP,
  FLEET_STALE_MS,
  HISTORY_CAP,
  scrubText,
  cleanReport,
  addReport,
  addFinding,
  latencyStats,
  fleetRow,
  silentActiveTrucks,
  historyAppend,
  errorBurst,
};
