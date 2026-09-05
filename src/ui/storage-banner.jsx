
// ---------- main app ----------

// The one thing a crew must be able to see at a glance: whether what is on
// their screen has actually reached the desk. A screen that looks identical
// online and offline is how times get lost without anyone knowing, so this says
// it plainly and stays there until the last held record has gone up.
// ---------- is this board actually being kept? ----------
//
// The code has done its part for a while now: server.js puts the database on a
// persistent disk when it can find one, and render.yaml declares that disk. But
// Render only reads render.yaml for services created *from* a blueprint. A
// service someone set up by hand in the dashboard ignores the file entirely, so
// the database lands back inside the app folder — which is rebuilt on every
// deploy, taking the whole board with it.
//
// That is a server setting, not something the app can change from in here. What
// the app can do is stop the loss being a surprise. /api/health already knows
// the answer; this asks it once and says so, at the top of the screen, until
// somebody fixes it.
// One key worth asking about on its own.
//
// Set below the ceiling a single key can actually reach, not above it: the
// server accepts a request body of 25 MB, and every key is written whole, so
// nothing can ever grow past that in one piece. An alert set at 40 MB would
// have been an alert that could never fire — what happens instead at 25 MB is
// that the write is refused, the app reads the refusal as being offline, and
// the change queues on the device forever.
//
// So this warns at 15, and the policy shelf refuses new files past 20 with a
// sentence somebody can act on rather than a silent failure.
export const BIG_KEY_BYTES = 15 * 1024 * 1024;
// What the shelf may hold, kept under the server's 25 MB so a save is never
// refused after the fact.
export const POLICY_SHELF_LIMIT = 20 * 1024 * 1024;

export function bytesStr(n) {
  const b = Number(n) || 0;
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`;
  return `${b} B`;
}

// The names the board stores things under are not words anybody should have to
// read off a warning.
export const KEY_NAMES = {
  "ems:submissions": "Filed shift logs",
  "ems:archives": "Kept operational days",
  "ems:log": "Event log",
  "ems:requests": "Live calls",
  "ems:policies": "Policy files",
  "ems:checklistRuns": "Filed checklists",
  "ems:overtimeSent": "Overtime sent in",
  "ems:productivityAsks": "Productivity requests",
  "ems:productivity": "Productivity decisions",
  "ems:fleetSeeded": "Fleet set up",
  "ems:inventoryMoves": "Stock movements",
  "ems:coverage": "No-coverage periods",
  "ems:scheduled": "Forward book",
  "ems:messages": "Messages",
  "ems:units": "Teams",
  "ems:accounts": "Accounts",
};

export function keyName(k) {
  return KEY_NAMES[k] || k;
}