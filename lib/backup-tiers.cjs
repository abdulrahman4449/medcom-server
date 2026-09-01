// The two backup tiers, as decisions.
//
// The permanent tier is the daily ladder in BACKUP_DIR. The temporary tier is
// a copy every thirty minutes into BACKUP_DIR/temp, so a midday disaster
// costs half an hour instead of a day. Temps are a safety net for the day
// that is still running: once a daily copy has been WRITTEN AND VERIFIED,
// everything the temps hold is inside it, and deleting them loses nothing.
// A daily that fails verification deletes nothing — the temps it would have
// covered are exactly the copies that day still needs.
//
// The mechanics (db.backup, unlink) stay in server.js; everything here is a
// pure decision over names and times, so `npm test` can hold the rules still.

const TEMP_EVERY_MS = 30 * 60 * 1000;

// Three days of temps. The cap only matters while dailies are failing — a
// healthy morning clears the folder — so reaching it is itself a finding.
const TEMP_CAP = 144;

// Temp copies wear their own prefix, not `board-`. Everything that lists,
// serves, restores or sweeps backups matches on `board-`, so a temp can never
// appear in the restore picker, the download route or sync-all — even if one
// were misplaced into the main folder.
function tempName(at) {
  const d = new Date(at);
  const p2 = (n) => String(n).padStart(2, "0");
  return (
    `temp-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
    `-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.db`
  );
}

function isTempName(name) {
  return /^temp-\d{8}-\d{6}(-\d+)?\.db$/.test(String(name || ""));
}

// Which temps a verified daily has made redundant: only those taken at or
// before the moment the daily snapshot began. A temp taken AFTER the daily
// holds newer work than it and stays.
function tempsToClear(temps, verifiedAt) {
  const cut = Number(verifiedAt);
  if (!Number.isFinite(cut)) return [];
  return (temps || [])
    .filter((t) => Number(t.at) <= cut)
    .map((t) => t.name);
}

// The overflow beyond the cap, oldest first — the newest copies are the ones
// a disaster needs, so age is what goes.
function tempsOverCap(temps, cap = TEMP_CAP) {
  const list = [...(temps || [])].sort((a, b) => Number(a.at) - Number(b.at));
  const excess = list.length - cap;
  return excess > 0 ? list.slice(0, excess).map((t) => t.name) : [];
}

// Which backup runs may clear the temp tier. The safety copies taken
// immediately before a restore or a sync precede a rewrite of the board —
// the temps alongside them are the record of the board being overwritten,
// and must outlive the operation they guard.
function backupClearsTemps(reason) {
  return !/^before a /.test(String(reason || ""));
}

// The permanent tier keeps EVERY daily copy for the whole window — no weekly
// thinning. Returns the names to delete: only copies older than keepDays.
function backupsBeyondDays(backups, keepDays, now) {
  const cut = Number(now) - Number(keepDays) * 24 * 60 * 60 * 1000;
  return (backups || [])
    .filter((b) => Number(b.at) < cut)
    .map((b) => b.name);
}

// When the next daily is due: the operational day closes at 07:00, so the
// daily copy runs just after that boundary and always holds a complete,
// closed day. The hour is given in UTC (07:00 Riyadh = 04:00 UTC).
function nextDailyAt(now, hourUtc) {
  const d = new Date(Number(now));
  const due = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(hourUtc), 5, 0);
  return Number(now) < due ? due : due + 24 * 60 * 60 * 1000;
}

module.exports = {
  TEMP_EVERY_MS,
  TEMP_CAP,
  tempName,
  isTempName,
  tempsToClear,
  tempsOverCap,
  backupClearsTemps,
  backupsBeyondDays,
  nextDailyAt,
};
