# Getting lost data back

The server takes a snapshot of the whole database **on every start** — so every
redeploy leaves one — and every 24 hours after that. They go to `BACKUP_DIR`,
which is `/data/backups` unless you set it otherwise. They are kept **daily for
30 days and weekly for 12 weeks**, so anything lost in the last month is still
on the disk. Nothing below is urgent in the sense of "do it in the next hour";
it is urgent in the sense of "do it this month".

**These files contain patient MRNs.** If you pull one off the server it goes
where the department keeps confidential records — not a personal laptop folder,
not a consumer cloud drive.

---

## The short version

Everything happens in **Render → the `medcom-dispatch` service → Shell**. The
service keeps running throughout; nothing here needs a restart.

```
cd $(dirname $(find / -name restore.mjs -path '*/scripts/*' 2>/dev/null | head -1))/..

node scripts/restore.mjs list                      # what snapshots exist
node scripts/restore.mjs diff board-20260827-0108.db   # what is smaller now
node scripts/restore.mjs put  board-20260827-0108.db ems:requests ems:log
```

(On Render the app is normally at `/opt/render/project/src`; the `cd` above
finds it either way. `pwd` should show a folder with `server.js` in it.)

`diff` is the one that matters. It compares the backup with the live board key
by key and marks anything that has **fewer items now than it had then**, which
is the shape a loss makes. Then it prints the exact `put` command for those
keys, so you do not have to type them.

---

## Why not just roll the whole database back?

Because it throws away every hour worked since. A rollback to Wednesday night
loses Thursday's calls, Thursday's crews, Thursday's hours — to get back
something that only three keys ever lost.

`put` copies **named keys only**, straight into the live board, while the
server is running. The board picks it up on the next three-second poll. Accounts
and passwords live in their own table and are never touched by `put` at all.

`put <backup> --all` does replace every board key, if that really is what you
want. It still leaves accounts alone.

---

## Step by step

### 1. See what you have

```
node scripts/restore.mjs list
```

```
14 backups in /data/backups, newest first:

  board-20260827-0108.db     2891 KB   2026-08-27T01:08:22.000Z
  board-20260826-0104.db     2874 KB   2026-08-26T01:04:11.000Z
  …
```

**Pick the newest one from before the loss.** If data went missing during a
redeploy, that is the backup written at the *previous* deploy or the daily one
before it — not the one written by the deploy that lost it, which was taken
after the new code was already running.

### 2. Find out what actually went

```
node scripts/restore.mjs diff board-20260826-0104.db
```

```
  key                          in the backup             live now

  ems:archive                       12 · 402 KB          12 · 402 KB
  ems:log                          986 · 210 KB         986 · 210 KB
  ems:requests                      64 ·  48 KB           9 ·   7 KB    <-- smaller now
  ems:scheduled                     21 ·  16 KB          21 ·  16 KB
  …

1 key is smaller than in that backup:

  node scripts/restore.mjs put board-20260826-0104.db ems:requests
```

If nothing is marked, that backup is not older than the loss — go back another
one and run `diff` again.

To look before you leap:

```
node scripts/restore.mjs show board-20260826-0104.db ems:requests
```

### 3. Put it back

```
node scripts/restore.mjs put board-20260826-0104.db ems:requests
```

It prints exactly what it is about to overwrite, writes a **safety copy of the
live board first** (`before-restore-….db`, beside the backups), and then does
it. If the restore itself turns out to be wrong, that safety copy is a backup
like any other and `put` works on it too.

Refresh the app. The board is right on the next poll.

---

## What the keys are

| Key | What it holds |
|---|---|
| `ems:requests` | the calls |
| `ems:units` | the trucks and who is sitting in them |
| `ems:scheduled` | bookings and standing arrangements |
| `ems:log` | the event log and every shift sign-on/sign-off |
| `ems:archive` | the kept operational days |
| `ems:submissions` | filed shift logs |
| `ems:checklistRuns` | filed vehicle checklists |
| `ems:messages` | the crew/desk messages |
| `ems:inventory`, `ems:inventoryMoves` | stock and its movements |
| `ems:policies` | the policy shelf (large — scanned PDFs) |
| `ems:overtime`, `ems:overtimeSent` | overtime decisions, and what was sent in |
| `ems:coverage` | the no-coverage record |

Accounts and passwords are **not** board keys. They are in the `accounts` table
and neither `diff` nor `put` can touch them.

---

## Making an extra snapshot right now

Before doing anything at all, if you want one from this minute rather than from
last night:

```
curl -s -X POST http://localhost:$PORT/api/backups
```

---

## If the disk itself is gone

That is the one case where a whole-file restore is right. Stop the service,
copy the backup over the database, delete the two sidecar files, start it:

```
cp /data/backups/board-20260826-0104.db /data/board.db
rm -f /data/board.db-wal /data/board.db-shm
```

The sidecars matter: SQLite keeps recent writes in `-wal`, so leaving one
behind replays the last few minutes of the database you were replacing over the
one you just restored.

Then **Manual Deploy → Restart service** in Render, and check
`GET /api/health` says `survivesRedeploy: true`.
