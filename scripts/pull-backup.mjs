// Pulls a backup of the board onto this computer - and onto a drive plugged
// into it - on a schedule.
//
// WHY THIS EXISTS
//
// The server keeps its own copies, and a second set wherever BACKUP_DIR_2
// points. On a server the department owns, BACKUP_DIR_2 can be the mount path
// of an external drive left connected, and that is the whole job done.
//
// A hosted server (Render and the like) has no socket to plug a drive into.
// The drive is on somebody's desk, not in the data centre. So the pull happens
// from this end instead: leave this running on the office computer with the
// drive attached, and it fetches a copy on a schedule and writes it to the
// drive. That is the second, offline copy.
//
//   node scripts/pull-backup.mjs --to /media/backup-drive/pulseops
//
// Options:
//   --to <dir>        where to write. Required.
//   --server <url>    default https://medcom-dispatch.onrender.com
//   --token <token>   the server's BACKUP_TOKEN. Or set BACKUP_TOKEN here.
//   --every <hours>   keep running and pull every N hours. Omit to pull once.
//   --keep <n>        how many copies to keep on the drive (default 60).
//
// The token is what the server checks. Without it the download is refused, and
// without one set on the server the route does not exist at all - a file with
// every patient record on it must not be one URL away.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const dir = arg("to");
const server = (arg("server", "https://medcom-dispatch.onrender.com")).replace(/\/$/, "");
const token = arg("token", process.env.BACKUP_TOKEN || "");
const everyHours = Number(arg("every", 0));
const keep = Number(arg("keep", 60));

if (!dir) {
  console.error("Say where to write: --to /path/to/drive/pulseops");
  process.exit(1);
}
if (!token) {
  console.error("No token. Pass --token, or set BACKUP_TOKEN in this shell.");
  console.error("It must match BACKUP_TOKEN on the server.");
  process.exit(1);
}

async function pullOnce() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    // Is the drive actually there? A drive that was unplugged must be a loud
    // failure, not a copy quietly written to the mount point underneath it.
    if (!fs.existsSync(dir)) {
      throw new Error(`${dir} does not exist — is the drive plugged in and mounted?`);
    }
    const listRes = await fetch(`${server}/api/backups`);
    if (!listRes.ok) throw new Error(`the server answered ${listRes.status} when asked for its backups`);
    const state = await listRes.json();
    const newest = state.primary && state.primary.newest;
    if (!newest) throw new Error("the server has no backup to give yet");

    const res = await fetch(`${server}/api/backups/${encodeURIComponent(newest.name)}`, {
      headers: { "x-backup-token": token },
    });
    if (res.status === 403) throw new Error("the server refused the token");
    if (res.status === 404) throw new Error("backup downloads are switched off on the server (no BACKUP_TOKEN set there)");
    if (!res.ok) throw new Error(`the server answered ${res.status}`);

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 1024) throw new Error(`the file came back suspiciously small (${bytes.length} bytes)`);
    // SQLite files start with this. A copy that is not a database is worse than
    // no copy, because it will only be discovered on the day it is needed.
    if (bytes.subarray(0, 15).toString() !== "SQLite format 3") {
      throw new Error("what came back is not a SQLite database");
    }

    const out = path.join(dir, newest.name.replace(/\.db$/, `-pulled-${stamp}.db`));
    fs.writeFileSync(out, bytes);
    console.log(`${new Date().toISOString()}  wrote ${out} (${(bytes.length / 1048576).toFixed(1)} MB)`);

    const mine = fs.readdirSync(dir).filter((f) => f.startsWith("board-") && f.endsWith(".db")).sort();
    while (mine.length > keep) {
      const gone = mine.shift();
      fs.unlinkSync(path.join(dir, gone));
      console.log(`   removed old copy ${gone}`);
    }
  } catch (e) {
    console.error(`${new Date().toISOString()}  FAILED: ${e.message}`);
    return false;
  }
  return true;
}

const ok = await pullOnce();
if (everyHours > 0) {
  console.log(`Staying up, pulling every ${everyHours} h. Leave this window open.`);
  setInterval(pullOnce, everyHours * 3600 * 1000);
} else {
  process.exit(ok ? 0 : 1);
}
