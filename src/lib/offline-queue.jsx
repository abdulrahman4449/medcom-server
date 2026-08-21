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

export async function readKeyRaw(key) {
  try {
    const res = await fetch(`${API_BASE}/api/board?key=${encodeURIComponent(key)}`, {
      headers: authHeaders(),
    });
    // A token that has expired, or an account that has been removed. Not a
    // lost signal: holding the records and laying them over the server's copy
    // would show a board that looks right and is saving nothing.
    if (res.status === 401) {
      noteAuthLost();
      setConnectionOk(true);
      return null;
    }
    // Refused, not unreachable. The account list in particular is no longer
    // served through the board — it is credential material and now sits behind
    // its own administrator-only endpoint. A refusal means "nothing here for
    // you", not "no signal", and one forbidden key must not make a working
    // board look offline.
    if (res.status === 403) {
      setConnectionOk(true);
      return null;
    }
    if (!res.ok) throw new Error(`readKey ${key} failed: ${res.status}`);
    const { value } = await res.json();
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
    const res = await fetch(`${API_BASE}/api/board?key=${encodeURIComponent(key)}`, {
      headers: authHeaders(),
    });
    // A token that has expired, or an account that has been removed. Not a
    // lost signal: holding the records and laying them over the server's copy
    // would show a board that looks right and is saving nothing.
    if (res.status === 401) {
      noteAuthLost();
      setConnectionOk(true);
      return fallback;
    }
    // Refused, not unreachable. The account list in particular is no longer
    // served through the board — it is credential material and now sits behind
    // its own administrator-only endpoint. A refusal means "nothing here for
    // you", not "no signal", and one forbidden key must not make a working
    // board look offline.
    if (res.status === 403) {
      setConnectionOk(true);
      return null;
    }
    if (!res.ok) throw new Error(`readKey ${key} failed: ${res.status}`);
    const { value } = await res.json();
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
        noteAuthLost();
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

// The write every board change goes through. If it lands, nothing is held. If
// it doesn't, the records that changed are kept on the device and replayed
// later — which is the whole difference between a crew losing a call's times
// underground and not losing them.
export async function writeList(key, next, prev) {
  markWriteStarted(key);
  try {
    return await writeListInner(key, next, prev);
  } finally {
    markWriteFinished(key);
  }
}

export async function writeListInner(key, next, prev) {
  const ok = await writeKey(key, next);
  if (ok) {
    // Anything we were holding for these records has now gone up with this
    // write, so it is no longer outstanding.
    const ids = (next || []).filter((x) => x && x.id).map((x) => x.id);
    if (pendingCountFor(key)) {
      clearQueued(key, ids);
      notifyPendingChanged();
    }
    return true;
  }
  const changed = changedRecords(next, prev);
  if (Object.keys(changed).length) {
    queueRecords(key, changed);
    notifyPendingChanged();
  }
  return false;
}