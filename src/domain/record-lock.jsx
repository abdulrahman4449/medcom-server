import { missingLogFields } from "./sheet-gaps.jsx";

// ---------- a filed record is closed ----------
//
// The department's rule, in the owner's words: once a call has all its
// information, its shift has ended and that shift's log has been submitted,
// NOBODY changes a detail of it. That is the whole clinical-governance claim
// this app makes about its record — a filed sheet that can still be edited is
// not a record, it is a draft with a date on it.
//
// It was not enforced anywhere. A call run and closed at 09:07 was still
// carrying "Correct call details" and "Change call type / km" at half past ten
// that night, from an administrator's own board, with the day shift long filed;
// and because a finalised submission re-cuts its snapshot from the LIVE record,
// an edit made then genuinely rewrites the sheet that was already handed in.
//
// Three conditions, all of them the owner's, and each doing real work:
//
//   completed        — a call still running is being worked, not recorded.
//   its log is filed — a station whose desk has not submitted is still writing
//                      that shift up. Nothing about it is settled yet.
//   the shift ENDED  — a desk may submit early (the amend pass exists because
//                      one submitted at 16:00), and the rest of that window is
//                      still theirs to work.
//   nothing missing  — and this is the one that keeps the record usable. The
//                      System page lists completed calls short of sheet data
//                      with a button to go and fix each one; locking those
//                      would point somebody at 21 calls nobody is allowed to
//                      finish. A short record stays open until it is complete,
//                      and completing it is what closes it.
//
// There is deliberately NO override, for anybody, the owner included. That is
// the department's decision and the reason the record can be trusted; the cost
// is that a wrong value entered on the last missing field is wrong for good.

// Every call any submitted log covers, with the stamp of the log that took it.
//
// Built once per render rather than searched per call: a mature board holds
// hundreds of submissions of tens of calls each, and asking "is this one filed"
// by scanning all of them, for every card in a list, is the shape of a screen
// that stops scrolling.
export function filedCallIndex(submissions) {
  const out = new Map();
  (submissions || []).forEach((s) => {
    if (!s || !Array.isArray(s.requestIds)) return;
    const stamp = {
      id: s.id,
      shiftLabel: s.shiftLabel || "",
      dayLabel: s.dayLabel || "",
      station: s.station || "",
      submittedAt: s.submittedAt || 0,
      submittedBy: s.submittedBy || "",
      windowEnd: s.windowEnd || 0,
      status: s.status || "",
    };
    // The first submission that names a call owns it. A call can only be
    // raised inside one shift window, so a second is a re-file rather than a
    // second home.
    s.requestIds.forEach((rid) => { if (!out.has(rid)) out.set(rid, stamp); });
  });
  return out;
}

export function callRecordLock(req, filedIndex, now = Date.now()) {
  if (!req || req.status !== "completed") return { locked: false, why: "live", filed: null, missing: [] };
  const filed = filedIndex && typeof filedIndex.get === "function" ? filedIndex.get(req.id) : null;
  if (!filed) return { locked: false, why: "not-filed", filed: null, missing: [] };
  if (filed.windowEnd && now < filed.windowEnd) {
    return { locked: false, why: "shift-running", filed, missing: missingLogFields(req) };
  }
  const missing = missingLogFields(req);
  if (missing.length) return { locked: false, why: "incomplete", filed, missing };
  return { locked: true, why: "filed", filed, missing: [] };
}

// What the card says instead of the buttons it is no longer offering.
//
// A control that vanishes with no explanation reads as a broken screen, and the
// desk's next move is to report it — which is exactly what a governance rule
// must not feel like. So the card names the log this record went onto and the
// day it was filed.
export function recordLockNote(lock) {
  if (!lock || !lock.locked) return "";
  const f = lock.filed || {};
  const where = [f.shiftLabel, f.dayLabel].filter(Boolean).join(" · ");
  return where
    ? `FILED — this record is on the ${where} log and cannot be changed.`
    : "FILED — this record has been submitted and cannot be changed.";
}

// And the warning on a record that is still open only because it is short.
// Somebody is about to close it for ever without being told so.
export function recordClosingNote(lock) {
  if (!lock || lock.locked || lock.why !== "incomplete") return "";
  const n = lock.missing.length;
  return `Its log is filed — once the last ${n === 1 ? "detail is" : `${n} details are`} in, this record closes and cannot be changed.`;
}
