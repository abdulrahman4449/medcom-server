// PulseOps — self-hosted server.
//
// Replaces Netlify Functions + Netlify DB with a plain Node.js server and a
// single SQLite file. Same job as before (serve the app, and read/write the
// "board" key/value store the app talks to), no vendor platform required —
// this runs anywhere Node runs.

const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const express = require("express");
const Database = require("better-sqlite3");

const PORT = process.env.PORT || 3000;

// Where the board actually lives, which is the single most consequential line
// in this file.
//
// Hosts like Render build a brand new container for every deploy. A database
// file sitting inside the app folder is part of that container and is thrown
// away with it, so the board comes back empty and the admin statistics start
// again from zero — every deploy, silently, with nothing in the logs to say it
// happened. The file has to be on a disk that outlives the container.
//
// Three ways of finding one, in order:
//
//   1. DB_PATH, when it is set. An explicit instruction from whoever runs this,
//      and it wins.
//   2. A mounted persistent disk, if there is one. A disk that has been mounted
//      was mounted for this; using the app folder anyway would quietly ignore
//      it, which is how the setting gets half-done and nobody notices.
//   3. The app folder. Right for running this on your own machine, wrong for
//      anything else — so in that case the server says so, loudly, rather than
//      starting up looking healthy.
const PERSISTENT_MOUNTS = ["/data", "/var/data"];

function isWritableDir(dir) {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch (e) {
    return false;
  }
}

function resolveDbPath() {
  if (process.env.DB_PATH) {
    return { file: process.env.DB_PATH, source: "the DB_PATH environment variable" };
  }
  const mount = PERSISTENT_MOUNTS.find(isWritableDir);
  if (mount) {
    return { file: path.join(mount, "board.db"), source: `the persistent disk mounted at ${mount}` };
  }
  return { file: path.join(__dirname, "data", "board.db"), source: "the app folder (no persistent disk found)" };
}

const resolved = resolveDbPath();
const DB_PATH = resolved.file;
const DB_SOURCE = resolved.source;
// A file inside the app folder goes wherever the app folder goes — which on a
// deploy platform is into the bin. Anywhere else is somewhere the operator
// pointed us on purpose.
const DB_IS_PERSISTENT = !path.resolve(DB_PATH).startsWith(path.resolve(__dirname) + path.sep);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS board (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// ---------- who is allowed in ----------
//
// There was no authentication at all. Anyone who knew the address could read
// the whole board - every call, every patient MRN, every account - and write to
// it. The login screen checked the password on the phone, against a list the
// phone had just downloaded, which is a lock on the door of a house with no
// walls.
//
// Accounts now live in their own table rather than in the board, so the list
// and its password hashes are never something a client can fetch. A password
// is checked here, a signed token is issued, and every board request has to
// carry one.
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'crew',
    team TEXT,
    slot TEXT,
    station TEXT,
    pw_salt TEXT,
    pw_hash TEXT,
    -- The old unsalted SHA-256, kept only so an existing password still works
    -- once. It is replaced with a proper hash the first time they sign in.
    legacy_hash TEXT,
    -- A one-time code, salted and hashed like a password, that an account with
    -- no password yet must be claimed with. Without it, anyone who could guess
    -- an employee ID could claim an account that had never been signed into and
    -- become that person — and employee IDs are printed on badges.
    claim_salt TEXT,
    claim_hash TEXT,
    claim_expires INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// The key tokens are signed with. Taken from the environment when an operator
// has set one; otherwise generated once and kept, so tokens survive a restart
// without anybody having to configure anything. It lives in its own table, not
// in the board, so it is not one API call away.
function authSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'auth_secret'").get();
  if (row) return row.value;
  const made = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO settings (key, value) VALUES ('auth_secret', ?)").run(made);
  return made;
}

// scrypt: deliberately slow, and salted per account. The old hashes were plain
// SHA-256 with no salt, which a commodity graphics card runs through in bulk.
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString("hex");
}
// Boards created before claim codes existed do not have the columns. Added
// here rather than in the CREATE above, which only runs on an empty database.
for (const col of [
  "claim_salt TEXT", "claim_hash TEXT", "claim_expires INTEGER",
  // Delegated authority: an administrator lending part of their own standing to
  // somebody who does not have it. Kept on the account rather than on the board
  // because it is a permission, and permissions are checked here.
  "delegated_role TEXT", "delegated_until INTEGER", "delegated_by TEXT", "delegated_at INTEGER",
  // The areas, one at a time, instead of a whole job. `delegated_role` is kept
  // so a delegation made by an older build still means something on the first
  // read after this one — see `liveDelegation`.
  "delegated_scopes TEXT",
]) {
  try {
    db.prepare(`ALTER TABLE accounts ADD COLUMN ${col}`).run();
  } catch (e) {
    // already there
  }
}

// The code itself: short enough to read down a phone, long enough not to be
// guessed inside the rate limit. No vowels, so it cannot spell anything, and no
// characters that are read as each other on a badge printer - 0/O and 1/I/L.
const CLAIM_ALPHABET = "23456789BCDFGHJKMNPQRSTVWXYZ";
const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function makeClaimCode() {
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += CLAIM_ALPHABET[bytes[i] % CLAIM_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}
function issueClaimCode(id) {
  const code = makeClaimCode();
  const salt = crypto.randomBytes(16).toString("hex");
  db.prepare(
    "UPDATE accounts SET claim_salt = ?, claim_hash = ?, claim_expires = ? WHERE id = ?"
  ).run(salt, hashPassword(code, salt), Date.now() + CLAIM_TTL_MS, id);
  return code;
}
function checkClaimCode(account, code) {
  if (!account.claim_hash || !account.claim_salt) return false;
  if (account.claim_expires && Date.now() > account.claim_expires) return false;
  const given = Buffer.from(hashPassword(String(code || "").trim().toUpperCase(), account.claim_salt), "hex");
  const held = Buffer.from(account.claim_hash, "hex");
  return given.length === held.length && crypto.timingSafeEqual(given, held);
}
function clearClaimCode(id) {
  db.prepare(
    "UPDATE accounts SET claim_salt = NULL, claim_hash = NULL, claim_expires = NULL WHERE id = ?"
  ).run(id);
}

function setPassword(id, password) {
  const salt = crypto.randomBytes(16).toString("hex");
  db.prepare("UPDATE accounts SET pw_salt = ?, pw_hash = ?, legacy_hash = NULL WHERE id = ?")
    .run(salt, hashPassword(password, salt), id);
}
function checkPassword(account, password) {
  if (account.pw_hash && account.pw_salt) {
    const given = Buffer.from(hashPassword(password, account.pw_salt), "hex");
    const held = Buffer.from(account.pw_hash, "hex");
    return given.length === held.length && crypto.timingSafeEqual(given, held);
  }
  if (account.legacy_hash) {
    // The app's old client-side hash, so nobody is locked out by the change.
    const given = crypto.createHash("sha256").update(String(password)).digest("hex");
    if (given === account.legacy_hash) {
      setPassword(account.id, password); // upgraded in place, once
      return true;
    }
  }
  return false;
}

const TOKEN_TTL_MS = 16 * 60 * 60 * 1000; // longer than the longest shift
const b64 = (buf) => Buffer.from(buf).toString("base64url");

function issueToken(account, actingRole) {
  const payload = b64(JSON.stringify({
    id: account.id,
    role: account.role,
    // Which of the roles they hold they are working as. Recorded, never
    // trusted: `requireAuth` checks it against the live account every time.
    act: actingRole || account.role,
    exp: Date.now() + TOKEN_TTL_MS,
  }));
  const sig = b64(crypto.createHmac("sha256", authSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

function readToken(token) {
  try {
    const [payload, sig] = String(token || "").split(".");
    if (!payload || !sig) return null;
    const want = b64(crypto.createHmac("sha256", authSecret()).update(payload).digest());
    const a = Buffer.from(sig); const b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!claims || !claims.id || !claims.exp || claims.exp < Date.now()) return null;
    return claims;
  } catch (e) {
    return null;
  }
}

function bearer(req) {
  const h = req.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function requireAuth(req, res, next) {
  const claims = readToken(bearer(req));
  if (!claims) return res.status(401).json({ error: "Sign in again." });
  // A token outlives the account it names if somebody was removed mid-shift.
  const live = db.prepare("SELECT * FROM accounts WHERE id = ?").get(claims.id);
  if (!live) return res.status(401).json({ error: "That account no longer exists." });
  // The role on the token is a request, not a fact. It counts only while the
  // account still allows it — so revoking a delegation, or letting it run out,
  // takes effect on the very next request rather than when the token expires.
  const allowed = allowedRoles(live);
  const acting = claims.act && allowed.includes(claims.act) ? claims.act : live.role;
  const del = liveDelegation(live);
  req.user = {
    id: live.id,
    role: acting,
    ownRole: live.role,
    roles: allowed,
    // A real administrator, as opposed to somebody working an area of the job.
    // Everything that is not delegatable at all hangs off this.
    fullAdmin: live.role === "admin",
    // The areas they hold, and only while they are actually acting on the
    // administrator's side. A crew member who chose to work their own shift
    // does not carry an administrator's reach around with them.
    scopes: acting === "admin" && live.role !== "admin" && del ? del.scopes : [],
  };
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Administrators only." });
    next();
  });
}

// One area of the job. A real administrator holds all of them; a delegate holds
// the ones they were named for and nothing else.
function requireArea(scope) {
  return (req, res, next) =>
    requireAdmin(req, res, () => {
      if (req.user.fullAdmin || (req.user.scopes || []).includes(scope)) return next();
      return res.status(403).json({
        error: "That is not one of the areas you have been given.",
      });
    });
}

// Things a delegate may never do, however much they were lent. Chief among
// them: lending it on, or widening their own. Authority that can extend itself
// is not delegated authority, it is a promotion nobody signed off.
function requireFullAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.fullAdmin) {
      return res.status(403).json({
        error: "Only an administrator in their own right can do that.",
      });
    }
    next();
  });
}

