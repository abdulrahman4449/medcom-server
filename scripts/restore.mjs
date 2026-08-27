// Getting data back out of a backup.
//
// The server takes a snapshot of the whole database on every start — so every
// redeploy leaves one — and every 24 hours after that, into BACKUP_DIR (by
// default /data/backups). They are kept daily for 30 days and weekly for 12
// weeks, so anything lost in the last month is still there.
//
// A whole-file rollback is almost never what anybody wants: it throws away
// every hour worked since. What is wanted is nearly always "put back the four
// keys that emptied and leave the rest alone", and that is what this does. It
// works on the live database while the server keeps running — SQLite serialises
// the write, and the server reads the board fresh on every request, so the
// board is right on the next poll without a restart.
//
//   node scripts/restore.mjs list
//   node scripts/restore.mjs diff  board-20260827-0108.db
//   node scripts/restore.mjs show  board-20260827-0108.db ems:requests
//   node scripts/restore.mjs put   board-20260827-0108.db ems:requests ems:log
//   node scripts/restore.mjs put   board-20260827-0108.db --all
//
// Nothing is written without a safety copy of the live database being taken
// first, and `put` prints exactly what it is about to overwrite.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.DB_PATH || "/data/board.db";
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), "backups");

const [, , cmd, file, ...rest] = process.argv;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function backups() {
  let names = [];
  try {
    names = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("board-") && f.endsWith(".db"));
  } catch (e) {
    die(`No backup directory at ${BACKUP_DIR}. Set BACKUP_DIR if it is somewhere else.`);
  }
  return names
    .map((name) => {
      const st = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, bytes: st.size, at: st.mtime };
    })
    .sort((a, b) => b.at - a.at);
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// Every key in a board table, with something useful said about its size.
function boardOf(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("SELECT key, value, updated_at FROM board ORDER BY key").all();
  db.close();
  const out = new Map();
  for (const r of rows) {
    let count = null;
    try {
      const v = JSON.parse(r.value);
      if (Array.isArray(v)) count = v.length;
      else if (v && typeof v === "object") count = Object.keys(v).length;
    } catch (e) {
      // not JSON; the size is all we can say about it
    }
    out.set(r.key, { bytes: r.value.length, count, updated: r.updated_at, value: r.value });
  }
  return out;
}

function resolveBackup(name) {
  if (!name) die("Which backup? Run `node scripts/restore.mjs list` first.");
  const full = path.isAbsolute(name) ? name : path.join(BACKUP_DIR, name);
  if (!fs.existsSync(full)) die(`No such backup: ${full}`);
  return full;
}

if (cmd === "list") {
  const list = backups();
  if (!list.length) die(`No backups in ${BACKUP_DIR}.`);
  console.log(`${list.length} backups in ${BACKUP_DIR}, newest first:\n`);
  for (const b of list) {
    console.log(`  ${b.name}   ${kb(b.bytes).padStart(9)}   ${b.at.toISOString()}`);
  }
  console.log(`\nLive database: ${DB_PATH} (${kb(fs.statSync(DB_PATH).size)})`);
  process.exit(0);
}

if (cmd === "diff") {
  const full = resolveBackup(file);
  const was = boardOf(full);
  const now = boardOf(DB_PATH);
  const keys = [...new Set([...was.keys(), ...now.keys()])].sort();
  console.log(`\n  ${"key".padEnd(26)} ${"in the backup".padStart(20)} ${"live now".padStart(20)}\n`);
  let lost = [];
  for (const k of keys) {
    const a = was.get(k);
    const b = now.get(k);
    const say = (x) =>
      !x ? "—" : x.count === null ? kb(x.bytes) : `${x.count} · ${kb(x.bytes)}`;
    // Smaller now than it was is the shape of a loss. A key that has simply
    // grown is not interesting and is not marked.
    const shrank = a && (!b || (a.count !== null && b.count !== null ? b.count < a.count : b.bytes < a.bytes));
    if (shrank) lost.push(k);
    console.log(`  ${k.padEnd(26)} ${say(a).padStart(20)} ${say(b).padStart(20)}  ${shrank ? "  <-- smaller now" : ""}`);
  }
  if (lost.length) {
    console.log(`\n${lost.length} key${lost.length === 1 ? " is" : "s are"} smaller than in that backup:\n`);
    console.log(`  node scripts/restore.mjs put ${path.basename(full)} ${lost.join(" ")}\n`);
  } else {
    console.log("\nNothing is smaller now than it was in that backup.\n");
  }
  process.exit(0);
}

if (cmd === "show") {
  const full = resolveBackup(file);
  const key = rest[0];
  if (!key) die("Which key? e.g. ems:requests");
  const was = boardOf(full).get(key);
  if (!was) die(`${key} is not in that backup.`);
  console.log(was.value.length > 4000 ? was.value.slice(0, 4000) + "\n… (truncated)" : was.value);
  process.exit(0);
}

if (cmd === "put") {
  const full = resolveBackup(file);
  const was = boardOf(full);
  const now = boardOf(DB_PATH);
  const all = rest.includes("--all");
  const keys = all ? [...was.keys()] : rest.filter((k) => !k.startsWith("--"));
  if (!keys.length) die("Name the keys to put back, or pass --all.");

  const missing = keys.filter((k) => !was.has(k));
  if (missing.length) die(`Not in that backup: ${missing.join(", ")}`);

  console.log(`\nAbout to overwrite these on ${DB_PATH}:\n`);
  for (const k of keys) {
    const a = was.get(k);
    const b = now.get(k);
    const say = (x) => (!x ? "—" : x.count === null ? kb(x.bytes) : `${x.count} items`);
    console.log(`  ${k.padEnd(26)} live ${say(b).padStart(12)}  ->  from backup ${say(a)}`);
  }

  // A copy of what is about to be replaced, so this is itself undoable.
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13);
  const safety = path.join(BACKUP_DIR, `before-restore-${stamp}.db`);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const live = new Database(DB_PATH);
  await live.backup(safety);
  console.log(`\nSafety copy of the live board written to ${safety}`);

  const put = live.prepare(
    `INSERT INTO board (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  const tx = live.transaction((ks) => {
    for (const k of ks) put.run(k, was.get(k).value);
  });
  tx(keys);
  live.close();
  console.log(`\nPut back ${keys.length} key${keys.length === 1 ? "" : "s"}. The board picks it up on the next poll — no restart needed.\n`);
  process.exit(0);
}

console.log(`
Getting data back out of a backup.

  node scripts/restore.mjs list
      Every snapshot on the disk, newest first.

  node scripts/restore.mjs diff <backup>
      What is smaller now than it was then, key by key. Start here.

  node scripts/restore.mjs show <backup> <key>
      Look at what a key held in that backup before putting it back.

  node scripts/restore.mjs put <backup> <key> [<key>…]
  node scripts/restore.mjs put <backup> --all
      Put those keys back. Takes a safety copy of the live board first, and
      touches only the board — accounts and passwords are never altered.

Database: ${DB_PATH}
Backups:  ${BACKUP_DIR}
`);
