// ---------- when a board write should wake a phone ----------
//
// A locked Android phone freezes the WebView, the poll stops, and the board
// cannot tell it anything - the one case the alarm plugin cannot cover. The
// server CAN: it sees every write, so it can see the moment a call lands on a
// truck and send a push at that instant.
//
// This is the decision alone - given the requests list before and after a
// write, which trucks have just been HANDED a call - kept pure and apart from
// the sending so `npm test` holds it. The rules:
//
//  - a truck is woken when a call it did not have becomes assigned to it:
//    a fresh dispatch, or a call moved over from another truck;
//  - re-saving a call already assigned to the same truck wakes nobody - the
//    board is written on every small change, and a phone buzzed sixty times
//    per call is a phone whose owner turns notifications off;
//  - a completed call wakes nobody, whatever else changed on it.
function newAssignments(prevList, nextList) {
  const prev = new Map();
  (Array.isArray(prevList) ? prevList : []).forEach((r) => {
    if (r && r.id) prev.set(String(r.id), r);
  });
  const out = [];
  (Array.isArray(nextList) ? nextList : []).forEach((r) => {
    if (!r || !r.id || !r.assignedUnitId) return;
    if (r.status === "completed") return;
    const was = prev.get(String(r.id));
    if (was && String(was.assignedUnitId || "") === String(r.assignedUnitId)) return;
    out.push({
      unitId: String(r.assignedUnitId),
      requestId: String(r.id),
      priority: String(r.priority || ""),
    });
  });
  return out;
}

// ---------- and again, until somebody answers ----------
//
// A push is ONE banner and ONE tone. It does not repeat, on either platform,
// and a crew asleep at 03:00 or in a noisy bay can miss a single buzz — which
// is the whole failure this feature exists to prevent. The alarm plugin's
// 1.7-second loop only starts once the app is open, and the app is not open:
// that is why a push was needed in the first place.
//
// So the SERVER repeats it, and the rule for when to stop is here, pure and
// under `npm test`:
//
//  - the crew acknowledged it — that is the answer we were waiting for;
//  - the call was completed or cancelled off the board;
//  - it moved to another truck, or off this one;
//  - it fell off the board entirely;
//  - or we have asked enough times. A phone buzzing for ever in a locker
//    helps nobody, and past a couple of minutes the desk should be picking
//    up a telephone rather than trusting a notification.
function callStillNeedsWaking(req, unitId, attempts, max) {
  if (typeof max === "number" && attempts >= max) return false;
  if (!req) return false;
  if (req.status === "completed") return false;
  if (req.acknowledged) return false;
  if (String(req.assignedUnitId || "") !== String(unitId)) return false;
  return true;
}

// A handover ASK lands on the HOLDER's phone. Given the units list before and
// after a write, which seats have just been asked for — the same discipline
// as newAssignments: re-saving an ask already pending wakes nobody, a
// still-out relief (no answer needed) is not an ask, and an answered one is
// over.
function newHandoverAsks(prevUnits, nextUnits) {
  const prev = new Map();
  (Array.isArray(prevUnits) ? prevUnits : []).forEach((u) => {
    if (u && u.id) prev.set(String(u.id), u);
  });
  const pending = (r) => !!(r && r.accountId && r.needsApproval && (!r.status || r.status === "pending"));
  const out = [];
  (Array.isArray(nextUnits) ? nextUnits : []).forEach((u) => {
    if (!u || !u.id || !u.relief) return;
    for (const slot of ["alpha", "bravo"]) {
      const r = u.relief[slot];
      if (!pending(r)) continue;
      const holder = u[slot];
      if (!holder || !holder.accountId) continue;
      const was = prev.get(String(u.id));
      const wr = was && was.relief ? was.relief[slot] : null;
      if (pending(wr) && String(wr.accountId) === String(r.accountId)) continue;
      out.push({
        unitId: String(u.id),
        unitName: String(u.name || ""),
        slot,
        holderAccountId: String(holder.accountId),
        askerName: String(r.name || r.accountId),
      });
    }
  });
  return out;
}

module.exports = { newAssignments, newHandoverAsks,
  callStillNeedsWaking,
};
