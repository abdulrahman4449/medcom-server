// PulseOps — self-hosted server.
//
// Replaces Netlify Functions + Netlify DB with a plain Node.js server and a
// single SQLite file. Same job as before (serve the app, and read/write the
// "board" key/value store the app talks to), no vendor platform required —
// this runs anywhere Node runs.

const path = require("path");
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
// version does. There's no server-side identity check here — the app's
// login screen is the only gate, same as the Netlify version — so allowing
// any origin doesn't weaken anything that was actually protected.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/board", (req, res) => {
  const key = req.query.key;
  if (!key || typeof key !== "string") {
    return res.status(400).json({ error: "Missing key" });
  }
  const row = db.prepare("SELECT value FROM board WHERE key = ?").get(key);
  res.json({ value: row ? JSON.parse(row.value) : null });
});

app.post("/api/board", (req, res) => {
  const { key, value } = req.body || {};
  if (typeof key !== "string") {
    return res.status(400).json({ error: "Missing key" });
  }
  db.prepare(
    `INSERT INTO board (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value ?? null));
  res.json({ ok: true });
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

function backupName(at) {
  const d = new Date(at);
  const p2 = (n) => String(n).padStart(2, "0");
  return `board-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
         `-${p2(d.getHours())}${p2(d.getMinutes())}.db`;
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

let lastBackup = null;

async function runBackup(reason) {
  const at = Date.now();
  const name = backupName(at);
  const written = [];
  const failed = [];
  // The first destination is written by SQLite itself; the second is a copy of
  // that finished file, which is safe because by then it is no longer live.
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    await db.backup(path.join(BACKUP_DIR, name));
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

app.get("/api/backups", (req, res) => {
  res.json({ ok: true, ...backupState(), copies: listBackups(BACKUP_DIR) });
});

app.post("/api/backups", async (req, res) => {
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
  if (!/^board-\d{8}-\d{4}\.db$/.test(name)) return res.status(400).json({ error: "Not a backup name." });
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "No such backup." });
  res.download(file, name);
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
