import { authHeaders, noteAuthLost } from "./auth.jsx";
import { LOG_CAP } from "../brand/artwork.jsx";
import { API_BASE, READ_FAILED } from "./board-api.jsx";

// ---------- working without a signal ----------
//
// An ambulance loses its connection constantly — basements, lifts, concrete
// stairwells, which is exactly where patients are. Before this existed a crew
// could stamp a whole call underground, watch every time land on screen, and
// lose all of it the moment the tablet found a signal again: the write had
// failed silently and the next poll overwrote the screen with the server's
// older copy. Silent loss is worse than a visible error, because nobody knows
// to re-enter anything.
//
// So: a failed write is not discarded. The records it was trying to save are
// kept here, on the device, and replayed onto whatever the server has as soon
// as it can be reached. They are kept per record rather than as a whole board,
// so replaying a crew's timestamps cannot wipe out what the desk did while
// they were out of contact.
export const PENDING_KEY = "ems:pendingWrites";

// { "ems:requests": { "<record id>": {...record} }, ... }
export let pendingWrites = {};

export function loadPendingWrites() {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    pendingWrites = raw ? JSON.parse(raw) || {} : {};
  } catch (e) {
    pendingWrites = {};
  }
  return pendingWrites;
}

export function savePendingWrites() {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(pendingWrites));
  } catch (e) {
    // A device with no storage left still works — it just can't survive a
    // reload while offline. Nothing else should break because of this.
  }
}

export function pendingCountFor(key) {
  return Object.keys(pendingWrites[key] || {}).length;
}

export function totalPendingCount() {
  return Object.keys(pendingWrites).reduce((n, k) => n + pendingCountFor(k), 0);
}

// Which records in `next` are new or changed compared with `prev`. Only these
// are worth keeping: a crew stamping one call has changed one record, and
// queueing the whole board would mean replaying their copy of every other
// call too.
export function changedRecords(next, prev) {
  const before = new Map((prev || []).filter((x) => x && x.id).map((x) => [x.id, JSON.stringify(x)]));
  const out = {};
  (next || []).forEach((rec) => {
    if (!rec || !rec.id) return;
    const now = JSON.stringify(rec);
    if (before.get(rec.id) !== now) out[rec.id] = rec;
  });
  return out;
}

// Which records `prev` had and `next` does not. Deliberate removals — an
// administrator taking a truck off the fleet — and nothing else: a record
// somebody else added while this device was not looking is in neither list, so
// it cannot be swept up by one.
export function removedIds(next, prev) {
  const here = new Set((next || []).filter((x) => x && x.id).map((x) => String(x.id)));
  return (prev || [])
    .filter((x) => x && x.id && !here.has(String(x.id)))
    .map((x) => String(x.id));
}

export function queueRecords(key, records) {
  if (!records || !Object.keys(records).length) return;
  const stamped = {};
  Object.keys(records).forEach((id) => {
    stamped[id] = { ...records[id], __queuedAt: Date.now() };
  });
  pendingWrites[key] = { ...(pendingWrites[key] || {}), ...stamped };
  savePendingWrites();
}

export function clearQueued(key, ids) {
  if (!pendingWrites[key]) return;
  ids.forEach((id) => delete pendingWrites[key][id]);
  if (!Object.keys(pendingWrites[key]).length) delete pendingWrites[key];
  savePendingWrites();
}

// Drop anything we are holding that the server already has, identically.
//
// Without this the queue had no way of noticing a record had got through. A
// write that failed once — or that succeeded on a retry the caller never heard
// about — left records held forever, and the banner sat there announcing "316
// saved changes" on a board where nothing had changed since yesterday. A held
// record only means something while it differs from the server; the moment the
// two agree it is finished, and saying otherwise is just noise.
//
// Age is the second net: nothing is worth holding for more than a day. If it
// has not gone up by then it never will, and it is certainly no longer the
// newest version of anything.
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function reconcilePending(key, serverList) {
  const held = pendingWrites[key];
  if (!held) return;
  const onServer = new Map(
    (serverList || []).filter((x) => x && x.id).map((x) => [x.id, JSON.stringify(x)])
  );
  let dropped = 0;
  Object.keys(held).forEach((id) => {
    const rec = held[id];
    const stale = rec && rec.__queuedAt && Date.now() - rec.__queuedAt > PENDING_MAX_AGE_MS;
    const settled = onServer.get(id) === JSON.stringify(stripQueueMeta(rec));
    if (settled || stale) {
      delete held[id];
      dropped += 1;
    }
  });
  if (!Object.keys(held).length) delete pendingWrites[key];
  if (dropped) {
    savePendingWrites();
    notifyPendingChanged();
  }
}

