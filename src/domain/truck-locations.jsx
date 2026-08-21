import { liveRequestFor } from "./in-service.jsx";
import { stationOf } from "./live-sheet.jsx";
import { readKey, writeKey } from "../lib/offline-queue.jsx";

// A crew raising a problem on a call. This one only ever goes to an admin
// board, and it does not require interaction: an issue is not an emergency and
// must not sit on the screen the way an unanswered assistance request does.
// The body carries the medic and the call, never the text of the issue —
// notifications are read off a lock screen in a corridor.
// ---------- where the trucks are ----------
//
// Deliberately small in scope, because scope is what turns a dispatch tool into
// surveillance.
//
// WHEN. Only while a truck is out on a call. Tracking starts when the crew are
// dispatched and stops the moment they go back in service — the same two events
// the whole board already turns on. Off a call, nobody is located.
//
// WHAT IS KEPT. The latest position per truck, and nothing else. Each update
// overwrites the one before it and the whole entry is deleted at back in
// service, so there is no route, no history, and nothing to leak: a trail of
// where named staff were at 03:40 last Tuesday is a different product from a
// board showing where the trucks are now, and no screen in this app wants it.
// It is also the difference between a few hundred bytes on every board write
// and a few hundred thousand records.
//
// FOREGROUND ONLY. The browser stops giving positions when the app is not on
// screen, and that is left exactly as it is — no background location, no
// wake locks, nothing that would need Google's Location Permissions
// declaration. A tablet that has been locked simply stops updating, and the
// desk is told how long ago the last fix was rather than shown a stale dot
// pretending to be live.
//
// WHOSE. The Alpha seat's device. One truck, one position; two phones in one
// vehicle reporting slightly different corners of a car park is noise.
export const LOCATION_KEY = "ems:locations";
export const TRACKING_CONSENT_KEY = "ems:trackingConsent";
// One fix a minute. An ambulance at speed covers about a kilometre in that
// time, which is the right grain for "where is my truck" and a fraction of the
// battery of a continuous watch.
export const LOCATION_INTERVAL_MS = 60 * 1000;
// Past this, the dot is a guess. The desk is told rather than left to assume.
export const LOCATION_STALE_MS = 3 * 60 * 1000;

export function consentFor(consents, accountId) {
  if (!accountId) return null;
  return (consents || {})[String(accountId).toUpperCase()] || null;
}

// Granted once and never asked again; refused and asked again on the next call,
// which is what the department chose. A refusal takes effect the moment it is
// made — the administrator's acknowledgement is a record, not a gate. Consent
// that can be overruled by a supervisor is not consent, and an app that keeps
// locating somebody who said no is the thing this feature must never become.
export function mayTrack(consents, accountId) {
  const c = consentFor(consents, accountId);
  return !!(c && c.status === "granted");
}

export function needsConsentPrompt(consents, accountId) {
  if (!accountId) return false;
  const c = consentFor(consents, accountId);
  if (!c) return true;
  return c.status === "refused";
}

export async function recordConsent({ accountId, name, status, reason }) {
  if (!accountId) return null;
  const key = String(accountId).toUpperCase();
  const existing = (await readKey(TRACKING_CONSENT_KEY, {})) || {};
  const next = {
    ...existing,
    [key]: {
      accountId,
      name: name || "",
      status,
      reason: reason || "",
      ts: Date.now(),
      // Cleared on every fresh answer: an acknowledgement belongs to the
      // refusal it was given for, not to the person.
      ackedBy: null,
      ackedAt: null,
    },
  };
  // These stores are keyed maps rather than lists of records, so they cannot
  // ride the offline queue — that works on records with ids. What they can do
  // is stop pretending. The caller is told whether it landed and says so.
  const ok = await writeKey(TRACKING_CONSENT_KEY, next);
  return ok ? next : null;
}

export async function writePosition({ unit, coords, byName, accountId, requestId }) {
  if (!unit || !coords) return null;
  const existing = (await readKey(LOCATION_KEY, {})) || {};
  const next = {
    ...existing,
    [unit.id]: {
      unitId: unit.id,
      unitName: unit.name || "",
      station: stationOf(unit),
      lat: coords.latitude,
      lng: coords.longitude,
      // Metres. Shown to the desk, because a fix good to half a kilometre
      // should not be read as a street address.
      accuracy: typeof coords.accuracy === "number" ? Math.round(coords.accuracy) : null,
      heading: typeof coords.heading === "number" && !Number.isNaN(coords.heading) ? coords.heading : null,
      speed: typeof coords.speed === "number" && !Number.isNaN(coords.speed) ? coords.speed : null,
      ts: Date.now(),
      byName: byName || "",
      accountId: accountId || null,
      requestId: requestId || null,
    },
  };
  await writeKey(LOCATION_KEY, next);
  return next;
}

// Back in service. The entry is removed rather than marked finished — there is
// nothing to keep.
export async function clearPosition(unitId) {
  if (!unitId) return null;
  const existing = (await readKey(LOCATION_KEY, {})) || {};
  if (!existing[unitId]) return existing;
  const next = { ...existing };
  delete next[unitId];
  await writeKey(LOCATION_KEY, next);
  return next;
}

export function positionAgeMs(fix, now) {
  return fix && fix.ts ? Math.max(0, (now || Date.now()) - fix.ts) : null;
}

// Nothing outlives the call it belongs to.
//
// Deleting the fix at back in service is done by the crew's own device, and a
// device is exactly the thing that cannot be relied on to do it: a tablet whose
// battery goes flat mid-call, a browser closed at the destination, a crew who
// sign off without stamping. Any of those leaves a position sitting in the
// store — written into the database, surviving deploys, quietly becoming the
// history this feature was designed not to keep.
//
// So the deletion does not depend on the device that made it. Every open board
// checks on each poll and drops anything that should not be there: a truck that
// no longer exists, a truck that is not on a call, or a fix old enough that
// whatever was sending it has plainly stopped. Whoever is looking at the board
// does the tidying, so it happens whether or not the crew's tablet ever comes
// back.
export const LOCATION_MAX_AGE_MS = 15 * 60 * 1000;

export function pruneLocations(locations, units, requests, now) {
  const kept = {};
  let dropped = 0;
  Object.keys(locations || {}).forEach((unitId) => {
    const fix = locations[unitId];
    const unit = (units || []).find((u) => u.id === unitId);
    const onCall = unit ? !!liveRequestFor(unit, requests) : false;
    const age = positionAgeMs(fix, now);
    const stale = age === null || age > LOCATION_MAX_AGE_MS;
    if (!unit || !onCall || stale) {
      dropped += 1;
      return;
    }
    kept[unitId] = fix;
  });
  return { kept, dropped };
}