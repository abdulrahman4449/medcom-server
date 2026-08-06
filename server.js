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

// On a host with a persistent disk (recommended — see README), point this at
// a path inside that disk so the data survives restarts and redeploys. Falls
// back to a local "data" folder for running this on your own machine.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "board.db");
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
});
