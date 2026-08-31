// ---------- who may put data back onto the board ----------
//
// Taking a copy is safe: it writes nothing anybody works on, so anyone who
// holds the archive area may do it whenever they like. Putting a copy BACK is
// the single most destructive thing this server can be asked to do — it
// rewrites the department's record — and the department decided it belongs to
// one person: the owner account, F1525518. The archive can still be delegated,
// but a delegate restores only inside a window the owner has opened, and the
// window closes on its own.
//
// The policy lives here, apart from the routes, so `npm test` can hold it the
// way it holds the merge and the delegation list. The server is the enforcer;
// a screen that hides a button is not a permission.

// The account restores belong to. The same ID the bootstrap code is printed
// for on a fresh database — the one account that always exists.
const RESTORE_OWNER = process.env.RESTORE_OWNER || "F1525518";

// Long enough to compare a few copies and put keys back without re-asking,
// short enough that "I allowed it this morning" cannot still be live tonight.
const RESTORE_APPROVAL_TTL_MS = 30 * 60 * 1000;

// Only the owner may open the window — a real administrator session on the
// owner's own account, never a delegate acting as one.
function mayOpenRestoreWindow(user) {
  return !!(user && user.fullAdmin && user.id === RESTORE_OWNER);
}

// May this session put data back right now? The owner always; anyone else
// only while an approval is live. The approval is checked against the clock
// on every request, so an expired window refuses without needing a sweeper.
function mayRestore(user, approval, now) {
  if (mayOpenRestoreWindow(user)) return true;
  return !!(user && approval && Number(approval.expiresAt) > now);
}

// ---------- the owner account cannot be taken over ----------
//
// The powers above anchor to ONE account, which makes that account the prize:
// any administrator who could delete it, demote it, or clear its password and
// pocket the sign-in code would either destroy the restore authority or simply
// BECOME the owner — and with it hold the reset that erases the board and
// every backup. Found in the field: a regular admin was offered "Remove" on
// the owner's roster row.
//
// So the owner account answers only to itself. Nobody deletes it, nobody
// demotes it (the owner included — an owner that is not an administrator
// cannot open the restore window, which is the lockout this rule prevents),
// and only the owner edits it or clears its password. A forgotten owner
// password is recovered through the server, not through another admin: set
// OWNER_RESCUE=1 in the environment and restart, and a fresh sign-in code is
// printed to the server log — reaching that log takes the hosting dashboard,
// which only the service operator holds.
//
// Answers the sentence to refuse with, or null for "allowed".
function ownerAccountRefusal(actorId, targetId, action, owner = RESTORE_OWNER) {
  if (String(targetId || "").trim().toUpperCase() !== owner) return null;
  if (action === "delete") {
    return `${owner} anchors restores, resets and backups, and cannot be removed.`;
  }
  if (action === "demote") {
    return `${owner} must stay an administrator — restores and resets answer to that account.`;
  }
  if (String(actorId || "").trim().toUpperCase() !== owner) {
    return `Only ${owner} can change the ${owner} account.`;
  }
  return null;
}

module.exports = {
  RESTORE_OWNER,
  RESTORE_APPROVAL_TTL_MS,
  mayOpenRestoreWindow,
  mayRestore,
  ownerAccountRefusal,
};