export function stripQueueMeta(rec) {
  if (!rec || typeof rec !== "object") return rec;
  const { __queuedAt, ...clean } = rec;
  return clean;
}

// The server's copy, with anything this device is still holding laid over the
// top of it. A record the device changed wins, because the device is the only
// place that change exists yet.
export function mergePending(key, serverList) {
  const held = pendingWrites[key];
  if (!held || !Object.keys(held).length) return serverList || [];
  const byId = new Map((serverList || []).filter((x) => x && x.id).map((x) => [x.id, x]));
  // The queue marker is bookkeeping for this device, not part of the record —
  // it must never reach the board or the spreadsheet.
  Object.values(held).forEach((rec) => byId.set(rec.id, stripQueueMeta(rec)));
  const merged = Array.from(byId.values());
  // The log is a newest-first feed with a cap; everything else keeps the order
  // the server gave it.
  if (key === "ems:log") {
    merged.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return merged.slice(0, LOG_CAP);
  }
  return merged;
}

// ---------- not downloading what has not changed ----------
//
// The cold poll reads the whole archive and every filed submission, on every
// device, every thirty seconds — and on a mature board that is tens of
// megabytes that change roughly once a day. One tablet never notices; seventy
// devices doing it at once is over a hundred megabytes a second of JSON asked
// of one server, and a stress test at double the department's real load showed
// the three-second board poll queuing minutes behind it.
//
// So each key remembers the ETag the server sent with it, asks with
// If-None-Match, and a bodiless 304 means "what you already hold" — the cached
// copy is used and nothing was downloaded. The cache holds the SERVER's copy;
// the pending-write merge still runs on every read, exactly as it does on a
// fresh download, so a held record is never hidden by a cache hit.
const readCache = new Map(); // key -> { etag, value }

async function fetchKeyValue(key) {
  const cached = readCache.get(key);
  const headers = authHeaders();
  if (cached && cached.etag) headers["If-None-Match"] = cached.etag;
  const res = await fetch(`${API_BASE}/api/board?key=${encodeURIComponent(key)}`, { headers });
  if (res.status === 304 && cached) return { status: 200, value: cached.value };
  // The reason rides on a header (X-Auth-Reason) so a device signed out
  // because its owner signed in on another phone can be told exactly that.
  if (res.status === 401 || res.status === 403) return { status: res.status, value: null, reason: res.headers.get("x-auth-reason") || "" };
  if (!res.ok) throw new Error(`readKey ${key} failed: ${res.status}`);
  const { value } = await res.json();
  const etag = res.headers.get("ETag");
  // A null answer means the key is gone (a fresh board, a reset) — dropping
  // the entry is what stops a stale ETag resurrecting the old copy.
  if (etag && value != null) readCache.set(key, { etag, value });
  else readCache.delete(key);
  return { status: 200, value };
}

export async function readKeyRaw(key) {
  try {
    const got = await fetchKeyValue(key);
    // A token that has expired, or an account that has been removed. Not a
    // lost signal: holding the records and laying them over the server's copy
    // would show a board that looks right and is saving nothing.
    if (got.status === 401) {
      noteAuthLost(got.reason || "");
      setConnectionOk(true);
      return null;
    }
    // Refused, not unreachable. The account list in particular is no longer
    // served through the board — it is credential material and now sits behind
    // its own administrator-only endpoint. A refusal means "nothing here for
    // you", not "no signal", and one forbidden key must not make a working
    // board look offline.
    if (got.status === 403) {
      setConnectionOk(true);
      return null;
    }
    const value = got.value;
    setConnectionOk(true);
    if (value == null) return null;
    if (Array.isArray(value)) {
      // Anything the server already has, identically, is no longer outstanding.
      reconcilePending(key, value);
      return mergePending(key, value);
    }
    return value;
  } catch (e) {
    console.error("readKey failed:", key, e);
    setConnectionOk(false);
    return READ_FAILED;
  }
}