// Guessing costs time. Ten wrong answers for one employee ID and that ID stops
// answering for fifteen minutes, whoever is asking.
const LOGIN_TRIES = new Map();
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
function loginBlocked(id) {
  const rec = LOGIN_TRIES.get(id);
  if (!rec) return false;
  if (Date.now() - rec.first > LOGIN_WINDOW_MS) { LOGIN_TRIES.delete(id); return false; }
  return rec.count >= LOGIN_MAX;
}
function loginFailed(id) {
  const rec = LOGIN_TRIES.get(id);
  if (!rec || Date.now() - rec.first > LOGIN_WINDOW_MS) LOGIN_TRIES.set(id, { first: Date.now(), count: 1 });
  else rec.count++;
}

// Board keys only an administrator may write. These are the department's
// definitions rather than the day's work: change them and every crew's screen
// changes with them.
const ADMIN_ONLY_KEYS = new Set([
  "ems:policies", "ems:checklists", "ems:inventory",
  // Overtime decisions are administration's. Anyone signed in could write this
  // key, which meant anyone signed in could approve their own hours by posting
  // to the board — a screen that hides a button is not a permission. What a
  // crew member may write is ems:overtimeSent: that they are asking for a
  // decision, never what the decision was.
  "ems:overtime",
]);
// Never served or written through the board API, whatever a token says.
const FORBIDDEN_KEYS = new Set(["ems:accounts", "ems:accountsSeeded"]);

// An administrator's own keys, and who may write them.
//
// A real administrator writes all of them. Somebody working one area of the job
// writes only the keys that area is about — the overtime delegate can decide
// overtime and cannot touch the policy shelf. Everybody signed in writes the
// day's work, which is every key not on the list.
function mayWriteKey(user, key) {
  if (!ADMIN_ONLY_KEYS.has(key)) return true;
  if (user.fullAdmin) return true;
  return scopeAllowsKey(user.scopes, key);
}

const app = express();
// The board is sent whole on every write, and a busy day's log alone runs past
// 100 KB — which is express's default body limit. Past that the server answered
// 413 and the app, quite correctly, treated the rejection as being offline: it
// held the records on the device and laid them over the server's copy on read.
// The screen therefore looked right while nothing was actually being saved.
// 25 MB is far more than this board will ever be and leaves no room for that
// failure to come back as the department's history grows.
app.use(express.json({ limit: "25mb" }));

// CORS: the native iOS/Android app calls this from a different origin
// (capacitor://localhost on iOS, http://localhost on Android) than the web
// version does, so the browser asks permission before each request and will
// block anything this does not name.
//
// Authorization has to be on that list. Every board request now carries a
// bearer token, and while it was missing the browser refused the request
// before it left the phone - so both native apps could reach nothing at all
// and reported it, quite reasonably, as having no signal. The web build was
// unaffected: same origin, no permission check.
//
// DELETE likewise, for removing an account, and x-backup-token for the backup
// download. Max-Age so the permission check is not repeated before every
// single call on the three-second poll.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-backup-token");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/board", requireAuth, (req, res) => {
  const key = req.query.key;
  if (!key || typeof key !== "string") {
    return res.status(400).json({ error: "Missing key" });
  }
  // The app reads a 403 as "nothing here for you" rather than as being
  // offline, so a key it must not have does not make a working board look
  // disconnected.
  if (FORBIDDEN_KEYS.has(key)) return res.status(403).json({ error: "Not available through the board." });
  const row = db.prepare("SELECT value FROM board WHERE key = ?").get(key);
  res.json({ value: row ? JSON.parse(row.value) : null });
});

app.post("/api/board", requireAuth, (req, res) => {
  const { key, value } = req.body || {};
  if (typeof key !== "string") {
    return res.status(400).json({ error: "Missing key" });
  }
  if (FORBIDDEN_KEYS.has(key)) return res.status(403).json({ error: "Not available through the board." });
  if (!mayWriteKey(req.user, key)) {
    return res.status(403).json({ error: "Only an administrator can change that." });
  }
  db.prepare(
    `INSERT INTO board (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value ?? null));
  res.json({ ok: true });
});

// ---------- writing records, not the whole board ----------
//
// The board used to be written whole. Close one call and the app sent all sixty
// back, and the server stored exactly that. It works perfectly until two people
// are using it: a phone that has been in a pocket for ten minutes holds a
// ten-minute-old board, and the first thing its crew taps sends that old board
// up and erases everything raised in between. No error, no retry, nothing to
// notice — the board is simply smaller than it was.
//
// So a write says what CHANGED. "Call r17 is now completed", not "here are all
// sixty calls". The server merges it into whatever it currently holds, inside a
// transaction, so a device with an old copy can only ever affect the records it
// actually touched. Everything else on the board is untouchable by it.
//
// The whole-key route above still exists and is still right for the two things
// that genuinely replace a whole key: pruning the board when it outgrows the
// server, and the handful of keys that are not records at all.
const { RECORD_CAP_MAX, mergeRecordsInto } = require("./lib/merge-records.cjs");
const { ADMIN_SCOPES, DELEGATION_SCOPES, cleanScopes, scopeAllowsKey, scopeSentence } = require("./lib/delegation.cjs");

app.post("/api/board/records", requireAuth, (req, res) => {
  const { key } = req.body || {};
  if (typeof key !== "string") return res.status(400).json({ error: "Missing key" });
  if (FORBIDDEN_KEYS.has(key)) return res.status(403).json({ error: "Not available through the board." });
  if (!mayWriteKey(req.user, key)) {
    return res.status(403).json({ error: "Only an administrator can change that." });
  }
  const body = req.body || {};
  const wantsList = Array.isArray(body.upsert);
  const wantsMap = !wantsList && body.upsert && typeof body.upsert === "object";
  if (!wantsList && !wantsMap) {
    return res.status(400).json({ error: "upsert must be a list of records or a map." });
  }

  // Read, merge and write as one thing. Two devices merging at the same instant
  // serialise here rather than one of them reading before the other has
  // written — which would be the whole-board bug again, in miniature.
  let merged;
  try {
    merged = db.transaction(() => {
      const row = db.prepare("SELECT value FROM board WHERE key = ?").get(key);
      const current = row ? JSON.parse(row.value) : null;
      // A key that holds a list cannot be merged with a map, or the other way
      // round. The client is told so and falls back to writing the key whole.
      if (current !== null && current !== undefined) {
        if (wantsList && !Array.isArray(current)) return "SHAPE";
        if (wantsMap && (Array.isArray(current) || typeof current !== "object")) return "SHAPE";
      }
      const next = mergeRecordsInto(current, body);
      if (next === null) return "SHAPE";
      db.prepare(
        `INSERT INTO board (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(key, JSON.stringify(next));
      return next;
    })();
  } catch (e) {
    return res.status(500).json({ error: `That could not be saved: ${e.message}` });
  }
  if (merged === "SHAPE") {
    return res.status(409).json({ error: "That key does not hold records of this shape.", shape: true });
  }
  // The merged board goes back, so the device that wrote adopts what everybody
  // else has done in the same breath rather than waiting for the next poll.
  res.json({ ok: true, value: merged });
});

