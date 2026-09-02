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
// Human-facing dates are stamped in the department's own timezone, never the
// host's. An Alibaba Cloud image ships on UTC+8, so from 19:00 Riyadh the
// System page's history row read as TOMORROW. OPS_TZ overrides; the daily
// backup hour (BACKUP_DAILY_UTC_HOUR) is UTC and untouched by this.
const OPS_TZ = process.env.OPS_TZ || "Asia/Riyadh";
function opsParts(at) {
  const d = new Date(at);
  try {
    const f = new Intl.DateTimeFormat("en-GB", {
      timeZone: OPS_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(d);
    const get = (t) => (f.find((p) => p.type === t) || {}).value || "00";
    return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
  } catch (e) {
    const p2 = (n) => String(n).padStart(2, "0");
    return { y: String(d.getFullYear()), mo: p2(d.getMonth() + 1), d: p2(d.getDate()), h: p2(d.getHours()), mi: p2(d.getMinutes()), s: p2(d.getSeconds()) };
  }
}

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
  // The System page's "who has the server heard from" — free, because every
  // request already passes through here.
  try { noteSeen(live.id); } catch (e) { /* never at a request's expense */ }
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") {
      noteFinding("refused-role", `${req.user.id} (${req.user.role}) was refused ${req.method} ${req.path} — administrators only.`);
      return res.status(403).json({ error: "Administrators only." });
    }
    next();
  });
}

// One area of the job. A real administrator holds all of them; a delegate holds
// the ones they were named for and nothing else.
function requireArea(scope) {
  return (req, res, next) =>
    requireAdmin(req, res, () => {
      if (req.user.fullAdmin || (req.user.scopes || []).includes(scope)) return next();
      noteFinding("refused-role", `${req.user.id} was refused ${req.method} ${req.path} — the ${scope} area is not one they hold.`);
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
      noteFinding("refused-role", `${req.user.id} (a delegate) was refused ${req.method} ${req.path} — full administrators only.`);
      return res.status(403).json({
        error: "Only an administrator in their own right can do that.",
      });
    }
    next();
  });
}

// Guessing costs time, and so does flooding. ONE limiter implementation for
// both unauthenticated doors — sign-in/claim and the forgot-password ask —
// because the key is whatever a stranger typed, and an unbounded map keyed
// by attacker-chosen strings is a slow out-of-memory on the box the dispatch
// board runs on. Keys are cut to 64 characters, expired records are swept
// once the map grows, and past a hard cap the oldest records go first — a
// deliberate flood pays with its own early keys.
function makeLimiter(max, windowMs) {
  const tries = new Map();
  const CAP = 4000;
  const keyOf = (id) => String(id || "").slice(0, 64);
  const sweep = () => {
    const now = Date.now();
    for (const [k, rec] of tries) {
      if (now - rec.first > windowMs) tries.delete(k);
    }
    while (tries.size > CAP) tries.delete(tries.keys().next().value);
  };
  return {
    blocked(id) {
      const k = keyOf(id);
      const rec = tries.get(k);
      if (!rec) return false;
      if (Date.now() - rec.first > windowMs) {
        tries.delete(k);
        return false;
      }
      return rec.count >= max;
    },
    failed(id) {
      if (tries.size > CAP) sweep();
      const k = keyOf(id);
      const rec = tries.get(k);
      if (!rec || Date.now() - rec.first > windowMs) tries.set(k, { first: Date.now(), count: 1 });
      else rec.count++;
    },
    clear(id) {
      tries.delete(keyOf(id));
    },
  };
}

