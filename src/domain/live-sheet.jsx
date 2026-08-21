
// ---------- what the live log sheet is allowed to show ----------
//
// Everything the app does is still logged, and the whole feed still goes out on
// the Event Log sheet of the export. But a desk watching a live board does not
// need to read every coding, booking and status flip scroll past: what dispatch
// would otherwise have to ask for over the radio is whether the team heard the
// call, whether they are moving, and whether they are free again. Those are the
// lines the log sheet shows; the rest are written and kept, not displayed.
//
// Back in service earns its place for the same reason the other two did. It is
// the moment a truck rejoins the pool, and a desk holding a call waiting for
// one was reading it off a status pill changing colour somewhere else on the
// board, or asking. Now it says so, in the feed, with the time on it.
export const BOARD_LOG_EVENTS = ["ack", "enroute", "backInService"];

// Lines written before entries carried an event key are matched on the sentence
// instead, so a board that is mid-shift when this build lands doesn't empty
// out. New entries never take this path.
export const LEGACY_BOARD_LOG_RE = /acknowledged call|acknowledged assist request|— En Route at|marked EN ROUTE|— Back in Service at/i;

export function isBoardLogEntry(entry) {
  if (!entry) return false;
  const key = entry.detail && entry.detail.event;
  if (key) return BOARD_LOG_EVENTS.includes(key);
  return !entry.detail && LEGACY_BOARD_LOG_RE.test(entry.message || "");
}

// The department works out of two separate stations. They run their own calls,
// their own bookings and their own log sheet — a dispatcher at one has no
// business seeing the other's board, and a crew signs on at the station they
// are actually working that shift. Administration is the one place both are
// visible at once.
export const STATIONS = [
  { key: "main", label: "Main Office", short: "MAIN" },
  { key: "ccc", label: "CCC", short: "CCC" },
];

// Everything that existed before stations did belongs to the Main Office —
// that is where the original five medics run from, so an un-tagged record read
// off an older board lands where it actually came from rather than nowhere.
export const DEFAULT_STATION = "main";

export function stationMeta(key) {
  return STATIONS.find((s) => s.key === key) || STATIONS[0];
}

export function stationLabel(key) {
  const m = STATIONS.find((s) => s.key === key);
  return m ? m.label : "";
}

export function stationShort(key) {
  const m = STATIONS.find((s) => s.key === key);
  return m ? m.short : "";
}

// The station a record belongs to. Written as one function so an older record
// with no station on it is read the same way everywhere instead of being
// treated as belonging to no station at all, which would hide it from both.
export function stationOf(x) {
  return (x && x.station) || DEFAULT_STATION;
}

export function atStation(list, station) {
  if (!station) return list || [];
  return (list || []).filter((x) => stationOf(x) === station);
}

// A unit's name is only unique inside its own station — both stations run a
// MEDIC 1. Anywhere the two are shown together the station has to come with it.
export function unitFullName(unit) {
  if (!unit) return "";
  return `${unit.name} · ${stationShort(stationOf(unit))}`;
}

export const DEFAULT_UNITS = [
  { id: "u1", name: "MEDIC 1", station: "main", status: "oos", assignedRequestId: null, alpha: null, bravo: null },
  { id: "u2", name: "MEDIC 2", station: "main", status: "oos", assignedRequestId: null, alpha: null, bravo: null },
  { id: "u3", name: "MEDIC 3", station: "main", status: "oos", assignedRequestId: null, alpha: null, bravo: null },
  { id: "u4", name: "MEDIC 4", station: "main", status: "oos", assignedRequestId: null, alpha: null, bravo: null },
  { id: "u5", name: "MEDIC 5", station: "main", status: "oos", assignedRequestId: null, alpha: null, bravo: null },
  { id: "uz", name: "ZAHRAWI", station: "main", status: "oos", assignedRequestId: null, alpha: null, bravo: null },
  { id: "c1", name: "MEDIC 1", station: "ccc", status: "oos", assignedRequestId: null, alpha: null, bravo: null },
  { id: "c2", name: "MEDIC 2", station: "ccc", status: "oos", assignedRequestId: null, alpha: null, bravo: null },
  { id: "c3", name: "MEDIC 3", station: "ccc", status: "oos", assignedRequestId: null, alpha: null, bravo: null },
];

// The two built-in accounts. Each logs in with just its ID the first time,
// then chooses a password. Anyone else (more admins, dispatchers, or crew) is
// created by an admin from inside the Admin view.
export const DEFAULT_ACCOUNTS = [
  { id: "F1525518", name: "Admin", role: "admin", team: null, slot: null, passwordHash: null, createdAt: Date.now() },
  { id: "D1000001", name: "Dispatcher", role: "dispatcher", team: null, slot: null, passwordHash: null, createdAt: Date.now() },
];

// Lightweight client-side password hashing (SHA-256 via the browser's own
// crypto API — no server involved). This keeps casual/unauthorized people
// out through the app's own UI, but it is NOT enterprise-grade auth: there's
// no salt, and anyone with direct Firestore access could still read the
// hashes. Fine for gating who can act as dispatch/admin day-to-day; if this
// ever needs to be airtight for compliance purposes, it should move to a
// real backend with server-side verification instead.
export async function hashPassword(pw) {
  const enc = new TextEncoder().encode(pw);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}