// "Is my data actually being kept?" — answerable in one click instead of by
// reading deploy logs. Reports where the board is stored, whether that survives
// a redeploy, and what is currently in it. Key names and sizes only; no values,
// so this shows nothing /api/board would not already hand over.
// How full the disk the database sits on actually is.
//
// Read from the filesystem rather than guessed at from the size of the rows:
// SQLite's file is larger than the sum of its values, the write-ahead log sits
// beside it, and on a hosted box other things share the volume. The only honest
// number is the one the disk itself reports.
//
// Best effort. statfs is not available everywhere, and a board that cannot
// measure its disk should say it cannot rather than invent a percentage.
const DISK_WARN_PCT = Number(process.env.DISK_WARN_PCT || 75);

function diskUsage() {
  try {
    const st = fs.statfsSync(path.dirname(DB_PATH));
    const total = st.blocks * st.bsize;
    // bavail, not bfree: some blocks are reserved for root and are not space
    // this process can ever use, so counting them would flatter the figure.
    const free = st.bavail * st.bsize;
    if (!total) return { measured: false };
    const used = total - free;
    return {
      measured: true,
      totalBytes: total,
      freeBytes: free,
      usedBytes: used,
      usedPct: Math.round((used / total) * 1000) / 10,
      warnAtPct: DISK_WARN_PCT,
      warning: (used / total) * 100 >= DISK_WARN_PCT,
    };
  } catch (e) {
    return { measured: false, reason: String((e && e.message) || e) };
  }
}

// How big the database file itself is, WAL and all.
function dbFileBytes() {
  let n = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      n += fs.statSync(DB_PATH + suffix).size;
    } catch (e) {}
  }
  return n;
}

// ---------- backups ----------
//
// Until now the whole board was one file on one disk. That survives a redeploy,
// which is the problem we fixed before, but it does not survive the disk
// failing, somebody deleting a member of staff by mistake, or a bad write. A
// backup is time travel, not just spare hardware - the failures a copy actually
// saves you from are usually the human ones.
//
// A live SQLite file cannot be backed up by copying it. It is mid-write, and
// with WAL on, the .db file alone is not even the whole database - you get a
// copy that looks fine until the day you need it. better-sqlite3 exposes
// SQLite's own online backup, which takes a consistent snapshot while the app
// keeps serving, and that is what runs here.
const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
const BACKUP_KEEP_DAILY = Number(process.env.BACKUP_KEEP_DAILY || 30);
const BACKUP_KEEP_WEEKLY = Number(process.env.BACKUP_KEEP_WEEKLY || 12);

// Where copies go. BACKUP_DIR sits beside the database on the persistent disk.
// BACKUP_DIR_2 is the second, separate destination - on a server you own, that
// is the mount path of an external drive left connected; the same snapshot is
// written to both, so losing either disk still leaves a copy.
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), "backups");
const BACKUP_DIR_2 = process.env.BACKUP_DIR_2 || "";

// Downloading a backup means downloading every patient record on the board, so
// it is refused unless an operator has deliberately set a token. No token, no
// download route at all - a file this sensitive must not be one URL away.
const BACKUP_TOKEN = process.env.BACKUP_TOKEN || "";

