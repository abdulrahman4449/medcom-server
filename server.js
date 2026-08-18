// MEDCOM Dispatch — self-hosted server.
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
app.get("/api/health", (req, res) => {
  const keys = db
    .prepare("SELECT key, length(value) AS bytes, updated_at FROM board ORDER BY key")
    .all();
  res.json({
    ok: true,
    database: {
      path: DB_PATH,
      chosenFrom: DB_SOURCE,
      survivesRedeploy: DB_IS_PERSISTENT,
    },
    board: {
      keys: keys.length,
      totalBytes: keys.reduce((n, k) => n + (k.bytes || 0), 0),
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
  res.download(path.join(__dirname, "public", "index.html"), "medcom-dispatch.html");
});

app.listen(PORT, () => {
  console.log(`MEDCOM Dispatch server listening on port ${PORT}`);
  console.log(`Database file: ${DB_PATH}`);
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
