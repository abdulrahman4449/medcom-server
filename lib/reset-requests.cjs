// ---------- a settled password request stays settled ----------
//
// A password-help request is CREATED by exactly one thing: the tokenless
// /api/auth/forgot route, where the dedupe lives. Board writes may settle a
// request (an administrator clearing or dismissing it) — they must never
// create one, and never flip a settled one back to waiting.
//
// This exists because a phone running an old build did exactly that, on a
// loop. The old sign-in screen wrote the ask to the BOARD, was answered 401
// (nobody is signed in at the sign-in screen), and queued the write on the
// device. Every later sign-in on that phone replayed the held record — and a
// held record wins the merge, so the administrator's Dismiss was overwritten
// back to "pending" within minutes, every time, from a device nobody could
// see. Dismiss at 20:17, back at 20:28: not a person asking again, a ghost.
//
// So the server holds the line for this one key, whatever writes: a row
// arriving as pending/open is kept only if the server already holds that row
// still waiting. Anything else — a pending row the server has never seen, or
// one the server holds as cleared/declined — keeps the server's own truth.
// The cost is accepted and small: an ask from a not-yet-updated shell no
// longer lands (its build predates the route), and the fix for that shell is
// the rebuild it needs anyway.
const WAITING = new Set(["pending", "open"]);

function isWaiting(r) {
  return !!(r && WAITING.has(r.status));
}

function settledResetsHold(current, next) {
  const held = new Map((current || []).filter((r) => r && r.id).map((r) => [r.id, r]));
  const out = [];
  for (const r of next || []) {
    if (!r || !r.id) continue;
    if (isWaiting(r)) {
      const was = held.get(r.id);
      // A waiting row the server never issued: a ghost, or a board-write
      // creation from an old build. Either way, not a request.
      if (!was) continue;
      // A waiting row the server holds as settled: the decision stands.
      if (!isWaiting(was)) {
        out.push(was);
        continue;
      }
    }
    out.push(r);
  }
  return out;
}

// How many rows the hold above would refuse or revert — the number the
// System page reports, because a guard that fires silently is the lesson
// this file exists to record: the server must SAY when it corrected a write.
function resetReplayCount(current, next) {
  const kept = settledResetsHold(current, next);
  const byId = new Map(kept.map((r) => [r.id, r]));
  let n = 0;
  for (const r of next || []) {
    if (!r || !r.id || !isWaiting(r)) continue;
    const out = byId.get(r.id);
    if (!out || out.status !== r.status) n += 1;
  }
  return n;
}

module.exports = { settledResetsHold, resetReplayCount };