// Ten wrong answers for one employee ID and that ID stops answering for
// fifteen minutes, whoever is asking.
const loginLimiter = makeLimiter(10, 15 * 60 * 1000);
function loginBlocked(id) {
  return loginLimiter.blocked(id);
}
function loginFailed(id) {
  loginLimiter.failed(id);
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
// Do not advertise the framework in a response header — it hands a scanner a
// free hint and gains nothing. (Pentest INFO-01.)
app.disable("x-powered-by");
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
  // Hardening headers (pentest HDR-01): no MIME sniffing, no framing by other
  // origins, no referrer leaking a board URL. HSTS belongs on nginx, which is
  // where TLS ends.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-backup-token, If-None-Match");
  // ETag is not on the browser's cross-origin safelist, so the native shells
  // (capacitor://localhost, http://localhost) cannot read it without this —
  // and a client that cannot read the ETag downloads the whole archive on
  // every cold poll, which is the exact cost the ETag exists to remove.
  res.setHeader("Access-Control-Expose-Headers", "ETag");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------- not re-sending what a device already holds ----------
//
// Every device cold-polls the whole archive and every filed submission every
// thirty seconds — tens of megabytes that change roughly once a day. At one
// desk that is invisible; at seventy devices it is over a hundred megabytes a
// second of JSON being serialised and pushed through one Node process, and a
// stress test at double the department's real load showed exactly that: cold
// polls queuing up to ninety seconds and the three-second board poll stuck
// behind them.
//
// So a read answers with an ETag and honours If-None-Match: a device that
// already holds the current copy gets a bodiless 304 instead of the megabytes.
// The tag is an in-memory per-key write counter — bumped by every route that
// touches the board table, cleared whole by the bulk paths (reset, restore,
// sync-all) — with the row's own updated_at + byte length as the fallback for
// a key not written since this process started, so tags survive a restart.
// scripts/restore.mjs edits the file offline (the server is down when it
// runs), so an external edit the counter cannot see is not a live case.
const BOOT_ID = crypto.randomBytes(4).toString("hex");
const boardVersions = new Map();
let boardWriteSeq = 0;
let boardGen = 0;
function bumpBoardKey(key) {
  boardVersions.set(key, ++boardWriteSeq);
}
function bumpAllBoardKeys() {
  boardGen += 1;
  boardVersions.clear();
}
function boardEtagFor(key, row) {
  const v = boardVersions.get(key);
  if (v) return `"${BOOT_ID}:v${v}"`;
  return `"g${boardGen}:${row.updated_at}:${Buffer.byteLength(row.value, "utf8")}"`;
}

// ---------- the system watching itself ----------
//
// The owner's System page (GET /api/system) shows what this process knows
// about its own health: how fast each family of request is being answered,
// which devices it has heard from and when, the errors devices reported, and
// the 5xx answers it gave. Counters live in memory on purpose — a restart
// resets them, exactly like the rush meter, and nothing here may cost the
// routes it is watching. Only the device error reports persist (settings
// table): a crash that takes the process down is precisely the error worth
// keeping.
const {
  cleanReport, addReport, addFinding, scrubText, latencyStats, fleetRow,
  silentActiveTrucks, historyAppend, errorBurst, FLEET_STALE_MS,
} = require("./lib/system-health.cjs");
const SYS_START = Date.now();
const PERF_RING = 400;
const perf = new Map(); // group -> { durs: [], n, s304, s5xx }
function perfGroupOf(req) {
  const p = req.path || "";
  if (p === "/api/board" && req.method === "GET") return "board read";
  if (p.startsWith("/api/board")) return "board write";
  if (p.startsWith("/api/auth")) return "sign-in & session";
  if (p.startsWith("/api/")) return "other API";
  return "app & pages";
}
const recent5xx = [];
function record5xx(req, status) {
  recent5xx.unshift({ ts: Date.now(), method: req.method, path: String(req.path || "").slice(0, 80), status });
  if (recent5xx.length > 50) recent5xx.pop();
}
// Who the server has heard from. Keyed by account (every authed request) and
// by device (the app says hello with its build stamp every few minutes) — the
// two together answer "is MEDIC 2's phone alive, and on which build".
const fleetSeen = new Map(); // accountId -> ts
const fleetDevices = new Map(); // deviceId -> { accountId, role, unit, build, platform, lastSeen }
function noteSeen(accountId) {
  fleetSeen.set(accountId, Date.now());
  if (fleetSeen.size > 500) {
    const oldest = [...fleetSeen.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) fleetSeen.delete(oldest[0]);
  }
}
// Device error reports, persisted so a crash that kills the process is still
// on the page after the restart that follows it.
let systemReports = [];
try {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'system_reports'").get();
  systemReports = row ? JSON.parse(row.value) || [] : [];
} catch (e) {
  systemReports = [];
}
function saveSystemReports() {
  try {
    db.prepare("DELETE FROM settings WHERE key = 'system_reports'").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('system_reports', ?)").run(JSON.stringify(systemReports));
  } catch (e) {
    /* the reports feed must never break a request */
  }
}
// Findings: what the server refused or quietly corrected. The ghost-reset
// bug taught this — the worst faults do not error, they are writes the
// server says no to, and it used to say no silently. Every guard that fires
// leaves a note here now, so the System page catches the CLASS, not just
// the instance somebody already debugged.
let systemFindings = [];
try {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'system_findings'").get();
  systemFindings = row ? JSON.parse(row.value) || [] : [];
} catch (e) {
  systemFindings = [];
}
function noteFinding(kind, message) {
  try {
    systemFindings = addFinding(systemFindings, kind, message, Date.now());
    db.prepare("DELETE FROM settings WHERE key = 'system_findings'").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('system_findings', ?)").run(JSON.stringify(systemFindings));
  } catch (e) {
    /* a finding must never break the request it describes */
  }
}

// A rejection nobody caught used to END THE PROCESS - Node exits on one - and
// systemd's restart disguised it as a few seconds of "offline" on every phone,
// with nothing on the System page to say why. Record it where the owner looks
// and carry on. A genuinely unrecoverable throw is recorded too, then exits
// so systemd hands back a clean process rather than one in an unknown state.
process.on("unhandledRejection", (err) => {
  try { noteFinding("server-fault", `Unhandled rejection: ${scrubText(String((err && err.stack) || err), 300)}`); } catch (e) {}
});
process.on("uncaughtException", (err) => {
  try { noteFinding("server-fault", `Uncaught exception (process restarting): ${scrubText(String((err && err.stack) || err), 300)}`); } catch (e) {}
  try { console.error("Uncaught exception:", err); } catch (e) {}
  process.exit(1);
});

// ---------- the page that comes to you ----------
//
// A fault at 02:00 used to wait until the owner opened the System page. The
// few conditions that cannot wait are pushed to the owner's own phone — a
// quiet notification, never the dispatch alarm: a disk warning must not
// sound like a call. Strictly rate-limited per condition, because an owner
// channel that cries wolf gets muted like any other.
const OWNER_ALERT_GAP_MS = 60 * 60 * 1000;
const ownerAlertLast = new Map(); // kind -> ts
function alertOwner(kind, title, body) {
  try {
    if (!pushConfigured()) return;
    const last = ownerAlertLast.get(kind) || 0;
    if (Date.now() - last < OWNER_ALERT_GAP_MS) return;
    ownerAlertLast.set(kind, Date.now());
    const rows = db.prepare("SELECT token FROM push_tokens WHERE account_id = ?").all(RESTORE_OWNER);
    setImmediate(async () => {
      for (const { token } of rows) {
        try {
          const r = await sendOwnerNotice(token, { title, body });
          if (r && r.dead) db.prepare("DELETE FROM push_tokens WHERE token = ?").run(token);
        } catch (e) {
          /* a notice must never become a fault of its own */
        }
      }
    });
  } catch (e) {
    /* never at a request's expense */
  }
}

// A burst of device errors — a deploy gone wrong echoes on every screen at
// once, and that is worth one notice even though each report is listed.
const recentReportTimes = [];
function noteReportTime() {
  recentReportTimes.push(Date.now());
  if (recentReportTimes.length > 200) recentReportTimes.shift();
  if (errorBurst(recentReportTimes, Date.now(), 10 * 60 * 1000, 5)) {
    noteFinding("error-burst", "Five or more device errors inside ten minutes — a bad deploy or a server fault echoing on every screen.");
    alertOwner("error-burst", "PulseOps — error burst", "5+ device errors in 10 minutes. Open Archive → System.");
  }
}

// The watchdog: a silent truck on a live call is the one condition worth
// waking the owner for — a crew that will not hear the stand-down or the
// next message, visible only from the server's side.
const WATCHDOG_EVERY_MS = 60 * 1000;
const WATCHDOG_SILENT_MS = 3 * 60 * 1000;
setInterval(() => {
  try {
    // Not in the first minutes after boot: every account looks silent until
    // its first poll lands, and a restart must not page the owner.
    if (Date.now() - SYS_START < 3 * 60 * 1000) return;
    const row = db.prepare("SELECT value FROM board WHERE key = 'ems:units'").get();
    if (!row) return;
    const units = JSON.parse(row.value);
    for (const hit of silentActiveTrucks(units, fleetSeen, Date.now(), WATCHDOG_SILENT_MS)) {
      noteFinding("silent-truck", `${hit.unit} is on a call and EVERY seated crew phone has been silent for over ${Math.round(hit.silentMs / 60000)} minutes (${hit.seats.join(", ")}).`);
      alertOwner(`silent-truck:${hit.unit}`, "PulseOps — silent truck on a call", `${hit.unit}'s crew phones have gone quiet during an active call.`);
    }
  } catch (e) {
    /* the watchdog itself must never bite */
  }
}, WATCHDOG_EVERY_MS).unref();

// ---------- the server tests itself every night ----------
//
// The page reports what HAPPENED; the self-test files findings for what is
// about to. A corrupt backup should be discovered the day it is written,
// not the day it is needed; a revoked push credential before the 03:00 call
// nobody hears. Results are kept so the page can say "passed, this morning"
// — and each run appends the one small history row per day that lets a
// slow week be seen as a slope instead of a feeling.
let lastSelfTest = null;
try {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'system_selftest'").get();
  lastSelfTest = row ? JSON.parse(row.value) : null;
} catch (e) { lastSelfTest = null; }
let systemHistory = [];
try {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'system_history'").get();
  systemHistory = row ? JSON.parse(row.value) || [] : [];
} catch (e) { systemHistory = []; }

async function runSelfTest(reason) {
  const checks = [];
  const check = (name, ok, note) => checks.push({ name, ok: !!ok, note: note || "" });
  try {
    const r = db.prepare("PRAGMA quick_check").get();
    check("Database integrity", r && (r.quick_check === "ok" || r.integrity_check === "ok"), r && (r.quick_check || r.integrity_check));
  } catch (e) { check("Database integrity", false, e.message); }
  try {
    // Judged INSIDE SQLite (json_valid), never by JSON.parse in this process:
    // pulling a year's archive into the JS heap to prove it parses took the
    // main thread away for seconds and spiked memory to 2 GB — measured under
    // load as a 50-second stall on every phone's poll. Same verdict, no heap.
    const bad = db.prepare("SELECT key FROM board WHERE json_valid(value) = 0").all().map((r) => r.key);
    check("Every board key parses", bad.length === 0, bad.join(", "));
  } catch (e) { check("Every board key parses", false, e.message); }
  try {
    const st = backupState();
    check("Backups are fresh", !st.stale, st.ageMs != null ? `last ${Math.round(st.ageMs / 3600000)}h ago` : "never written");
    const verifyNewest = () => {
      const newest = listBackups(BACKUP_DIR)[0];
      if (!newest) return { ok: false, note: "no backup file found" };
      // Judged against the LIVE board: an empty copy of an empty board is
      // a fresh deployment, not a fault; an empty copy of a working board
      // is exactly the disaster this check exists to find early.
      const v = verifyBackupFile(path.join(BACKUP_DIR, newest.name));
      return {
        ok: v.ok,
        empty: v.empty,
        note: v.error ? `${newest.name} · ${v.error}` : `${newest.name} · ${v.keys} keys (board holds ${v.live})`,
      };
    };
    let v = verifyNewest();
    if (!v.ok && v.empty) {
      // The one honest benign case: the boot backup ran before the board's
      // first key was written (a brand-new deployment's first day). Take a
      // fresh copy and judge THAT — if the backup machinery is genuinely
      // broken, the refreshed copy fails too and the alarm stands.
      await runBackup("self-test refresh");
      v = verifyNewest();
    }
    check("Newest backup opens and holds the board", v.ok, v.note);
  } catch (e) { check("Newest backup opens and holds the board", false, e.message); }
  if (pushConfigured()) {
    const p = await pushProbe();
    check("Push credential still authenticates", p.ok, p.reason || "");
  } else {
    check("Push credential still authenticates", true, "push not configured — skipped");
  }
  try {
    const d = diskUsage();
    check("Disk has headroom", !(d.measured && d.warning), d.measured ? `${d.usedPct}% used` : "not measurable");
  } catch (e) { check("Disk has headroom", false, e.message); }

  lastSelfTest = { at: Date.now(), reason: reason || "scheduled", checks };
  try {
    db.prepare("DELETE FROM settings WHERE key = 'system_selftest'").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('system_selftest', ?)").run(JSON.stringify(lastSelfTest));
  } catch (e) {}
  const failed = checks.filter((c) => !c.ok);
  for (const f of failed) noteFinding("self-test", `Self-test failed: ${f.name}${f.note ? ` (${f.note})` : ""}`);
  if (failed.length) {
    alertOwner("self-test", "PulseOps — self-test failed", failed.map((f) => f.name).join(" · "));
  }

  // The day's history row, appended whenever the daily test runs.
  try {
    const board = perf.get("board read");
    const totalReq = [...perf.values()].reduce((n, e) => n + e.n, 0);
    const total5xx = [...perf.values()].reduce((n, e) => n + e.s5xx, 0);
    const t = opsParts(Date.now());
    const day = `${t.y}-${t.mo}-${t.d}`;
    systemHistory = historyAppend(systemHistory, {
      day,
      requests: totalReq,
      boardP50: board ? latencyStats(board.durs).p50 : 0,
      boardP95: board ? latencyStats(board.durs).p95 : 0,
      serverErrors: total5xx,
      devices: fleetDevices.size,
      dbMb: Math.round(dbFileBytes() / 1048576),
      selfTest: failed.length === 0,
    });
    db.prepare("DELETE FROM settings WHERE key = 'system_history'").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('system_history', ?)").run(JSON.stringify(systemHistory));
  } catch (e) {}
  return lastSelfTest;
}
// Shortly after boot (not ON boot — start-up must stay fast), then daily.
setTimeout(() => { runSelfTest("startup").catch(() => {}); }, 90 * 1000).unref();
// Daily at a QUIET hour, not "24 hours after whenever the process last
// started" — that landed the run at an arbitrary time of day, shift change
// included. 01:00 UTC is 04:00 Riyadh, the emptiest hour the board has.
const SELF_TEST_UTC_HOUR = Number(process.env.SELF_TEST_UTC_HOUR || 1);
const scheduleSelfTest = () => {
  setTimeout(() => {
    runSelfTest("scheduled").catch(() => {});
    scheduleSelfTest();
  }, Math.max(60 * 1000, nextDailyAt(Date.now(), SELF_TEST_UTC_HOUR) - Date.now())).unref();
};
setTimeout(scheduleSelfTest, 0).unref();

// Devices the owner has asked to send a fuller diagnostic on their next
// heartbeat — the crew screen's self-checks, readable without the phone.
const diagWanted = new Set();

app.use((req, res, next) => {
  const t0 = Date.now();
  res.on("finish", () => {
    try {
      const g = perfGroupOf(req);
      let e = perf.get(g);
      if (!e) perf.set(g, (e = { durs: [], n: 0, s304: 0, s5xx: 0 }));
      e.n += 1;
      if (res.statusCode === 304) e.s304 += 1;
      if (res.statusCode >= 500) {
        e.s5xx += 1;
        record5xx(req, res.statusCode);
      }
      e.durs.push(Date.now() - t0);
      if (e.durs.length > PERF_RING) e.durs.shift();
    } catch (err) {
      /* watching must never cost the watched */
    }
  });
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
  if (FORBIDDEN_KEYS.has(key)) {
    noteFinding("probe", `${req.user.id} asked for ${scrubText(key, 40)} through the board API — refused.`);
    return res.status(403).json({ error: "Not available through the board." });
  }
  const row = db.prepare("SELECT value, updated_at FROM board WHERE key = ?").get(key);
  if (!row) return res.json({ value: null });
  const etag = boardEtagFor(key, row);
  res.setHeader("ETag", etag);
  if (req.headers["if-none-match"] === etag) return res.status(304).end();
  // The stored value is already JSON — every write path stringifies before it
  // lands. Parsing forty megabytes of archive only to stringify it straight
  // back was most of what a cold poll cost this process; wrap the text as-is.
  res.type("application/json").send(`{"value":${row.value}}`);
});

app.post("/api/board", requireAuth, (req, res) => {
  const { key, value } = req.body || {};
  if (typeof key !== "string") {
    return res.status(400).json({ error: "Missing key" });
  }
  if (FORBIDDEN_KEYS.has(key)) {
    noteFinding("probe", `${req.user.id} asked for ${scrubText(key, 40)} through the board API — refused.`);
    return res.status(403).json({ error: "Not available through the board." });
  }
  if (!mayWriteKey(req.user, key)) {
    // A screen that offers what the server refuses is a screen that lies —
    // and a refusal here is either that bug, or somebody probing. Say so.
    noteFinding("refused-write", `${req.user.id} tried to write ${key} without the authority for it.`);
    return res.status(403).json({ error: "Only an administrator can change that." });
  }
  // What the requests held before this write, so the push trigger can see
  // which trucks were just handed a call. Read only for that one key.
  let prevRequests = null;
  if (key === "ems:requests") {
    try {
      const row = db.prepare("SELECT value FROM board WHERE key = ?").get(key);
      prevRequests = row ? JSON.parse(row.value) : null;
    } catch (e) {
      prevRequests = null;
    }
  }
  let stored = value ?? null;
  // A settled password request stays settled, whatever a stale device
  // replays — see lib/reset-requests.cjs. When the guard fires, it SAYS so
  // on the System page: a silent correction is how the last ghost hid.
  if (key === "ems:passwordResets" && Array.isArray(stored)) {
    try {
      const row = db.prepare("SELECT value FROM board WHERE key = ?").get(key);
      const current = row ? JSON.parse(row.value) : [];
      const refused = resetReplayCount(current, stored);
      stored = settledResetsHold(current, stored);
      if (refused) {
        noteFinding("stale-device", `A device signed in as ${req.user.id} replayed a password request the board had settled — refused. That device is likely on an old app build and needs the update.`);
      }
    } catch (e) {
      /* an unreadable current list falls back to storing what was sent */
    }
  }
  db.prepare(
    `INSERT INTO board (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(stored));
  bumpBoardKey(key);
  if (key === "ems:requests") pushForRequestsWrite(prevRequests, value);
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
const { settledResetsHold, resetReplayCount } = require("./lib/reset-requests.cjs");
const { ADMIN_SCOPES, DELEGATION_SCOPES, cleanScopes, scopeAllowsKey, scopeSentence } = require("./lib/delegation.cjs");

// ---------- waking a locked phone ----------
//
// A locked Android phone freezes the WebView, the poll stops, and no alarm in
// the app can sound about a call the app never learned of. The server sees
// every write, so the server sends the wake-up: a HIGH-priority FCM push onto
// the dispatch channel, which sounds on the alarm stream through silent. Needs
// FIREBASE_SERVICE_ACCOUNT set (see native/README.md); without it every part
// of this is a no-op and the board behaves exactly as before.
const { newAssignments } = require("./lib/push-triggers.cjs");
const { pushConfigured, sendCallAlert, pushProbe, sendOwnerNotice } = require("./lib/push-fcm.cjs");

db.exec(`
  CREATE TABLE IF NOT EXISTS push_tokens (
    token TEXT PRIMARY KEY,
    account_id TEXT,
    unit_id TEXT,
    station TEXT,
    platform TEXT,
    updated_at INTEGER
  )
`);

// Which phone is riding which truck. Written by the app at sign-on, so the
// push follows the SEAT, not the person's history - a phone whose crew moved
// truck mid-shift re-registers under the new one.
app.post("/api/push/register", requireAuth, (req, res) => {
  const { token, unitId, station, platform } = req.body || {};
  const t = String(token || "").trim();
  if (!t || t.length > 4096) return res.status(400).json({ error: "A device token is required." });
  db.prepare(
    `INSERT INTO push_tokens (token, account_id, unit_id, station, platform, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET account_id = excluded.account_id,
       unit_id = excluded.unit_id, station = excluded.station,
       platform = excluded.platform, updated_at = excluded.updated_at`
  ).run(t, req.user.id, String(unitId || ""), String(station || ""), String(platform || ""), Date.now());
  // A token not renewed in two months belongs to a phone that is gone.
  db.prepare("DELETE FROM push_tokens WHERE updated_at < ?").run(Date.now() - 60 * 86400000);
  res.json({ ok: true, pushConfigured: pushConfigured() });
});

app.post("/api/push/unregister", requireAuth, (req, res) => {
  db.prepare("DELETE FROM push_tokens WHERE token = ?").run(String((req.body || {}).token || ""));
  res.json({ ok: true });
});

// Fired after a requests write commits, never inside it - a push that fails
// must not be able to fail a board write, and a push that is slow must not
// hold one up. PRIVACY: the message names no patient and no route; an MRN on
// a lock screen, relayed through Google, is a disclosure. The details are on
// the board, behind the sign-in, where they belong.
function pushForRequestsWrite(prevList, nextList) {
  if (!pushConfigured()) return;
  let hits;
  try {
    hits = newAssignments(prevList, nextList);
  } catch (e) {
    return;
  }
  if (!hits.length) return;
  setImmediate(async () => {
    for (const hit of hits) {
      let rows = [];
      try {
        rows = db.prepare("SELECT token FROM push_tokens WHERE unit_id = ?").all(hit.unitId);
      } catch (e) {
        rows = [];
      }
      for (const { token } of rows) {
        try {
          const r = await sendCallAlert(token, {
            title: "NEW CALL",
            body: "Your truck has been dispatched. Open the app and acknowledge.",
            data: { kind: "assigned", requestId: hit.requestId, priority: hit.priority },
          });
          if (r && r.dead) db.prepare("DELETE FROM push_tokens WHERE token = ?").run(token);
        } catch (e) {
          // never let a push problem near the board
        }
      }
    }
  });
}

app.post("/api/board/records", requireAuth, (req, res) => {
  const { key } = req.body || {};
  if (typeof key !== "string") return res.status(400).json({ error: "Missing key" });
  if (FORBIDDEN_KEYS.has(key)) {
    noteFinding("probe", `${req.user.id} asked for ${scrubText(key, 40)} through the board API — refused.`);
    return res.status(403).json({ error: "Not available through the board." });
  }
  if (!mayWriteKey(req.user, key)) {
    // A screen that offers what the server refuses is a screen that lies —
    // and a refusal here is either that bug, or somebody probing. Say so.
    noteFinding("refused-write", `${req.user.id} tried to write ${key} without the authority for it.`);
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
  let prevRequests = null;
  try {
    merged = db.transaction(() => {
      const row = db.prepare("SELECT value FROM board WHERE key = ?").get(key);
      const current = row ? JSON.parse(row.value) : null;
      if (key === "ems:requests") prevRequests = current;
      // A key that holds a list cannot be merged with a map, or the other way
      // round. The client is told so and falls back to writing the key whole.
      if (current !== null && current !== undefined) {
        if (wantsList && !Array.isArray(current)) return "SHAPE";
        if (wantsMap && (Array.isArray(current) || typeof current !== "object")) return "SHAPE";
      }
      let next = mergeRecordsInto(current, body);
      if (next === null) return "SHAPE";
      // A settled password request stays settled, whatever a stale device
      // replays — see lib/reset-requests.cjs. The guard reports itself: a
      // silent correction is how the last ghost hid.
      if (key === "ems:passwordResets" && Array.isArray(next)) {
        const cur = Array.isArray(current) ? current : [];
        const refused = resetReplayCount(cur, next);
        next = settledResetsHold(cur, next);
        if (refused) {
          noteFinding("stale-device", `A device signed in as ${req.user.id} replayed a password request the board had settled — refused. That device is likely on an old app build and needs the update.`);
        }
      }
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
    // A client and the board disagreeing on a key's shape is a version
    // mismatch talking — usually a device on an old build.
    noteFinding("shape-mismatch", `${req.user.id} sent a ${key} write in a shape the board refused — a device on an old build?`);
    return res.status(409).json({ error: "That key does not hold records of this shape.", shape: true });
  }
  bumpBoardKey(key);
  // A call that just landed on a truck wakes that truck's phone, even locked —
  // fired after the write has committed, and never able to fail it.
  if (key === "ems:requests") pushForRequestsWrite(prevRequests, merged);
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
// Every copy is kept as a daily for the whole window — the weekly thinning
// tier is gone. Ninety days of dailies replaces 30 daily + 12 weekly.
const BACKUP_KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || process.env.BACKUP_KEEP_DAILY || 90);
// The daily runs just after the 07:00 operational boundary (04:00 UTC), so
// the copy always holds a complete, closed operational day.
const BACKUP_DAILY_UTC_HOUR = Number(process.env.BACKUP_DAILY_UTC_HOUR || 4);
const {
  TEMP_EVERY_MS, TEMP_CAP, tempName, isTempName, tempsToClear, tempsOverCap,
  backupClearsTemps, backupsBeyondDays, nextDailyAt,
} = require("./lib/backup-tiers.cjs");

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
  const t = opsParts(at);
  const stem = `board-${t.y}${t.mo}${t.d}-${t.h}${t.mi}${t.s}`;
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

// Keep every backup, as a daily, for BACKUP_KEEP_DAYS days. There is no
// weekly thinning any more — the department chose a shorter window of full
// dailies over a longer one that degrades, and the year-end archive (not the
// backup folder) is where long history belongs.
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
  const stale = backupsBeyondDays(
    listBackups(dir).map((b) => ({ name: b.name, at: new Date(b.at).getTime() })),
    BACKUP_KEEP_DAYS,
    Date.now()
  );
  for (const name of stale) {
    try { fs.unlinkSync(path.join(dir, name)); } catch (e) { /* already gone */ }
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

// A copy is judged by opening it: integrity, and a board that is not empty
// while the live one has keys. Shared by the daily self-test and by the
// verified-daily gate that clears the temporary tier.
function verifyBackupFile(file) {
  try {
    const copy = new Database(file, { readonly: true });
    try {
      const q = copy.prepare("PRAGMA quick_check").get();
      const n = copy.prepare("SELECT COUNT(*) AS n FROM board").get().n;
      const live = db.prepare("SELECT COUNT(*) AS n FROM board").get().n;
      return { ok: !!(q && q.quick_check === "ok" && (n > 0 || live === 0)), empty: n === 0 && live > 0, keys: n, live };
    } finally {
      copy.close();
    }
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// ---------- the temporary tier ----------
//
// A copy every thirty minutes, so a midday disaster costs half an hour, not a
// day. Temps live in their own folder under their own `temp-` prefix, so the
// restore picker, the download route and sync-all — all of which match
// `board-` — can never see one. They are deleted ONLY by a daily copy that
// verifyBackupFile has judged healthy; the rules are lib/backup-tiers.cjs,
// under npm test.
const TEMP_DIR = path.join(BACKUP_DIR, "temp");

function listTemps() {
  try {
    return fs
      .readdirSync(TEMP_DIR)
      .filter(isTempName)
      .map((f) => {
        const st = fs.statSync(path.join(TEMP_DIR, f));
        return { name: f, at: st.mtimeMs, bytes: st.size };
      })
      .sort((a, b) => b.at - a.at);
  } catch (e) {
    return [];
  }
}

function clearTempsThrough(verifiedAt) {
  for (const name of tempsToClear(listTemps(), verifiedAt)) {
    try { fs.unlinkSync(path.join(TEMP_DIR, name)); } catch (e) { /* already gone */ }
  }
}

let lastTempBackup = null;

async function runTempBackup() {
  try {
    // A full disk is the one way this tier could hurt the live app, so the
    // tier is what yields first — and says so where the owner looks.
    const d = diskUsage();
    if (d.measured && d.warning) {
      noteFinding("backup", "Temporary backup skipped: disk usage is over the warning threshold");
      return null;
    }
    const at = Date.now();
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    let name = tempName(at);
    for (let n = 2; fs.existsSync(path.join(TEMP_DIR, name)); n++) {
      name = tempName(at).replace(/\.db$/, `-${n}.db`);
    }
    const dest = path.join(TEMP_DIR, name);
    await db.backup(dest);
    settleBackupFile(dest);
    lastTempBackup = { name, at: new Date(at).toISOString() };
    // The cap only fills while dailies keep failing to verify — worth a
    // finding of its own, on top of the self-test's stale-backup alarm.
    const over = tempsOverCap(listTemps(), TEMP_CAP);
    if (over.length) {
      noteFinding("backup", "Temporary backups are over their cap — the daily backup may be failing");
      for (const n of over) {
        try { fs.unlinkSync(path.join(TEMP_DIR, n)); } catch (e) { /* already gone */ }
      }
    }
    return lastTempBackup;
  } catch (e) {
    noteFinding("backup", `Temporary backup failed: ${String(e.message || e)}`);
    return null;
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
  // The temporary tier is cleared ONLY here, and only by a copy that has been
  // opened and judged healthy — a corrupt daily must not delete the very
  // copies that could still save the day. The safety copies taken before a
  // restore or a sync never clear temps: they precede a rewrite of the board,
  // and the temps beside them are the record of what is about to be rewritten.
  let verified = false;
  if (written.length) {
    const v = verifyBackupFile(path.join(BACKUP_DIR, name));
    verified = !!v.ok;
    if (!verified) {
      noteFinding("backup", `Backup ${name} failed verification — temporary copies kept`);
    } else if (backupClearsTemps(reason)) {
      clearTempsThrough(at);
    }
  }
  let bytes = 0;
  try { bytes = fs.statSync(path.join(BACKUP_DIR, name)).size; } catch (e) { /* first copy failed */ }
  lastBackup = { name, at: new Date(at).toISOString(), reason, bytes, written, failed, verified };
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
    keepDays: BACKUP_KEEP_DAYS,
    temp: (() => {
      const temps = listTemps();
      return {
        count: temps.length,
        totalBytes: temps.reduce((n, t) => n + t.bytes, 0),
        last: lastTempBackup,
        everyMs: TEMP_EVERY_MS,
      };
    })(),
  };
}

// ---------- the restore window ----------
//
// Taking a copy is safe and stays open to anyone holding the archive area.
// Putting one BACK rewrites the department's record, and that belongs to the
// owner account alone: a delegate restores only inside a window the owner has
// opened, and the window closes on its own. The policy is in
// lib/restore-guard.cjs, under npm test; the window itself lives in
// `settings`, not on the board — it is a permission, and permissions live
// where the server checks them.
const { RESTORE_OWNER, RESTORE_APPROVAL_TTL_MS, mayOpenRestoreWindow, mayRestore, ownerAccountRefusal } = require("./lib/restore-guard.cjs");

function restoreApproval() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'restore_approval'").get();
  if (!row) return null;
  try {
    const a = JSON.parse(row.value);
    return a && Number(a.expiresAt) > Date.now() ? a : null;
  } catch (e) {
    return null;
  }
}
function setRestoreApproval(a) {
  db.prepare("DELETE FROM settings WHERE key = 'restore_approval'").run();
  if (a) db.prepare("INSERT INTO settings (key, value) VALUES ('restore_approval', ?)").run(JSON.stringify(a));
}
function restoreStatusFor(user) {
  const a = restoreApproval();
  return {
    owner: RESTORE_OWNER,
    isOwner: mayOpenRestoreWindow(user),
    allowed: mayRestore(user, a, Date.now()),
    window: a ? { expiresAt: a.expiresAt, openedBy: a.openedBy } : null,
  };
}

// Only the owner opens or closes the window. `stop` closes it early —
// revocation should never have to wait out its own timer.
app.post("/api/backups/allow-restore", requireArea("archive"), (req, res) => {
  if (!mayOpenRestoreWindow(req.user)) {
    noteFinding("owner-power", `${req.user.id} tried to open or close the restore window — only ${RESTORE_OWNER} may.`);
    return res.status(403).json({ error: `Only ${RESTORE_OWNER} can open or close the restore window.` });
  }
  if ((req.body || {}).stop) {
    setRestoreApproval(null);
  } else {
    setRestoreApproval({
      openedBy: req.user.id,
      openedAt: Date.now(),
      expiresAt: Date.now() + RESTORE_APPROVAL_TTL_MS,
    });
  }
  res.json({ ok: true, restore: restoreStatusFor(req.user) });
});

// ---------- the fresh start ----------
//
// Two moments need a clean slate: the day the pilot starts, and the day it
// goes live. Everything WORKED is erased — calls, logs, archives, filed
// shifts, overtime, messages, the coverage record — and every backup with it,
// because the copies hold the trial's patient MRNs and sync-all would drag
// them straight back. Everything CONFIGURED survives: accounts and passwords
// (their own table, untouched), policies, checklists, the inventory
// definitions, and the fleet as names — trucks and stations are setup, but
// seats, statuses and assigned calls are the trial's data.
//
// Owner only, like restores, and NOT delegable — mayOpenRestoreWindow is the
// same test the restore window uses, and no delegate passes it. The typed
// word is the second lock: a button this destructive must not be one
// mis-tap from firing.
app.post("/api/reset-board", requireArea("archive"), (req, res) => {
  if (!mayOpenRestoreWindow(req.user)) {
    noteFinding("owner-power", `${req.user.id} tried to RESET THE BOARD — only ${RESTORE_OWNER} may.`);
    return res.status(403).json({ error: `Only ${RESTORE_OWNER} can reset the board, and it cannot be delegated.` });
  }
  if (String((req.body || {}).confirm || "") !== "RESET") {
    return res.status(400).json({ error: "Type RESET in capitals to confirm — this erases the board and every backup." });
  }
  const KEEP = new Set(["ems:policies", "ems:checklists", "ems:inventory", "ems:fleetSeeded", "ems:units"]);
  let removedKeys = 0;
  let fleetKept = 0;
  db.transaction(() => {
    for (const row of db.prepare("SELECT key FROM board").all()) {
      if (KEEP.has(row.key)) continue;
      db.prepare("DELETE FROM board WHERE key = ?").run(row.key);
      removedKeys += 1;
    }
    const urow = db.prepare("SELECT value FROM board WHERE key = 'ems:units'").get();
    if (urow) {
      try {
        const units = JSON.parse(urow.value);
        const clean = (Array.isArray(units) ? units : [])
          .filter((u) => u && u.id)
          .map((u) => ({ id: u.id, name: u.name || "", station: u.station || null, status: "oos" }));
        fleetKept = clean.length;
        db.prepare("UPDATE board SET value = ?, updated_at = datetime('now') WHERE key = 'ems:units'")
          .run(JSON.stringify(clean));
      } catch (e) {
        // An unreadable fleet is removed rather than kept broken.
        db.prepare("DELETE FROM board WHERE key = 'ems:units'").run();
      }
    }
    // Trial phones re-register the next time somebody signs on.
    db.prepare("DELETE FROM push_tokens").run();
    db.prepare("DELETE FROM settings WHERE key = 'restore_approval'").run();
  })();
  bumpAllBoardKeys();
  let backupsDeleted = 0;
  for (const dir of [BACKUP_DIR, BACKUP_DIR_2].filter(Boolean)) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!/^(board-|before-restore-).*\.db$/.test(f)) continue;
        try {
          fs.unlinkSync(path.join(dir, f));
          backupsDeleted += 1;
        } catch (e) {
          /* a copy that will not delete is reported by the count */
        }
      }
    } catch (e) {
      /* the second dir may be an unplugged drive */
    }
  }
  // The temporary tier holds the same MRNs as any backup and goes with them.
  try {
    for (const f of fs.readdirSync(TEMP_DIR)) {
      if (!isTempName(f)) continue;
      try {
        fs.unlinkSync(path.join(TEMP_DIR, f));
        backupsDeleted += 1;
      } catch (e) { /* reported by the count */ }
    }
  } catch (e) {
    /* no temp folder yet */
  }
  console.log(
    `BOARD RESET by ${req.user.id}: ${removedKeys} keys erased, ` +
      `fleet kept as names (${fleetKept} trucks), ${backupsDeleted} backup file(s) deleted`
  );
  res.json({ ok: true, removedKeys, fleetKept, backupsDeleted, kept: [...KEEP] });
});

// Administrators only, both of them. The listing names the copies, and those
// names are what the restore routes are addressed by; the other lets anyone
// who can reach the server fill its disk with snapshots.
app.get("/api/backups", requireArea("archive"), (req, res) => {
  res.json({ ok: true, ...backupState(), copies: listBackups(BACKUP_DIR), restore: restoreStatusFor(req.user) });
});

app.post("/api/backups", requireArea("archive"), async (req, res) => {
  try {
    const state = await runBackup("on demand");
    res.json({ ok: !!state.written.length, ...state });
  } catch (e) {
    // A full disk or a lost mount must be a recorded refusal, not a crash.
    noteFinding("backup", `An on-demand backup failed: ${scrubText(String((e && e.message) || e), 200)}`);
    res.status(500).json({ error: "The backup could not be written. It has been recorded." });
  }
});

// Deliberately token-gated, and absent entirely when no token is set. This
// route hands over every patient record the department holds.
// A download link cannot carry a header, so the panel used to put the token in
// the URL - and a long-lived secret in a URL is a secret in the access log,
// where anyone who can read nginx's log holds the key to every MRN on the
// board. (Pentest FILE-03.) The panel now asks for a TICKET first, sending
// the token in a POST body: sixty seconds, one use, one named file, minted
// only for somebody who holds the archive area AND the token - the same two
// things the download always needed. pull-backup.mjs keeps sending the header.
const downloadTickets = new Map();
function mintDownloadTicket(name) {
  for (const [t, v] of downloadTickets) if (v.exp < Date.now()) downloadTickets.delete(t);
  const t = crypto.randomBytes(24).toString("base64url");
  downloadTickets.set(t, { name, exp: Date.now() + 60 * 1000 });
  return t;
}
function spendDownloadTicket(t, name) {
  const key = String(t || "");
  const v = downloadTickets.get(key);
  if (!v) return false;
  downloadTickets.delete(key);
  return v.exp >= Date.now() && v.name === name;
}
// Constant-time, like every other secret this file compares.
function backupTokenMatches(given) {
  const a = Buffer.from(String(given || "")); const b = Buffer.from(BACKUP_TOKEN);
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
// A copy's name is taken apart and rebuilt rather than trusted - "../../etc/
// passwd" is a path, not a backup - and a same-second collision suffix
// (backupName's "-2") is a valid name too.
const BACKUP_NAME_RE = /^board-\d{8}-\d{4,6}(-\d+)?\.db$/;

app.post("/api/backups/:name/ticket", requireArea("archive"), (req, res) => {
  if (!BACKUP_TOKEN) return res.status(404).json({ error: "Backup download is not enabled on this server." });
  if (!backupTokenMatches((req.body || {}).token)) {
    noteFinding("probe", `${req.user.id} asked for a backup download ticket with a wrong or missing token.`);
    return res.status(403).json({ error: "Wrong or missing backup token." });
  }
  const name = path.basename(String(req.params.name));
  if (!BACKUP_NAME_RE.test(name)) return res.status(400).json({ error: "Not a backup name." });
  if (!fs.existsSync(path.join(BACKUP_DIR, name))) return res.status(404).json({ error: "No such backup." });
  res.json({ ok: true, ticket: mintDownloadTicket(name), expiresInMs: 60 * 1000 });
});

app.get("/api/backups/:name", (req, res) => {
  if (!BACKUP_TOKEN) {
    return res.status(404).json({ error: "Backup download is not enabled on this server." });
  }
  const name = path.basename(String(req.params.name));
  if (!BACKUP_NAME_RE.test(name)) return res.status(400).json({ error: "Not a backup name." });
  const byHeader = backupTokenMatches(req.get("x-backup-token"));
  const byTicket = !byHeader && spendDownloadTicket(req.query.ticket, name);
  if (!byHeader && !byTicket) {
    noteFinding("probe", `A download of ${scrubText(name, 40)} was refused — wrong or missing token or ticket.`);
    return res.status(403).json({ error: "Wrong or missing backup token." });
  }
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
  if (!BACKUP_NAME_RE.test(name) && !/^before-restore-[0-9]{8,}\.db$/.test(name)) {
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
  // Additive, but still a write to the record from copies — inside the
  // restore window like any other put-back.
  if (!mayRestore(req.user, restoreApproval(), Date.now())) {
    noteFinding("owner-power", `${req.user.id} tried ${req.method} ${req.path} without the restore window open — refused.`);
    return res.status(403).json({
      error: `Putting data back belongs to ${RESTORE_OWNER}. Taking copies is yours any time; ask them to open the restore window and try again.`,
    });
  }
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
  for (const w of work) bumpBoardKey(w.key);

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
  // The one route that rewrites the record from a copy. Owner, or a delegate
  // inside the window the owner opened — see lib/restore-guard.cjs.
  if (!mayRestore(req.user, restoreApproval(), Date.now())) {
    noteFinding("owner-power", `${req.user.id} tried ${req.method} ${req.path} without the restore window open — refused.`);
    return res.status(403).json({
      error: `Putting data back belongs to ${RESTORE_OWNER}. Taking copies is yours any time; ask them to open the restore window and try again.`,
    });
  }
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
  for (const k of keys) bumpBoardKey(k);

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

// ---------- the owner's own way back in ----------
//
// Nobody else may clear the owner's password (ownerAccountRefusal) — which
// means a forgotten owner password needs a path that does not run through
// another administrator. This is it: set OWNER_RESCUE=1 in the environment
// and restart, and a fresh one-time sign-in code for the owner account is
// printed to the server log. Reaching the environment and the log takes the
// hosting dashboard, which only the service operator holds — the same trust
// the original bootstrap code rests on. Unset the variable afterwards; while
// it is set, every restart prints (and replaces) a code.
function ownerRescue() {
  if (!process.env.OWNER_RESCUE) return;
  const acct = findAccount(RESTORE_OWNER);
  if (!acct) return;
  db.prepare("UPDATE accounts SET pw_salt = NULL, pw_hash = NULL, legacy_hash = NULL WHERE id = ?").run(acct.id);
  const code = issueClaimCode(acct.id);
  console.log("");
  console.log("  ┌──────────────────────────────────────────────────────────┐");
  console.log("  │  OWNER RESCUE (OWNER_RESCUE is set)                      │");
  console.log(`  │  Employee ID    ${RESTORE_OWNER}${" ".repeat(41 - RESTORE_OWNER.length)}│`);
  console.log(`  │  Sign-in code   ${code}${" ".repeat(41 - code.length)}│`);
  console.log("  │  The old password is cleared. Sign in, set a new one,    │");
  console.log("  │  then REMOVE the OWNER_RESCUE variable.                  │");
  console.log("  └──────────────────────────────────────────────────────────┘");
  console.log("");
}
ownerRescue();

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
    // Ten wrong guesses in fifteen minutes is either a forgotten password
    // or somebody working through IDs. Either way the owner should know it
    // happened without reading the deploy log. The ID is a stranger's typed
    // text — bounded before it is kept.
    noteFinding("sign-in-limiter", `The sign-in limiter tripped for ID "${scrubText(key, 20)}" — ten wrong tries in fifteen minutes.`);
    return res.status(429).json({ error: "Too many attempts. Try again in fifteen minutes." });
  }
  const acct = findAccount(key);
  // The same answer either way, so this cannot be used to find out which
  // employee IDs exist.
  if (!acct || !checkPassword(acct, password)) {
    loginFailed(key);
    return res.status(401).json({ error: "That employee ID and password do not match." });
  }
  loginLimiter.clear(key);
  const fresh = findAccount(key);
  // isOwner is stamped here and on /api/auth/me — NOT on publicAccount, which
  // /api/auth/lookup serves to anybody. The session uses it to draw the
  // owner's System tile; the server still refuses everyone else regardless.
  res.json({
    ok: true,
    token: issueToken(fresh),
    account: { ...publicAccount(fresh), ...(fresh.id === RESTORE_OWNER ? { isOwner: true } : {}) },
  });
});

// Changing your own password, while signed in. The current password is the
// proof — the token alone must not be enough, or a tablet left unlocked at
// the station lets anyone quietly re-key an account they can already act as.
// It runs under the same limiter as sign-in, so the current password cannot
// be worked through from a signed-in device either. The token is not tied to
// the hash, so the session carries on; other devices holding this account
// stay signed in too, which is right — changing a password is not a sign-out.
app.post("/api/auth/change-password", requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  const key = req.user.id;
  if (loginBlocked(key)) {
    return res.status(429).json({ error: "Too many attempts. Try again in fifteen minutes." });
  }
  const acct = findAccount(key);
  if (!acct) return res.status(401).json({ error: "That account no longer exists." });
  if (!checkPassword(acct, current)) {
    loginFailed(key);
    return res.status(403).json({ error: "Your current password is not right." });
  }
  if (!next || String(next).length < 4) {
    return res.status(400).json({ error: "Choose a new password of at least four characters." });
  }
  loginLimiter.clear(key);
  setPassword(acct.id, next);
  res.json({ ok: true });
});

// Who this device is signed in as, as the SERVER sees it right now.
//
// A session is written once, at sign-in, and then lives in localStorage for the
// length of a shift. Authority does not: an administrator can lend an area at
// 22:00 to somebody who signed on at 19:00, and can take it back at 02:00. The
// app had no way to hear about either — the lent-area tag beside the
// dispatcher's name and the button that moves them into that area both read
// off the session, so a delegation made after sign-in simply never appeared,
// and one revoked stayed on screen until they signed out.
//
// Cheap enough to sit on the slow poll: one row, re-read the way every other
// request already re-reads it.
app.get("/api/auth/me", requireAuth, (req, res) => {
  const live = findAccount(req.user.id);
  if (!live) return res.status(401).json({ error: "That account no longer exists." });
  res.json({
    ok: true,
    account: { ...publicAccount(live), ...(live.id === RESTORE_OWNER ? { isOwner: true } : {}) },
    acting: req.user.act || live.role,
    scopes: req.user.scopes || [],
  });
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
    noteFinding("refused-role", `${req.user.id} asked to act as "${scrubText(want, 20)}" — a role they do not hold.`);
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
    account: { ...publicAccount(live), ...(live.id === RESTORE_OWNER ? { isOwner: true } : {}) },
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
  loginLimiter.clear(key);
  setPassword(acct.id, password);
  // Spent. A code opens an account once.
  clearClaimCode(acct.id);
  const fresh = findAccount(acct.id);
  res.json({
    ok: true,
    token: issueToken(fresh),
    // The same owner mark the login answer carries — claiming the bootstrap
    // account IS the owner's first sign-in, and a session built here must
    // draw the System tile like any other.
    account: { ...publicAccount(fresh), ...(fresh.id === RESTORE_OWNER ? { isOwner: true } : {}) },
  });
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
//
// Its own counter, apart from the login one — sharing meant pressing "Forgot
// password" burned sign-in attempts, and the person who had just failed ten
// times (exactly who this route exists for) was answered 429 and never
// recorded. Same bounded implementation as the login limiter; a handful of
// asks per quarter hour is plenty for a human and useless for a flood, and
// the dedupe below caps the damage at one row per real account regardless.
const forgotLimiter = makeLimiter(5, 15 * 60 * 1000);

app.post("/api/auth/forgot", (req, res) => {
  const { id, name } = req.body || {};
  const key = String(id || "").trim().toUpperCase();
  if (!key) return res.status(400).json({ error: "Give your employee ID." });
  if (forgotLimiter.blocked(key)) {
    return res.status(429).json({ error: "Too many attempts. Wait a few minutes and try once." });
  }
  forgotLimiter.failed(key);
  const acct = findAccount(key);
  // Answered IDENTICALLY whether or not the account exists, and whether or
  // not a request was already waiting. This route answers strangers, and
  // either fact — the ID is real, or its owner is mid-reset and about to be
  // handed a one-time code — is something a stranger must not learn here.
  // The dedupe still happens; the panel simply never shows one person twice.
  if (acct) {
    const row = db.prepare("SELECT value FROM board WHERE key = 'ems:passwordResets'").get();
    const list = row ? JSON.parse(row.value) || [] : [];
    // ONE vocabulary. This route used to write `status: "open"` while the app
    // wrote and read `status: "pending"` — two dedupe checks each blind to the
    // other's word, and the panel showing both rows. "open" is still honoured
    // on the way in so requests recorded by older builds cannot hide, and the
    // id comparison matches the panel's: case-insensitively, because the key
    // is board-writable and a mixed-case row must not defeat the check.
    const already = list.some(
      (r) =>
        r &&
        String(r.accountId || "").toUpperCase() === acct.id &&
        (r.status === "pending" || r.status === "open")
    );
    if (!already) {
      const now = Date.now();
      list.unshift({
        id: `pwr_${now.toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
        accountId: acct.id,
        // Bounded: this route answers strangers, and an account with no name
        // of its own must not let a caller pour megabytes into a board key
        // every admin device downloads on the cold poll.
        name: acct.name || String(name || "").slice(0, 80),
        role: acct.role,
        ts: now,
        at: now,
        status: "pending",
      });
      db.prepare(
        `INSERT INTO board (key, value, updated_at) VALUES ('ems:passwordResets', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(JSON.stringify(list.slice(0, 200)));
      bumpBoardKey("ems:passwordResets");
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
      // The roster draws the owner row without Remove or Clear password —
      // the server refuses those regardless (ownerAccountRefusal), but a
      // button that can only ever answer 403 is a button that lies.
      ...(r.id === RESTORE_OWNER ? { isOwner: true } : {}),
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
  // The owner account answers only to itself, and can never stop being an
  // administrator — see ownerAccountRefusal in lib/restore-guard.cjs.
  const refusal = ownerAccountRefusal(req.user.id, key, role !== "admin" ? "demote" : "edit");
  if (refusal) {
    noteFinding("owner-power", `${req.user.id}: ${refusal}`);
    return res.status(403).json({ error: refusal });
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
  // Deleting the owner would take the restore, sync-all and reset authority
  // with it. Nobody removes that account, the owner included.
  const refusal = ownerAccountRefusal(req.user.id, key, "delete");
  if (refusal) {
    noteFinding("owner-power", `${req.user.id}: ${refusal}`);
    return res.status(403).json({ error: refusal });
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
  // Clearing the owner's password hands back a sign-in code — which is the
  // whole account, and with it restores and the reset. Only the owner may do
  // that to themselves; a locked-out owner recovers through OWNER_RESCUE on
  // the server, never through another administrator.
  const refusal = ownerAccountRefusal(req.user.id, key, "clear-password");
  if (refusal) {
    noteFinding("owner-power", `${req.user.id}: ${refusal}`);
    return res.status(403).json({ error: refusal });
  }
  db.prepare("UPDATE accounts SET pw_salt = NULL, pw_hash = NULL, legacy_hash = NULL WHERE id = ?").run(key);
  const code = issueClaimCode(key);
  res.json({ ok: true, code, expiresAt: Date.now() + CLAIM_TTL_MS });
});

// ---------- the owner's System page ----------
//
// Owner only, like the reset — this maps the fleet, lists every fault a
// device reported, and shows how the server is coping. It is read when the
// page is OPENED, never on a poll: watching the system must not be a load on
// the system.
function requireOwner(req, res, next) {
  requireAuth(req, res, () => {
    if (!mayOpenRestoreWindow(req.user)) {
      noteFinding("owner-power", `${req.user.id} tried to open the System page — it belongs to ${RESTORE_OWNER} alone.`);
      return res.status(403).json({ error: `That page belongs to ${RESTORE_OWNER} alone.` });
    }
    next();
  });
}

// Any signed-in device may say hello — it is how the fleet table learns which
// build a phone runs and which truck it rides. The app sends one every few
// minutes; the map is capped so a churn of devices cannot grow it forever.
app.post("/api/system/hello", requireAuth, (req, res) => {
  const b = req.body || {};
  const deviceId = String(b.deviceId || "").slice(0, 40);
  if (deviceId) {
    // What the device is still holding unsent. The ghost lived in exactly
    // this queue — a record held for hours is a device fighting the board.
    const heldWrites = Math.max(0, Math.min(9999, Number(b.heldWrites) || 0));
    const heldOldestMs = Math.max(0, Number(b.heldOldestMs) || 0);
    fleetDevices.set(deviceId, {
      accountId: req.user.id,
      role: String(b.role || req.user.role || "").slice(0, 20),
      unit: String(b.unit || "").slice(0, 40),
      build: String(b.build || "").slice(0, 40),
      platform: String(b.platform || "web").slice(0, 20),
      heldWrites,
      heldOldestMs,
      // A fuller self-check the owner asked this device for, kept as sent
      // (bounded) until the next hello replaces it.
      ...(b.diagnostics && typeof b.diagnostics === "object"
        ? { diagnostics: JSON.parse(JSON.stringify(b.diagnostics, (k, v) =>
            typeof v === "string" ? String(v).slice(0, 120) : v).slice(0, 2000)) }
        : (fleetDevices.get(deviceId) || {}).diagnostics
        ? { diagnostics: fleetDevices.get(deviceId).diagnostics }
        : {}),
      lastSeen: Date.now(),
    });
    if (heldWrites > 0 && heldOldestMs > 60 * 60 * 1000) {
      noteFinding("stuck-queue", `${req.user.id}'s device has been holding ${heldWrites} unsent record(s) for over an hour — it is fighting the board or cannot reach it.`);
    }
    // The owner asked this device for its diagnostics: tell it once.
    if (diagWanted.has(deviceId) && !(b.diagnostics && typeof b.diagnostics === "object")) {
      diagWanted.delete(deviceId);
      return res.json({ ok: true, sendDiagnostics: true });
    }
    if (fleetDevices.size > 300) {
      const oldest = [...fleetDevices.entries()].sort((a, b2) => a[1].lastSeen - b2[1].lastSeen)[0];
      if (oldest) fleetDevices.delete(oldest[0]);
    }
  }
  res.json({ ok: true });
});

// A device reporting its own fault. Rate-limited per account so a looping
// page cannot flood, scrubbed and capped before it is kept (system-health.cjs),
// and persisted — a crash that takes the process down is exactly the error
// worth still having after the restart.
const reportLimiter = makeLimiter(15, 10 * 60 * 1000);
app.post("/api/system/report", requireAuth, (req, res) => {
  if (reportLimiter.blocked(req.user.id)) return res.json({ ok: true, held: true });
  reportLimiter.failed(req.user.id);
  const rep = cleanReport(req.body, Date.now());
  if (rep) {
    rep.by = req.user.id;
    systemReports = addReport(systemReports, rep);
    saveSystemReports();
    noteReportTime();
  }
  res.json({ ok: true });
});

app.get("/api/system", requireOwner, (req, res) => {
  const now = Date.now();
  const names = new Map(
    db.prepare("SELECT id, name FROM accounts").all().map((r) => [r.id, r.name])
  );
  const devices = [...fleetDevices.entries()]
    .map(([deviceId, d]) => fleetRow({ deviceId, ...d, name: names.get(d.accountId) || d.accountId }, now))
    .sort((a, b) => a.silentMs - b.silentMs);
  const accountsSeen = [...fleetSeen.entries()]
    .map(([id, ts]) => fleetRow({ accountId: id, name: names.get(id) || id, lastSeen: ts }, now))
    .sort((a, b) => a.silentMs - b.silentMs);
  const traffic = [...perf.entries()].map(([group, e]) => ({
    group, requests: e.n, notModified: e.s304, serverErrors: e.s5xx, ...latencyStats(e.durs),
  })).sort((a, b) => b.requests - a.requests);
  let pushTokens = 0;
  let pushTokensStale = 0;
  try {
    pushTokens = db.prepare("SELECT COUNT(*) AS n FROM push_tokens").get().n;
    pushTokensStale = db.prepare("SELECT COUNT(*) AS n FROM push_tokens WHERE updated_at < ?").get(Date.now() - 60 * 86400000).n;
  } catch (e) {}
  const keys = db.prepare("SELECT key, length(value) AS bytes, updated_at FROM board ORDER BY length(value) DESC").all();
  res.json({
    ok: true,
    now,
    server: {
      startedAt: SYS_START,
      uptimeMs: now - SYS_START,
      node: process.version,
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      pushConfigured: pushConfigured(),
      pushTokens,
      pushTokensStale,
    },
    selfTest: lastSelfTest,
    history: systemHistory,
    database: { path: DB_PATH, survivesRedeploy: DB_IS_PERSISTENT, fileBytes: dbFileBytes() },
    disk: diskUsage(),
    backups: backupState(),
    boardKeys: keys.slice(0, 12),
    boardBytes: keys.reduce((n, k) => n + (k.bytes || 0), 0),
    restore: restoreStatusFor(req.user),
    traffic,
    recent5xx,
    reports: systemReports,
    findings: systemFindings,
    devices,
    accountsSeen,
    staleAfterMs: FLEET_STALE_MS,
  });
});

// Run the nightly checks right now — after fixing something, waiting until
// tomorrow to know is silly.
app.post("/api/system/self-test", requireOwner, async (req, res) => {
  try {
    res.json({ ok: true, selfTest: await runSelfTest("on demand") });
  } catch (e) {
    res.status(500).json({ error: `The self-test itself failed: ${e.message}` });
  }
});

// The fix-it half of the token row: tokens not renewed in two months belong
// to phones that are gone, and pruning them is always safe — a live phone
// re-registers at its next sign-on.
app.post("/api/system/prune-tokens", requireOwner, (req, res) => {
  const gone = db.prepare("DELETE FROM push_tokens WHERE updated_at < ?").run(Date.now() - 60 * 86400000).changes;
  res.json({ ok: true, pruned: gone });
});

// Ask one device to include its fuller self-check in its next heartbeat —
// the crew screen's diagnostics, readable without holding the phone.
app.post("/api/system/ask-diagnostics", requireOwner, (req, res) => {
  const deviceId = String((req.body || {}).deviceId || "").slice(0, 40);
  if (!deviceId || !fleetDevices.has(deviceId)) {
    return res.status(404).json({ error: "No device by that id has said hello." });
  }
  diagWanted.add(deviceId);
  res.json({ ok: true });
});

// Send a REAL dispatch-path push to one device's account, so "will the
// alarm actually fire tonight" is a button, not a hope. It goes down the
// same channel a call does — that is the point — and names no patient.
app.post("/api/system/test-push", requireOwner, async (req, res) => {
  const deviceId = String((req.body || {}).deviceId || "").slice(0, 40);
  const dev = fleetDevices.get(deviceId);
  if (!dev) return res.status(404).json({ error: "No device by that id has said hello." });
  const rows = db.prepare("SELECT token FROM push_tokens WHERE account_id = ?").all(dev.accountId);
  if (!rows.length) {
    return res.json({ ok: true, sent: 0, note: "That account has no push token registered — the phone has not signed onto a truck since push went live, or runs an old build." });
  }
  let sent = 0, dead = 0;
  for (const { token } of rows) {
    try {
      const r = await sendCallAlert(token, {
        title: "ALERT PATH TEST",
        body: "Test from the System page. If you saw and heard this, the alert path works.",
        data: { kind: "test" },
      });
      if (r.ok) sent += 1;
      if (r.dead) { dead += 1; db.prepare("DELETE FROM push_tokens WHERE token = ?").run(token); }
    } catch (e) { /* counted by omission */ }
  }
  res.json({ ok: true, sent, dead, tokens: rows.length });
});

// Dealt with. Clearing is the owner saying "everything on this list has been
// read"; the next fault starts the list again.
app.post("/api/system/clear-reports", requireOwner, (req, res) => {
  systemReports = [];
  saveSystemReports();
  systemFindings = [];
  try {
    db.prepare("DELETE FROM settings WHERE key = 'system_findings'").run();
  } catch (e) {}
  res.json({ ok: true });
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

// A route that throws used to answer with Express's default HTML error page
// and vanish from every record but the deploy log. It lands on the owner's
// System page now, alongside the 5xx counters the finish-hook keeps.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // A body the parser rejected is the caller's fault, not a server fault: answer
  // 413 (too large) or 400 (malformed) rather than a blanket 500, which reads as
  // a crash to a scanner and to the caller — and must NOT be counted as a 5xx
  // fault on the System page. (Pentest INJ-02/INJ-03.)
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    return res.status(413).json({ error: "That request was too large." });
  }
  if (err && (err.type === "entity.parse.failed" || err.status === 400 || err instanceof SyntaxError)) {
    return res.status(400).json({ error: "That request was not valid JSON." });
  }
  try {
    record5xx(req, 500);
    console.error("Route error:", req.method, req.path, err && err.message);
  } catch (e) { /* the reporter must never be the second fault */ }
  res.status(500).json({ error: "The server hit a fault answering that. It has been recorded." });
});

