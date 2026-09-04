"use strict";

// ---------- a filed record is closed, on the SERVER too ----------
//
// The server's copy of the rule in `src/domain/record-lock.jsx`, because the
// server is what enforces it. `npm test` asserts the two answer identically on
// the same records, exactly as it does for the delegation list — a rule with
// two implementations that can disagree is worse than one with a hole in it.
//
// The app's half removes the buttons. That stops every real path, because
// `CompletedCalls` is the only edit surface a finished call has — but a screen
// that hides a button is not a permission, and the whole point of the rule is
// that the record can be trusted by somebody who was not in the room. So the
// board itself refuses the write.

// Deliberately the SAME list, in the same order, as LOG_COMPLETENESS in
// `src/domain/sheet-gaps.jsx`. Add a column there and add it here.
const CALL_TYPE_KEYS = ["A", "B", "C", "D", "E", "NA"];
const LOADED_KM_KEYS = ["1", "2", "3", "4", "5", "NA"];

const said = (v) => !!(v && String(v).trim());

const COMPLETENESS = [
  { key: "patientOrigin", has: (r) => !!r.patientOrigin },
  { key: "locationTo", has: (r) => said(r.locationTo) },
  { key: "mrn", has: (r) => said(r.mrn) },
  { key: "callType", has: (r) => CALL_TYPE_KEYS.indexOf(r.callType) >= 0 },
  { key: "callCategory", has: (r) => !!r.callCategory },
  { key: "loadedKm", has: (r) => LOADED_KM_KEYS.indexOf(r.loadedKm) >= 0 },
  { key: "emergencyCode", has: (r) => !!r.emergencyCode },
  { key: "addedService", has: (r) => said(r.addedService) },
  {
    key: "receiver",
    // Only asked of a call where somebody was actually handed over.
    applies: (r) => !r.noTransport && !!((r.times || {}).arrivalDestination),
    has: (r) => !!(r.receiver && r.receiver.name),
  },
];

function missingLogFieldKeys(req) {
  if (!req || req.status !== "completed") return [];
  return COMPLETENESS
    .filter((f) => (!f.applies || f.applies(req)) && !f.has(req))
    .map((f) => f.key);
}

// A completed call, inside a submitted log, whose shift window has ended, with
// nothing left missing. `filed` is what `filedCallIndex` holds for this id:
// `{ windowEnd }`, or null when no submitted log covers it.
function callIsLocked(req, filed, now) {
  if (!req || req.status !== "completed") return false;
  if (!filed) return false;
  if (filed.windowEnd && now < filed.windowEnd) return false;
  return missingLogFieldKeys(req).length === 0;
}

// What a locked record may still take.
//
// Escalations are a crew RAISING a problem about a call — a report attached to
// the record, not a change to it — and the whole reason somebody looks at a
// filed call is often that something about it went wrong. Refusing those would
// close the one channel the lock exists to protect. Everything else on a locked
// record is frozen, including the edit history: a filed record's history is the
// evidence the lock is worth having, so it may not be rewritten either.
const LOCKED_RECORD_MAY_CHANGE = ["escalations"];

function sameJson(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

// Does this incoming record change anything on a locked one that it may not?
// Named fields, both directions, so adding a key is a change too.
function lockedRecordChange(stored, incoming) {
  const keys = new Set(Object.keys(stored || {}).concat(Object.keys(incoming || {})));
  for (const k of keys) {
    if (LOCKED_RECORD_MAY_CHANGE.indexOf(k) >= 0) continue;
    if (!sameJson(stored[k], incoming[k])) return k;
  }
  return null;
}

// The whole guard, over one merge: hand back the records that may be written
// and the refusals to file as findings.
//
// The stored record wins outright — the incoming one is discarded, not merged
// field by field. A device sending a change to a filed call is a device on an
// old build or somebody going around the screens, and in both cases the
// answer is the record that was filed.
function holdFiledRecords({ current, incoming, filedIndex, now }) {
  const stored = new Map();
  (Array.isArray(current) ? current : []).forEach((r) => { if (r && r.id) stored.set(r.id, r); });
  const kept = [];
  const refused = [];
  (Array.isArray(incoming) ? incoming : []).forEach((r) => {
    if (!r || !r.id) return kept.push(r);
    const was = stored.get(r.id);
    if (!was || !callIsLocked(was, filedIndex.get(r.id) || null, now)) return kept.push(r);
    const field = lockedRecordChange(was, r);
    if (!field) return kept.push(r);
    // Keep whatever the locked record already said, plus anything the record
    // is still allowed to take (an escalation raised in the same write).
    const held = { ...was };
    LOCKED_RECORD_MAY_CHANGE.forEach((k) => { if (k in r) held[k] = r[k]; });
    kept.push(held);
    refused.push({ id: r.id, field });
  });
  return { records: kept, refused };
}

module.exports = {
  COMPLETENESS,
  LOCKED_RECORD_MAY_CHANGE,
  missingLogFieldKeys,
  callIsLocked,
  lockedRecordChange,
  holdFiledRecords,
};