export async function readKey(key, fallback) {
  try {
    const got = await fetchKeyValue(key);
    // A token that has expired, or an account that has been removed. Not a
    // lost signal: holding the records and laying them over the server's copy
    // would show a board that looks right and is saving nothing.
    if (got.status === 401) {
      noteAuthLost(got.reason || "");
      setConnectionOk(true);
      return fallback;
    }
    // Refused, not unreachable. The account list in particular is no longer
    // served through the board — it is credential material and now sits behind
    // its own administrator-only endpoint. A refusal means "nothing here for
    // you", not "no signal", and one forbidden key must not make a working
    // board look offline.
    if (got.status === 403) {
      // The fallback, not null. This function is handed one precisely so a
      // caller always gets something usable, and a refusal is exactly that
      // case - returning null made `readKey(k, []).some(...)` throw on the very
      // next line and killed the whole handler without a word to anybody.
      setConnectionOk(true);
      return fallback;
    }
    const value = got.value;
    setConnectionOk(true);
    if (value == null) return fallback;
    // Anything this device is still holding is laid over the server's copy
    // before anyone reads it, so a mutation built on this read is built on
    // what the crew can actually see — not on a version of the call that has
    // forgotten the last three things they did.
    return Array.isArray(value) ? mergePending(key, value) : value;
  } catch (e) {
    console.error("readKey failed:", key, e);
    setConnectionOk(false);
    return fallback;
  }
}

// Whether the last attempt to reach the server worked. Read by the banner so a
// crew can see the state they are actually in rather than guessing from a
// screen that looks normal either way.
export let connectionOk = true;
export const connectionListeners = new Set();

// One failed request is not a lost signal. On a 3-second poll a single blip
// used to flip the banner to OFFLINE and the next poll flipped it straight back,
// so the thing meant to tell a crew where they stand was flickering at them
// instead. Coming back is instant — a request that succeeds means there is
// signal, full stop — but going offline needs a few failures in a row before we
// say so out loud.
export const OFFLINE_STRIKES = 3;
// Set when the server answers and refuses, as opposed to not answering at all.
// The two look identical from behind a queue, and they need different words.
export let lastWriteError = null;
export let connectionStrikes = 0;

export function setConnectionOk(ok) {
  if (ok) {
    connectionStrikes = 0;
  } else {
    connectionStrikes += 1;
    // Not enough failures yet to call it. Say nothing and wait.
    if (connectionStrikes < OFFLINE_STRIKES) return;
  }
  if (connectionOk === ok) return;
  connectionOk = ok;
  connectionListeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {}
  });
}

// When this device last got something onto the server. The banner says it in
// words, because "saved" and "saved somewhere the rest of the department can
// see" are different states and only one of them is any use.
export let lastSyncedAt = 0;
export function noteSynced() {
  lastSyncedAt = Date.now();
}

export function notifyPendingChanged() {
  connectionListeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {}
  });
}