const httpServer = app.listen(PORT, () => {
  console.log(`PulseOps server listening on port ${PORT}`);
  console.log(`Database file: ${DB_PATH}`);
  console.log(`Backups: ${BACKUP_DIR}${BACKUP_DIR_2 ? ` and ${BACKUP_DIR_2}` : ""}` +
    `${BACKUP_TOKEN ? "" : " · download disabled (no BACKUP_TOKEN set)"}`);
  // One on boot, so a server that is restarted daily still has yesterday, and
  // so a fresh deployment is never sitting there with no copy at all. The
  // scheduled daily fires just after the 07:00 operational boundary
  // (BACKUP_DAILY_UTC_HOUR), so each copy holds a complete, closed day.
  runBackup("startup").catch((e) => console.error("Backup on startup failed:", e));
  const scheduleDaily = () => {
    const t = setTimeout(() => {
      runBackup("scheduled").catch((e) => console.error("Scheduled backup failed:", e));
      scheduleDaily();
    }, Math.max(60 * 1000, nextDailyAt(Date.now(), BACKUP_DAILY_UTC_HOUR) - Date.now()));
    if (t.unref) t.unref();
  };
  scheduleDaily();
  // The temporary tier: a copy every thirty minutes, cleared by each verified
  // daily. Never hold the process open for the sake of a backup timer.
  const tempTimer = setInterval(
    () => runTempBackup().catch((e) => console.error("Temporary backup failed:", e)),
    TEMP_EVERY_MS
  );
  if (tempTimer.unref) tempTimer.unref();
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

// A kept-alive socket the server closes at Node's default five idle seconds
// races the client that reuses it in the same instant — the stress test's only
// errors (a handful of ECONNRESET in the opening burst, none after) were
// exactly this. The window is outlived instead: longer than any client's
// keep-alive reuse, and headers a second past it so the two never invert.
httpServer.keepAliveTimeout = 65 * 1000;
httpServer.headersTimeout = 66 * 1000;