// Seconds, not just minutes.
//
// Two backups in the same minute produced the same filename, and `db.backup()`
// overwrites — so taking a safety copy immediately before a restore destroyed
// the very copy being restored from. Found by driving the restore button
// against a real server: the file list afterwards had one backup in it where
// there should have been two.
// A name no existing copy already has.
//
// Seconds were added when two backups in the same MINUTE collided and the
// safety copy taken before a restore destroyed the copy being restored from.
// Seconds are not enough either: taking a copy and then restoring from it
// inside the same second is a thing a person can do by clicking twice, and a
// test does it every run - and `db.backup()` overwrites, so the copy simply
// became a picture of the damage it was supposed to undo. Silently.
//
// So the name is checked against the disk and given a suffix if it is taken.
// A backup must never be able to destroy another backup.
function backupName(at, dir) {
  const d = new Date(at);
  const p2 = (n) => String(n).padStart(2, "0");
  const stem =
    `board-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
    `-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  let name = `${stem}.db`;
  if (!dir) return name;
  try {
    for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${stem}-${n}.db`;
  } catch (e) {
    // Cannot look: the plain name is still better than nothing.
  }
  return name;
}

function listBackups(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("board-") && f.endsWith(".db"))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, bytes: st.size, at: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.at < b.at ? 1 : -1));
  } catch (e) {
    return [];
  }
}

// Keep every backup for BACKUP_KEEP_DAILY days, then one per week for
// BACKUP_KEEP_WEEKLY weeks. Deleting the rest keeps a year of history in a
// couple of hundred MB rather than letting copies fill the disk we just added
// a warning for.
function pruneBackups(dir) {
  // Sidecars left beside a backup by an older build, or by something reading
  // one. They are not backups and they confuse both the list and anybody
  // copying files off the disk by hand.
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/-(wal|shm)$/.test(f)) continue;
      if (!f.startsWith("board-") && !f.startsWith("before-restore-")) continue;
      try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* already gone */ }
    }
  } catch (e) {
    // the directory will be made on the next write
  }
  const now = Date.now();
  const dailyCut = now - BACKUP_KEEP_DAILY * 24 * 60 * 60 * 1000;
  const weeklyCut = now - BACKUP_KEEP_WEEKLY * 7 * 24 * 60 * 60 * 1000;
  const weekSeen = new Set();
  for (const b of listBackups(dir)) {
    const t = new Date(b.at).getTime();
    if (t >= dailyCut) continue;
    const week = Math.floor(t / (7 * 24 * 60 * 60 * 1000));
    if (t >= weeklyCut && !weekSeen.has(week)) { weekSeen.add(week); continue; }
    try { fs.unlinkSync(path.join(dir, b.name)); } catch (e) { /* already gone */ }
  }
}

// A finished snapshot, made into a single file. Best effort: a copy that could
// not be settled is still a valid database, just one with sidecars.
function settleBackupFile(file) {
  try {
    const copy = new Database(file);
    copy.pragma("journal_mode = DELETE");
    copy.close();
    for (const ext of ["-wal", "-shm"]) {
      try { fs.unlinkSync(file + ext); } catch (e) { /* not there, which is the point */ }
    }
  } catch (e) {
    console.log(`Backup ${path.basename(file)} could not be settled: ${e.message}`);
  }
}

let lastBackup = null;

async function runBackup(reason) {
  const at = Date.now();
  const written = [];
  const failed = [];
  // Named against the directory it is going into, so it cannot land on a copy
  // that is already there.
  let name;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    name = backupName(at, BACKUP_DIR);
  } catch (e) {
    name = backupName(at);
  }
  // The first destination is written by SQLite itself; the second is a copy of
  // that finished file, which is safe because by then it is no longer live.
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const dest = path.join(BACKUP_DIR, name);
    await db.backup(dest);
    // The copy inherits WAL journalling from the live database, which means
    // reading it leaves a `-wal` and a `-shm` beside it and copying the `.db`
    // on its own is copying an incomplete database. Turned off on the copy, it
    // is one self-contained file that `cp` and a USB stick cannot get wrong.
    settleBackupFile(dest);
    written.push(BACKUP_DIR);
    pruneBackups(BACKUP_DIR);
  } catch (e) {
    failed.push({ dir: BACKUP_DIR, error: String(e.message || e) });
  }
  if (BACKUP_DIR_2 && written.length) {
    try {
      fs.mkdirSync(BACKUP_DIR_2, { recursive: true });
      fs.copyFileSync(path.join(BACKUP_DIR, name), path.join(BACKUP_DIR_2, name));
      written.push(BACKUP_DIR_2);
      pruneBackups(BACKUP_DIR_2);
    } catch (e) {
      // A second drive that has been unplugged must not stop the first copy
      // being made, but it must be visible - that is the whole point of it.
      failed.push({ dir: BACKUP_DIR_2, error: String(e.message || e) });
    }
  }
  let bytes = 0;
  try { bytes = fs.statSync(path.join(BACKUP_DIR, name)).size; } catch (e) { /* first copy failed */ }
  lastBackup = { name, at: new Date(at).toISOString(), reason, bytes, written, failed };
  console.log(
    `Backup ${failed.length && !written.length ? "FAILED" : "written"}: ${name}` +
    ` -> ${written.join(", ") || "nowhere"}` +
    (failed.length ? ` · failed: ${failed.map((f) => `${f.dir} (${f.error})`).join("; ")}` : "")
  );
  return lastBackup;
}

function backupState() {
  const second = BACKUP_DIR_2
    ? { dir: BACKUP_DIR_2, configured: true, count: listBackups(BACKUP_DIR_2).length,
        reachable: isWritableDir(BACKUP_DIR_2) }
    : { configured: false };
  const copies = listBackups(BACKUP_DIR);
  return {
    // A backup that quietly stopped a month ago is worse than none, so the age
    // is reported rather than just the fact that backups are switched on.
    last: lastBackup,
    ageMs: lastBackup ? Date.now() - new Date(lastBackup.at).getTime() : null,
    stale: lastBackup ? Date.now() - new Date(lastBackup.at).getTime() > 2 * BACKUP_EVERY_MS : true,
    primary: { dir: BACKUP_DIR, count: copies.length,
               newest: copies[0] || null, totalBytes: copies.reduce((n, b) => n + b.bytes, 0) },
    second,
    downloadEnabled: !!BACKUP_TOKEN,
    keepDaily: BACKUP_KEEP_DAILY,
    keepWeekly: BACKUP_KEEP_WEEKLY,
  };
}

// Administrators only, both of them. The listing names the copies, and those
// names are what the restore routes are addressed by; the other lets anyone
// who can reach the server fill its disk with snapshots.
app.get("/api/backups", requireArea("archive"), (req, res) => {
  res.json({ ok: true, ...backupState(), copies: listBackups(BACKUP_DIR) });
});

app.post("/api/backups", requireArea("archive"), async (req, res) => {
  const state = await runBackup("on demand");
  res.json({ ok: !!state.written.length, ...state });
});

// Deliberately token-gated, and absent entirely when no token is set. This
// route hands over every patient record the department holds.
app.get("/api/backups/:name", (req, res) => {
  if (!BACKUP_TOKEN) {
    return res.status(404).json({ error: "Backup download is not enabled on this server." });
  }
  const given = req.get("x-backup-token") || req.query.token || "";
  if (given !== BACKUP_TOKEN) return res.status(403).json({ error: "Wrong or missing backup token." });
  // Name comes from the URL, so it is taken apart and rebuilt rather than
  // trusted - "../../etc/passwd" is a path, not a backup.
  const name = path.basename(String(req.params.name));
  if (!/^board-\d{8}-\d{4,6}\.db$/.test(name)) return res.status(400).json({ error: "Not a backup name." });
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "No such backup." });
  res.download(file, name);
});

// ---------- putting data back from a copy ----------
//
// A whole-file rollback throws away every hour worked since, so it is not what
// these two routes do. They compare a backup with the live board key by key and
// then put back only the keys somebody chooses — which is what an actual loss
// looks like: the calls emptied, or the log truncated, while everything else
// carried on being right.
//
// Administrators only, and the comparison deliberately returns sizes and counts
// rather than values. What was in the board is patient data; how much of it
// there was is not.
function backupFileFor(rawName) {
  const name = path.basename(String(rawName || ""));
  if (!/^board-\d{8}-\d{4,6}\.db$/.test(name) && !/^before-restore-[0-9]{8,}\.db$/.test(name)) {
    return { error: "Not a backup name." };
  }
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return { error: "No such backup." };
  return { name, file };
}

// Every key in a board table, described by how much it holds.
function boardShape(dbPath) {
  const src = new Database(dbPath, { readonly: true });
  let rows = [];
  try {
    rows = src.prepare("SELECT key, value, updated_at FROM board").all();
  } finally {
    src.close();
  }
  const out = new Map();
  for (const r of rows) {
    let count = null;
    try {
      const v = JSON.parse(r.value);
      if (Array.isArray(v)) count = v.length;
      else if (v && typeof v === "object") count = Object.keys(v).length;
    } catch (e) {
      // not JSON, so its size is all there is to say
    }
    out.set(r.key, { bytes: r.value.length, count, updatedAt: r.updated_at });
  }
  return out;
}

app.get("/api/backups/:name/compare", requireArea("archive"), (req, res) => {
  const found = backupFileFor(req.params.name);
  if (found.error) return res.status(404).json({ error: found.error });
  let was;
  try {
    was = boardShape(found.file);
  } catch (e) {
    return res.status(500).json({ error: `That copy could not be read: ${e.message}` });
  }
  const now = boardShape(DB_PATH);
  const keys = [...new Set([...was.keys(), ...now.keys()])]
    .filter((k) => !FORBIDDEN_KEYS.has(k))
    .sort();
  const rows = keys.map((k) => {
    const a = was.get(k) || null;
    const b = now.get(k) || null;
    // "Smaller now than it was" is the shape a loss makes. A key that has grown
    // is not interesting and is not flagged, or every row would be.
    const shrank = !!a && (!b || (a.count !== null && b.count !== null ? b.count < a.count : b.bytes < a.bytes));
    return {
      key: k,
      backup: a && { bytes: a.bytes, count: a.count, updatedAt: a.updatedAt },
      live: b && { bytes: b.bytes, count: b.count, updatedAt: b.updatedAt },
      shrank,
      restorable: !!a,
    };
  });
  res.json({ ok: true, name: found.name, rows, lost: rows.filter((r) => r.shrank).map((r) => r.key) });
});

// ---------- sync with a copy ----------
//
// Restoring key by key is right for a known loss and wrong for "something is
// missing and I do not know what". This is the other one: read a copy, and put
// back every record the live board no longer has - by record id, so nothing
// that is already there is touched and nothing arrives twice.
//
// It never removes anything. Whatever the board has now it keeps, and a record
// present in both keeps the LIVE version, because the live one is the one
// people have been working on since the copy was taken.
//
// And it does not resurrect what the board deliberately let go. A completed
// call is pruned four shifts after its shift was filed, because the archive
// already holds it - putting those back would fill the live board with work
// that is finished and filed, which is the duplication this is meant to avoid.
// So a record is skipped when a finalised submission already contains it.
function filedRecordIds(liveBoard) {
  const ids = new Set();
  let subs = [];
  try {
    const row = liveBoard.prepare("SELECT value FROM board WHERE key = 'ems:submissions'").get();
    subs = row ? JSON.parse(row.value) || [] : [];
  } catch (e) {
    return ids;
  }
  (Array.isArray(subs) ? subs : []).forEach((sub) => {
    if (!sub || sub.status !== "final") return;
    ["requests", "log"].forEach((part) => {
      (Array.isArray(sub[part]) ? sub[part] : []).forEach((r) => {
        if (r && r.id) ids.add(String(r.id));
      });
    });
  });
  return ids;
}

// Is this record safe to put back on a LIVE board?
//
// The first sweep put back work that was in flight when a copy was taken, and
// a call that was in flight two days ago is not a call - it came back reading
// "DISPATCHED · 48h · no crew signed on", and old bookings came back waiting
// for a team that will never be sent. That is worse than the gap it filled: a
// desk cannot tell a ghost from a job.
//
// So what comes back is work that is FINISHED, plus anything recent enough to
// still be real. Everything else stays in the copy, where it does no harm.
const DAY_MS = 24 * 60 * 60 * 1000;

function safeToRestore(key, rec, now) {
  if (!rec || typeof rec !== "object") return false;
  if (key === "ems:requests") {
    // A finished call is a fact and belongs in the statistics.
    if (rec.status === "completed") return true;
    // Anything unfinished is only real if it could still be running. A call
    // raised within the last day can be; one from last week cannot.
    return !!rec.createdAt && now - rec.createdAt < DAY_MS;
  }
  if (key === "ems:scheduled") {
    // A booking already dealt with - dispatched or cancelled - is history and
    // safe. One still open is only worth restoring if its time has not passed.
    if (rec.status && rec.status !== "scheduled" && rec.status !== "releasing") return true;
    if (!rec.scheduledFor) return false; // waiting on a phone call, from when?
    return rec.scheduledFor > now - DAY_MS;
  }
  // Everything else - the log, checklists, inventory moves, overtime - is a
  // record of something that happened. None of it can put a ghost on the board.
  return true;
}

// Reading one copy into a pile of records the live board is missing.
//
// Nothing is written here — it only collects. `have` is every id the board
// already holds, `filed` every id a finalised submission already contains, and
// `found` is the pile being built across however many copies are read. A record
// seen in an older copy and again in a newer one keeps the NEWER version, which
// is why the sweep below reads oldest first.
function collectMissing(file, live, have, filed, found) {
  let src;
  try {
    src = new Database(file, { readonly: true });
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
  let read = 0;
  try {
    for (const row of src.prepare("SELECT key, value FROM board").all()) {
      if (!row || FORBIDDEN_KEYS.has(row.key)) continue;
      let was;
      try {
        was = JSON.parse(row.value);
      } catch (e) {
        continue;
      }
      // Only lists of records can be merged by id. A key holding one whole
      // object is left alone: there is no way to tell a missing half from a
      // deliberately changed one, and guessing would undo somebody's edit.
      if (!Array.isArray(was)) continue;
      if (!found.has(row.key)) found.set(row.key, new Map());
      const pile = found.get(row.key);
      const held = have.get(row.key) || new Set();
      for (const rec of was) {
        if (!rec || !rec.id) continue;
        const id = String(rec.id);
        if (held.has(id)) continue;
        // Already filed and finalised. The archive holds it, the live board
        // dropped it on purpose, and putting it back would fill the board with
        // work that is finished.
        if (filed.has(id)) {
          pile.set("__filed__" + id, null);
          continue;
        }
        // Finished work and things that could still be real. See
        // `safeToRestore`: the first sweep resurrected calls that were in
        // flight days ago, and they came back onto the board as live.
        if (!safeToRestore(row.key, rec, Date.now())) {
          pile.set("__stale__" + id, null);
          continue;
        }
        pile.set(id, rec);
        read++;
      }
    }
  } catch (e) {
    src.close();
    return { error: String((e && e.message) || e) };
  }
  src.close();
  return { read };
}

// Everything this board is missing, from every copy on the disk, in one press.
//
// Picking one copy is the wrong shape for the usual case. A loss is rarely
// confined to the newest backup: the missing week is spread across the twenty
// copies that saw it, and asking somebody to work out which one holds what is
// asking them to do the search by hand. This reads them all, oldest first, and
// puts back everything the board no longer has.
//
// Safe to press at any time, and safe to press twice. Nothing is removed, a
// record already on the board is never touched, a record seen in several copies
// is added once, and anything a finalised submission already contains is left
// where it is. Running it again when nothing is missing writes nothing at all.
app.post("/api/backups/sync-all", requireArea("archive"), async (req, res) => {
  const copies = listBackups(BACKUP_DIR)
    .slice()
    // Oldest first, so a record that appears in several keeps the newest copy
    // of itself.
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  if (!copies.length) return res.status(404).json({ error: "There are no copies to read." });

  const safety = await runBackup("before a sync");
  if (!safety.written.length) {
    return res.status(500).json({
      error: "A safety copy of the board could not be written, so nothing was changed.",
    });
  }
  // Its own safety copy is not one of the copies to read back.
  const sweep = copies.filter((c) => c.name !== safety.name);

  const filed = filedRecordIds(db);
  const have = new Map();
  const liveLists = new Map();
  for (const row of db.prepare("SELECT key, value FROM board").all()) {
    if (!row || FORBIDDEN_KEYS.has(row.key)) continue;
    try {
      const v = JSON.parse(row.value);
      if (!Array.isArray(v)) continue;
      liveLists.set(row.key, v);
      have.set(row.key, new Set(v.map((r) => r && r.id).filter(Boolean).map(String)));
    } catch (e) {
      /* not a list, not our business */
    }
  }

  const found = new Map();
  const unreadable = [];
  for (const c of sweep) {
    const r = collectMissing(path.join(BACKUP_DIR, c.name), db, have, filed, found);
    if (r.error) unreadable.push({ name: c.name, error: r.error });
  }

  const put = db.prepare(
    `INSERT INTO board (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  const work = [];
  const report = [];
  for (const [key, pile] of found) {
    const back = [...pile.entries()]
      .filter(([id]) => !id.startsWith("__filed__") && !id.startsWith("__stale__"))
      .map(([, r]) => r);
    const skipped = [...pile.keys()].filter((id) => id.startsWith("__filed__")).length;
    const stale = [...pile.keys()].filter((id) => id.startsWith("__stale__")).length;
    if (!back.length) {
      if (skipped || stale) report.push({ key, added: 0, alreadyFiled: skipped, unfinished: stale });
      continue;
    }
    const now = liveLists.get(key) || [];
    work.push({ key, value: JSON.stringify([...now, ...back]) });
    report.push({ key, added: back.length, alreadyFiled: skipped, unfinished: stale });
  }
  db.transaction((list) => {
    for (const w of list) put.run(w.key, w.value);
  })(work);

  const total = report.reduce((n, r) => n + r.added, 0);
  console.log(
    `Sync-all: ${total} record(s) put back from ${sweep.length} copies by ${req.user.id}` +
      ` (safety copy ${safety.name || "?"})` +
      (unreadable.length ? ` · unreadable: ${unreadable.map((u) => u.name).join(", ")}` : "")
  );
  res.json({
    ok: true,
    copiesRead: sweep.length,
    safety: safety.name ? [safety.name] : [],
    added: total,
    keys: report.filter((r) => r.added || r.alreadyFiled || r.unfinished).sort((a, b) => b.added - a.added),
    unreadable,
  });
});

app.post("/api/backups/:name/restore", requireArea("archive"), async (req, res) => {
  const found = backupFileFor(req.params.name);
  if (found.error) return res.status(404).json({ error: found.error });
  const asked = Array.isArray((req.body || {}).keys) ? req.body.keys : [];
  const keys = [...new Set(asked.map(String))].filter((k) => k && !FORBIDDEN_KEYS.has(k));
  if (!keys.length) return res.status(400).json({ error: "Name at least one key to put back." });

  const src = new Database(found.file, { readonly: true });
  let values;
  try {
    const get = src.prepare("SELECT value FROM board WHERE key = ?");
    values = keys.map((k) => ({ key: k, row: get.get(k) }));
  } catch (e) {
    src.close();
    return res.status(500).json({ error: `That copy could not be read: ${e.message}` });
  }
  src.close();
  const absent = values.filter((v) => !v.row).map((v) => v.key);
  if (absent.length) {
    return res.status(400).json({ error: `Not in that copy: ${absent.join(", ")}` });
  }

  // What is about to be replaced, kept — so a restore that turns out to be the
  // wrong one is itself undoable.
  const safety = await runBackup("before a restore");
  if (!safety.written.length) {
    return res.status(500).json({
      error: "A safety copy of the board could not be written, so nothing was changed.",
    });
  }

  const put = db.prepare(
    `INSERT INTO board (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  db.transaction((list) => {
    for (const v of list) put.run(v.key, v.row.value);
  })(values);

  console.log(
    `Restore: ${keys.join(", ")} put back from ${found.name} by ${req.user.id}` +
      ` · safety copy ${safety.name}`
  );
  res.json({ ok: true, restored: keys, from: found.name, safetyCopy: safety.name });
});

// The roster has to exist before anyone can sign in.
//
// An existing deployment keeps its accounts in the board under "ems:accounts",
// which is exactly the problem - it is readable by anything that can read the
// board. They are moved into the table on the first start after this change
// and the board key is deleted, so credential material stops being one API
// call away. Old SHA-256 hashes come across as legacy_hash and are replaced
// with a salted one the first time each person signs in.
function seedAccounts() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n;
  if (count > 0) return;

  const row = db.prepare("SELECT value FROM board WHERE key = 'ems:accounts'").get();
  const existing = row ? JSON.parse(row.value) || [] : [];
  const insert = db.prepare(
    `INSERT INTO accounts (id, name, role, team, slot, station, legacy_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
  );

  if (existing.length) {
    const move = db.transaction((list) => {
      for (const a of list) {
        if (!a || !a.id) continue;
        insert.run(String(a.id).toUpperCase(), a.name || "",
          ["admin", "dispatcher", "crew"].includes(a.role) ? a.role : "crew",
          a.team || null, a.slot || null, a.station || null, a.passwordHash || null);
      }
      db.prepare("DELETE FROM board WHERE key IN ('ems:accounts','ems:accountsSeeded')").run();
    });
    move(existing);
    console.log(`Accounts: moved ${existing.length} out of the board into their own table.`);
    return;
  }

  // A board with nothing on it yet. The same two the app used to seed itself
  // with, neither carrying a password - the first person to sign in as each
  // chooses one.
  insert.run("F1525518", "Admin", "admin", null, null, null, null);
  insert.run("D1000001", "Dispatcher", "dispatcher", null, null, null, null);
  // Somebody has to be able to open a brand new board, and nobody exists yet to
  // issue a code. This one is printed to the server log — the deploy log on a
  // hosted box — which is readable by whoever runs the service and by nobody
  // else. It opens the administrator's account once and is then spent, and from
  // there every other code is handed out from inside the app.
  const bootstrap = issueClaimCode("F1525518");
  console.log("Accounts: seeded the default administrator and dispatcher.");
  console.log("");
  console.log("  ┌──────────────────────────────────────────────────────────┐");
  console.log("  │  FIRST SIGN-IN                                           │");
  console.log("  │  Employee ID    F1525518                                 │");
  console.log(`  │  Sign-in code   ${bootstrap}${" ".repeat(41 - bootstrap.length)}│`);
  console.log("  │  Valid for 7 days, and once only.                        │");
  console.log("  └──────────────────────────────────────────────────────────┘");
  console.log("");
}
seedAccounts();

// ---------- signing in ----------

// ---------- delegated authority ----------
//
// An administrator cannot be on the board at four in the morning, and the
// alternative people reach for is signing in on somebody else's ID — which puts
// the wrong name on every line of the night's log. So authority can be lent:
// a named person, for a named number of days, working under their own name with
// the standing they were given.
//
// It is checked here and only here. A screen that hides a button is not a
// permission, and a token that says "admin" is worth nothing on its own — every
// request re-reads the account and re-checks that the delegation is still live.
const ROLES = ["admin", "dispatcher", "crew"];

// What this person has been lent, if anything.
//
// It stands until an administrator takes it back. There is no clock on it: an
// expiry that runs out in the middle of a night shift takes somebody's
// authority away at the moment they are using it, and the department would
// rather decide when it ends than have a date decide for them. Revocation is
// immediate — every request re-reads this — so "take it back" is the control,
// and it is a real one.
function liveDelegation(a) {
  if (!a) return null;
  // A delegation from before areas existed. A whole role was lent; the areas it
  // stands for are read off it once, here, rather than migrating the column and
  // risking a half-migrated board.
  const legacy =
    a.delegated_role === "admin" ? ADMIN_SCOPES
      : a.delegated_role === "dispatcher" ? ["dispatch"]
      : [];
  let stored = [];
  try {
    stored = a.delegated_scopes ? JSON.parse(a.delegated_scopes) : [];
  } catch (e) {
    stored = [];
  }
  const scopes = cleanScopes(stored.length ? stored : legacy);
  if (!scopes.length) return null;
  // An expiry set by an older build is still honoured while it lasts, so
  // nothing anybody granted quietly becomes permanent because of this change.
  if (a.delegated_until && Date.now() > a.delegated_until) return null;
  return {
    scopes,
    until: a.delegated_until || null,
    by: a.delegated_by || "",
    at: a.delegated_at || null,
  };
}

// Every role this person may act as, their own first.
//
// Holding the desk means they can work as a dispatcher. Holding any area of
// administration means they can work on the administrator's side of the app —
// but only on the areas they hold, which is what `req.user.scopes` decides.
function allowedRoles(a) {
  const own = a && a.role;
  const d = liveDelegation(a);
  const out = [own];
  if (d) {
    if (d.scopes.includes("dispatch") && own !== "dispatcher") out.push("dispatcher");
    if (d.scopes.some((s) => ADMIN_SCOPES.includes(s)) && own !== "admin") out.push("admin");
  }
  return out;
}

const publicAccount = (a) => a && ({
  id: a.id, name: a.name, role: a.role, team: a.team, slot: a.slot, station: a.station,
  // Whether they have chosen one - never the hash itself.
  hasPassword: !!(a.pw_hash || a.legacy_hash),
  delegation: liveDelegation(a),
  roles: allowedRoles(a),
});

function findAccount(id) {
  return db.prepare("SELECT * FROM accounts WHERE id = ?").get(String(id || "").trim().toUpperCase());
}

// Does this employee ID exist, and have they set a password yet? Answered
// before the password is asked for, because the app's sign-in has always been
// two steps and a first-time user has to be offered "choose a password".
app.post("/api/auth/lookup", (req, res) => {
  const acct = findAccount((req.body || {}).id);
  if (!acct) return res.status(404).json({ error: "No account with that employee ID." });
  res.json({ ok: true, account: publicAccount(acct) });
});

app.post("/api/auth/login", (req, res) => {
  const { id, password } = req.body || {};
  const key = String(id || "").trim().toUpperCase();
  if (loginBlocked(key)) {
    return res.status(429).json({ error: "Too many attempts. Try again in fifteen minutes." });
  }
  const acct = findAccount(key);
  // The same answer either way, so this cannot be used to find out which
  // employee IDs exist.
  if (!acct || !checkPassword(acct, password)) {
    loginFailed(key);
    return res.status(401).json({ error: "That employee ID and password do not match." });
  }
  LOGIN_TRIES.delete(key);
  const fresh = findAccount(key);
  res.json({ ok: true, token: issueToken(fresh), account: publicAccount(fresh) });
});

// Stepping into a delegated role.
//
// The token is issued when the password is checked, which is before anybody has
// been asked which hat they are wearing — so choosing one re-issues it. The
// role asked for is checked against the account here; a device cannot simply
// declare itself an administrator, and a delegation that has been revoked or
// has run out is refused at this point as well as on every request after it.
app.post("/api/auth/act", requireAuth, (req, res) => {
  const want = String((req.body || {}).role || "").trim();
  const live = findAccount(req.user.id);
  if (!live) return res.status(401).json({ error: "That account no longer exists." });
  const allowed = allowedRoles(live);
  if (!allowed.includes(want)) {
    return res.status(403).json({ error: "You do not hold that role." });
  }
  const del = liveDelegation(live);
  res.json({
    ok: true,
    token: issueToken(live, want),
    acting: want,
    // What they may actually touch, so the app can draw only those areas
    // rather than a full administrator's screen with everything refused.
    scopes: want === "admin" && live.role !== "admin" && del ? del.scopes : [],
    account: publicAccount(live),
  });
});

// Lending authority, and taking it back. Administrators only — the one thing
// nobody may do is grant themselves more than they have.
app.post("/api/accounts/:id/delegate", requireFullAdmin, (req, res) => {
  const key = String(req.params.id || "").trim().toUpperCase();
  const acct = findAccount(key);
  if (!acct) return res.status(404).json({ error: "No account with that employee ID." });
  const scopes = cleanScopes((req.body || {}).scopes);

  // Taking it back. Every area at once — an administrator ending a delegation
  // is ending it, not editing it.
  if (!scopes.length) {
    db.prepare(
      `UPDATE accounts SET delegated_role = NULL, delegated_scopes = NULL,
       delegated_until = NULL, delegated_by = NULL, delegated_at = NULL WHERE id = ?`
    ).run(key);
    return res.json({ ok: true, account: publicAccount(findAccount(key)) });
  }

  // Delegating to yourself is not delegation, and it is the one route by which
  // an administrator could quietly rewrite their own standing.
  if (key === req.user.id) {
    return res.status(400).json({ error: "You cannot delegate to yourself." });
  }
  if (acct.role === "admin") {
    return res.status(400).json({ error: "They are already an administrator." });
  }
  if (scopes.includes("dispatch") && acct.role === "dispatcher") {
    return res.status(400).json({ error: "They already work the dispatch desk." });
  }
  // The name, not the employee ID. The person being asked "do you want to work
  // on the overtime tonight?" is being told who said they could, and "F1525518"
  // is not an answer to that — it is a number off a badge they may never have
  // seen. The roster is administrator-only, so the sign-in screen cannot look
  // it up for itself; it is recorded here, once, where it is known.
  const granter = findAccount(req.user.id);
  const grantedBy = (granter && granter.name) || req.user.id;
  db.prepare(
    `UPDATE accounts SET delegated_role = NULL, delegated_scopes = ?,
     delegated_until = NULL, delegated_by = ?, delegated_at = ? WHERE id = ?`
  ).run(JSON.stringify(scopes), grantedBy, Date.now(), key);
  console.log(
    `Delegation: ${grantedBy} gave ${key} ${scopeSentence(scopes)} — until taken back`
  );
  res.json({ ok: true, account: publicAccount(findAccount(key)) });
});

// First sign-in, and only then. Setting a password over an account that
// already has one is a reset, and a reset goes through an administrator - so a
// stolen employee ID cannot be turned into a working account.
// Claiming an account: the employee ID is not enough.
//
// It used to be. Anyone who could name an ID that had never been signed into
// could set a password on it and become that person - and employee IDs are
// printed on badges and follow a pattern. The one-time code an administrator
// issues is the second thing, and it is checked here under the same rate limit
// as a password so it cannot be worked through either.
app.post("/api/auth/set-password", (req, res) => {
  const { id, password, code } = req.body || {};
  const acct = findAccount(id);
  if (!acct) return res.status(404).json({ error: "No account with that employee ID." });
  if (acct.pw_hash || acct.legacy_hash) {
    return res.status(409).json({ error: "That account already has a password. Ask an administrator to clear it." });
  }
  const key = String(id || "").trim().toUpperCase();
  if (loginBlocked(key)) {
    return res.status(429).json({ error: "Too many attempts. Try again later." });
  }
  if (!acct.claim_hash) {
    return res.status(403).json({
      error: "This account needs a sign-in code before a password can be set. Ask your administrator for one.",
      needsCode: true,
    });
  }
  if (!checkClaimCode(acct, code)) {
    loginFailed(key);
    const expired = acct.claim_expires && Date.now() > acct.claim_expires;
    return res.status(403).json({
      error: expired
        ? "That sign-in code has expired. Ask your administrator for a new one."
        : "That sign-in code is not right.",
      needsCode: true,
    });
  }
  if (!password || String(password).length < 4) {
    return res.status(400).json({ error: "Choose a password of at least four characters." });
  }
  LOGIN_TRIES.delete(key);
  setPassword(acct.id, password);
  // Spent. A code opens an account once.
  clearClaimCode(acct.id);
  const fresh = findAccount(acct.id);
  res.json({ ok: true, token: issueToken(fresh), account: publicAccount(fresh) });
});

// An administrator hands one out. Shown once, here, and never again — only its
// hash is kept, exactly like a password.
app.post("/api/accounts/:id/claim-code", requireArea("teams"), (req, res) => {
  const acct = findAccount(req.params.id);
  if (!acct) return res.status(404).json({ error: "No account with that employee ID." });
  if (acct.pw_hash || acct.legacy_hash) {
    return res.status(409).json({
      error: "That account already has a password. Clear it first if they need to start again.",
    });
  }
  const code = issueClaimCode(acct.id);
  res.json({ ok: true, code, expiresAt: Date.now() + CLAIM_TTL_MS, account: publicAccount(findAccount(acct.id)) });
});

// The forgotten-password request, which by its nature is made by somebody who
// cannot sign in. It only ever records a request for an administrator to look
// at; it changes nothing.
app.post("/api/auth/forgot", (req, res) => {
  const { id, name } = req.body || {};
  const key = String(id || "").trim().toUpperCase();
  if (!key) return res.status(400).json({ error: "Give your employee ID." });
  if (loginBlocked(key)) return res.status(429).json({ error: "Too many attempts. Try again later." });
  loginFailed(key);
  const acct = findAccount(key);
  // Answered the same whether or not the account exists.
  if (acct) {
    const row = db.prepare("SELECT value FROM board WHERE key = 'ems:passwordResets'").get();
    const list = row ? JSON.parse(row.value) || [] : [];
    const already = list.some((r) => r && r.accountId === acct.id && r.status === "open");
    if (!already) {
      list.unshift({
        id: `pwr_${Date.now().toString(36)}`,
        accountId: acct.id,
        name: acct.name || String(name || ""),
        role: acct.role,
        at: Date.now(),
        status: "open",
      });
      db.prepare(
        `INSERT INTO board (key, value, updated_at) VALUES ('ems:passwordResets', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(JSON.stringify(list.slice(0, 200)));
    }
  }
  res.json({ ok: true });
});

// ---------- the roster, as administration keeps it ----------

// Whether a code is outstanding is deliberately NOT on `publicAccount`.
//
// `/api/auth/lookup` answers to anybody, so putting it there would tell a
// stranger which employee IDs are sitting unclaimed with a live code on them —
// which is the half of the pair they do not have. Here it is behind the same
// check as the roster itself, and it is what stops an administrator having to
// guess whether they already handed somebody a code.
app.get("/api/accounts", requireArea("teams"), (req, res) => {
  const rows = db.prepare("SELECT * FROM accounts ORDER BY role, id").all();
  res.json({
    ok: true,
    accounts: rows.map((r) => ({
      ...publicAccount(r),
      codeIssued: !!r.claim_hash,
      codeExpires: r.claim_hash ? r.claim_expires || null : null,
    })),
  });
});

app.post("/api/accounts", requireArea("teams"), (req, res) => {
  const { id, name, role, team, slot, station } = req.body || {};
  const key = String(id || "").trim().toUpperCase();
  if (!key) return res.status(400).json({ error: "An employee ID is required." });
  if (!["admin", "dispatcher", "crew"].includes(role)) {
    return res.status(400).json({ error: "Unknown role." });
  }
  db.prepare(
    `INSERT INTO accounts (id, name, role, team, slot, station)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role,
       team = excluded.team, slot = excluded.slot, station = excluded.station`
  ).run(key, String(name || ""), role, team || null, slot || null, station || null);
  // A brand new account comes with the code that opens it, so an administrator
  // adding somebody can hand it straight over rather than going back for it.
  // An account that already has a password is being edited, not created, and
  // keeps whatever it had.
  const made = findAccount(key);
  const code = made && !made.pw_hash && !made.legacy_hash ? issueClaimCode(key) : null;
  res.json({
    ok: true,
    account: publicAccount(findAccount(key)),
    ...(code ? { code, expiresAt: Date.now() + CLAIM_TTL_MS } : {}),
  });
});

app.delete("/api/accounts/:id", requireArea("teams"), (req, res) => {
  const key = String(req.params.id || "").trim().toUpperCase();
  if (key === req.user.id) {
    return res.status(400).json({ error: "You cannot remove your own account." });
  }
  db.prepare("DELETE FROM accounts WHERE id = ?").run(key);
  res.json({ ok: true });
});

// Clearing a password is how a forgotten one is dealt with: the account keeps
// its history and the person chooses a new password at the next sign-in.
// Nobody, including an administrator, can set a password on somebody's behalf.
// Clearing a password issues the code that replaces it in the same breath.
// Clearing without one would leave the person unable to set a new password and
// unable to say why - the account would simply refuse them, which is precisely
// the lockout this route exists to end.
app.post("/api/accounts/:id/clear-password", requireArea("teams"), (req, res) => {
  const key = String(req.params.id || "").trim().toUpperCase();
  if (!findAccount(key)) return res.status(404).json({ error: "No such account." });
  db.prepare("UPDATE accounts SET pw_salt = NULL, pw_hash = NULL, legacy_hash = NULL WHERE id = ?").run(key);
  const code = issueClaimCode(key);
  res.json({ ok: true, code, expiresAt: Date.now() + CLAIM_TTL_MS });
});

app.get("/api/health", (req, res) => {
  const keys = db
    .prepare("SELECT key, length(value) AS bytes, updated_at FROM board ORDER BY key")
    .all();
  const totalBytes = keys.reduce((n, k) => n + (k.bytes || 0), 0);
  res.json({
    ok: true,
    database: {
      path: DB_PATH,
      chosenFrom: DB_SOURCE,
      survivesRedeploy: DB_IS_PERSISTENT,
      fileBytes: dbFileBytes(),
    },
    disk: diskUsage(),
    backups: backupState(),
    board: {
      keys: keys.length,
      totalBytes,
      // The biggest few, named. This is what somebody wants the moment the
      // total starts looking wrong, and it saves reading the whole list.
      largest: keys
        .slice()
        .sort((a, b) => (b.bytes || 0) - (a.bytes || 0))
        .slice(0, 5)
        .map((k) => ({ key: k.key, bytes: k.bytes })),
      entries: keys,
    },
  });
});

// The two pages Google Play requires a link to, on clean URLs.
//
// Both have to be reachable by anyone, without signing in — Play checks them
// from the outside, and a link that only works for a logged-in member of staff
// counts as no link at all. The URLs are entered in the Play Console listing
// (privacy policy) and in the Data safety form (data deletion), so they need to
// stay put once submitted rather than moving with a file rename.
app.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "privacy.html"));
});
app.get("/data-deletion", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "data-deletion.html"));
});

// The app itself (index.html, sw.js) — same static files used for both the
// website and the payload the native app bundles.
app.use(express.static(path.join(__dirname, "public")));

// Kept for parity with the old Netlify download.mts — lets anyone grab the
// current app file directly, e.g. to re-check what's actually deployed.
app.get("/download", (req, res) => {
  res.download(path.join(__dirname, "public", "index.html"), "pulseops.html");
});

app.listen(PORT, () => {
  console.log(`PulseOps server listening on port ${PORT}`);
  console.log(`Database file: ${DB_PATH}`);
  console.log(`Backups: ${BACKUP_DIR}${BACKUP_DIR_2 ? ` and ${BACKUP_DIR_2}` : ""}` +
    `${BACKUP_TOKEN ? "" : " · download disabled (no BACKUP_TOKEN set)"}`);
  // One on boot, so a server that is restarted daily still has yesterday, and
  // so a fresh deployment is never sitting there with no copy at all. Then
  // every 24 hours for as long as it stays up.
  runBackup("startup").catch((e) => console.error("Backup on startup failed:", e));
  const timer = setInterval(
    () => runBackup("scheduled").catch((e) => console.error("Scheduled backup failed:", e)),
    BACKUP_EVERY_MS
  );
  // Never hold the process open for the sake of the backup timer.
  if (timer.unref) timer.unref();
  console.log(`Chosen from: ${DB_SOURCE}`);

  // The failure this guards against is a silent one: the board works perfectly
  // all day and is empty again after the next deploy. If that is what is set
  // up, it should be impossible to miss in the logs.
  if (DB_IS_PERSISTENT) {
    console.log("Storage: persistent — the board survives restarts and redeploys.");
    return;
  }
  const lines = [
    "WARNING: this database is NOT persistent.",
    "",
    "It lives inside the app folder, which is rebuilt on every deploy.",
    "EVERY DEPLOY WILL ERASE THE ENTIRE BOARD — calls, crews, submitted",
    "logs, and all admin statistics.",
    "",
    "Fine on your own machine. On a hosted server, attach a persistent",
    "disk and set DB_PATH to a file on it (see the README). Check",
    "/api/health to confirm it took.",
  ];
  // Padded from the text rather than by hand, so editing a line later cannot
  // leave the box crooked.
  const width = Math.max(...lines.map((l) => l.length)) + 6;
  console.warn("");
  console.warn("*".repeat(width));
  lines.forEach((l) => console.warn(`*  ${l.padEnd(width - 6)}  *`));
  console.warn("*".repeat(width));
  console.warn("");
});