// Writes are retried once. An assignment is two of these in a row (the call,
// then the unit), and a single dropped write used to leave the desk showing a
// call as assigned while the crew's screen stayed silent. The retry closes most
// of that gap; liveRequestFor and the repair pass in loadAll cover the rest.
export async function writeKey(key, value) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${API_BASE}/api/board`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ key, value }),
      });
      if (res.status === 401) {
        // Signed out from under us. Queueing this would be pretending.
        noteAuthLost(res.headers.get("x-auth-reason") || "");
        throw Object.assign(new Error(`writeKey ${key}: signed out`), { httpStatus: 401 });
      }
      if (!res.ok) {
        // A rejection is not a lost signal, and must not be dressed up as one.
        // 413 in particular means the board outgrew the server's body limit:
        // the app would hold the records, merge them over the server's copy on
        // read, and show a screen that looked saved while nothing was. Say so
        // instead of quietly queueing forever.
        const err = new Error(`writeKey ${key} failed: ${res.status}`);
        err.httpStatus = res.status;
        throw err;
      }
      setConnectionOk(true);
      // A write that lands clears any standing refusal.
      if (lastWriteError) {
        lastWriteError = null;
        notifyPendingChanged();
      }
      return true;
    } catch (e) {
      console.error("writeKey failed:", key, e);
      // The server answered, and refused. Retrying an identical body will get
      // the identical refusal, so there is nothing to wait for.
      if (e && e.httpStatus) {
        lastWriteError = `The server refused to save (${e.httpStatus}). Nothing has been lost — it is held on this device — but it is not reaching the server.`;
        notifyPendingChanged();
        return false;
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }
  }
  lastWriteError = null;
  setConnectionOk(false);
  return false;
}

// Push everything this device is still holding back up to the server. Called on
// every poll: the moment there is signal again, the queue drains on its own
// without anybody having to remember to do anything.
//
// The held records are laid over the server's current copy rather than replacing
// it, so a call the desk changed while the crew was underground keeps that
// change, and the crew's stamps go on top of it.
export async function pushPendingWrites() {
  if (!totalPendingCount()) return;
  for (const key of Object.keys(pendingWrites)) {
    const ids = Object.keys(pendingWrites[key] || {});
    if (!ids.length) continue;
    try {
      const res = await fetch(`${API_BASE}/api/board?key=${encodeURIComponent(key)}`, {
      headers: authHeaders(),
    });
      if (!res.ok) throw new Error(`replay read ${key} failed: ${res.status}`);
      const { value } = await res.json();
      const merged = mergePending(key, Array.isArray(value) ? value : []);
      const ok = await writeKey(key, merged);
      if (ok) {
        clearQueued(key, ids);
        notifyPendingChanged();
      } else {
        break;
      }
    } catch (e) {
      // Still no signal. Everything stays queued and the next poll tries again.
      setConnectionOk(false);
      break;
    }
  }
}

// While a write is in the air, the server's copy of that key is out of date by
// definition. The board polls every three seconds, so without this a crew's tap
// could be painted over by a read that started before their change landed — the
// stamp would appear, vanish, and the crew would tap again thinking it had not
// registered. That is exactly what was happening.
//
// A key is held from the moment a write starts until shortly after it finishes,
// and reads for a held key are ignored rather than applied.
export const writesInFlight = new Map();
export const WRITE_SETTLE_MS = 1500;

export function markWriteStarted(key) {
  writesInFlight.set(key, { started: Date.now(), done: 0 });
}

export function markWriteFinished(key) {
  const e = writesInFlight.get(key);
  if (e) e.done = Date.now();
}

export function writeInFlight(key) {
  const e = writesInFlight.get(key);
  if (!e) return false;
  if (!e.done) return true;
  if (Date.now() - e.done < WRITE_SETTLE_MS) return true;
  writesInFlight.delete(key);
  return false;
}

// Which write for a key is the newest. A device that taps twice quickly has two
// merges in the air; the first one to come back carries a board that does not
// know about the second tap, and adopting it would undo that tap on screen. The
// caller checks this before taking the answer.
const writeSeq = new Map();
function nextSeq(key) {
  const n = (writeSeq.get(key) || 0) + 1;
  writeSeq.set(key, n);
  return n;
}

// Send what changed, not the whole board.
//
// This is the difference between a stale device changing one call and a stale
// device replacing the board with its own idea of it. See the comment on
// /api/board/records in server.js: sending the whole list is silently
// destructive the moment two people are using the app, and it is destructive in
// the one way nobody notices, because a smaller board looks exactly like a
// board with less on it.
export async function writeRecords(key, upsert, remove, opts) {
  const res = await fetch(`${API_BASE}/api/board/records`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ key, upsert, remove: remove || [], ...(opts || {}) }),
  });
  if (res.status === 401) {
    noteAuthLost(res.headers.get("x-auth-reason") || "");
    throw Object.assign(new Error(`writeRecords ${key}: signed out`), { httpStatus: 401 });
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 409 && body.shape) return { shape: true };
  if (!res.ok) {
    const err = new Error(`writeRecords ${key} failed: ${res.status}`);
    err.httpStatus = res.status;
    throw err;
  }
  return { value: body.value };
}

// The same protection for a key that is a map rather than a list.
//
// `ems:locations` is written by every truck that is moving, `ems:overtimeSent`
// by every person who sends their hours in, `ems:restockDone` by every crew
// that finishes a call. All three were written whole, which means each of them
// had the same flaw as the board: whoever wrote last replaced everybody else's
// entries with their own idea of them.
//
// Works out what this write actually changes and sends only that. Falls back to
// writing the key whole if the server is old or the key is not a map.
export async function mergeWrite(key, next, prev, opts) {
  const before = prev && typeof prev === "object" && !Array.isArray(prev) ? prev : {};
  const after = next && typeof next === "object" && !Array.isArray(next) ? next : {};
  const upsert = {};
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) upsert[k] = after[k];
  }
  const remove = Object.keys(before).filter((k) => !(k in after));
  if (!Object.keys(upsert).length && !remove.length) return true;
  try {
    const sent = await writeRecords(key, upsert, remove, opts);
    if (!sent.shape) {
      setConnectionOk(true);
      noteSynced();
      return true;
    }
  } catch (e) {
    if (e && e.httpStatus === 401) throw e;
    // Anything else falls through to the whole-key write, which has the retry
    // and the queue behind it.
  }
  return writeKey(key, next);
}

// The write every board change goes through. If it lands, nothing is held. If
// it doesn't, the records that changed are kept on the device and replayed
// later — which is the whole difference between a crew losing a call's times
// underground and not losing them.
//
// Answers `{ ok, value, stale }`. `value` is the board as the server holds it
// after merging, so a caller can adopt it and see what everybody else did in
// the same breath; `stale` says another write for this key started after this
// one, and adopting would undo it.
export async function writeList(key, next, prev, opts) {
  markWriteStarted(key);
  const seq = nextSeq(key);
  try {
    const out = await writeListInner(key, next, prev, opts);
    return { ...out, stale: writeSeq.get(key) !== seq };
  } finally {
    markWriteFinished(key);
  }
}

export async function writeListInner(key, next, prev, opts) {
  const changed = changedRecords(next, prev);
  const gone = removedIds(next, prev);
  const ids = Object.keys(changed);

  // Nothing actually changed. Every save used to post the whole board whether
  // or not anything was different, which is bytes on the wire and one more
  // chance for a stale copy to land on top of a fresh one.
  if (!ids.length && !gone.length) return { ok: true, value: null };

  try {
    const sent = await writeRecords(key, ids.map((id) => changed[id]), gone, opts);
    if (!sent.shape) {
      if (pendingCountFor(key)) {
        clearQueued(key, ids);
        notifyPendingChanged();
      }
      setConnectionOk(true);
      if (lastWriteError) {
        lastWriteError = null;
        notifyPendingChanged();
      }
      noteSynced();
      return { ok: true, value: sent.value };
    }
    // The key does not hold records — an older board, or a key that is one
    // whole thing. Written whole, as it always was.
  } catch (e) {
    if (e && e.httpStatus === 401) throw e;
    if (e && e.httpStatus) {
      lastWriteError = `The server refused to save (${e.httpStatus}). Nothing has been lost — it is held on this device — but it is not reaching the server.`;
      notifyPendingChanged();
      queueRecords(key, changed);
      notifyPendingChanged();
      return { ok: false, value: null };
    }
    // No signal. Fall through to the whole-key path, which has its own retry
    // and its own queueing, rather than giving up here.
  }

  const ok = await writeKey(key, next);
  if (ok) {
    if (pendingCountFor(key)) {
      clearQueued(key, ids);
      notifyPendingChanged();
    }
    noteSynced();
    return { ok: true, value: null };
  }
  if (ids.length) {
    queueRecords(key, changed);
    notifyPendingChanged();
  }
  return { ok: false, value: null };
}