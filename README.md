# MEDCOM Dispatch — self-hosted (no Netlify)

This is a complete, independent server: your app's files, plus a plain
Node.js server with its own database file (SQLite — no separate database
service to set up or pay for separately). No Netlify, no vendor agent,
nothing tied to any one platform. It runs anywhere Node.js runs.

## What's in here
- `CLAUDE.md` — orientation for anyone (or any agent) picking this up cold.
- `design/` — the approved design direction and its mockups. Read
  `design/README.md` before redesigning any screen.
- `server.js` — the whole backend. Serves the app and the `/api/board`
  endpoint the app reads and writes to.
- `src/` — the app's source, split into modules. **Edit here.**
- `public/index.html` — the built app: one self-contained file, generated
  from `src/` by `npm run build`. **Never edit it by hand** — the next build
  overwrites it.
- `public/sw.js` — the notification service worker, unchanged.
- `data/` — where the database file lives once the server runs. Empty until
  then.

---

## Try it on your own computer first (2 minutes, optional but reassuring)

```bash
cd medcom-server
npm install
npm start
```

Then open `http://localhost:3000` in a browser. Sign in, create a test call,
refresh the page — if it's still there, the server and database are working.
Press Ctrl+C to stop it. Nothing here needs the internet; this step is just
to prove the code works before paying for hosting.

---

## Putting it on a real, always-on server (Render.com, ~$7/month)

Free hosting tiers exist, but they either erase your data whenever the
server restarts, or delete the database automatically after a while — not
something to build a real dispatch board on. Render's cheapest **persistent**
tier avoids both problems. Steps:

### 1. Put this folder on GitHub (no command line needed)
1. Go to **github.com**, sign in or create a free account.
2. Click **+** (top right) → **New repository** → name it (e.g.
   `medcom-dispatch-server`) → **Create repository**.
3. On the new repo's page, click **uploading an existing file**.
4. Drag in every file and folder from this project *except* `node_modules`
   and `data` (you won't have either yet if you skipped the local test).
5. Scroll down, click **Commit changes**.

### 2. Connect it to Render
1. Go to **render.com** → sign up (GitHub sign-in is easiest) → **New +** →
   **Web Service**.
2. Pick the repository you just created.
3. Settings:
   - **Name**: anything, e.g. `medcom-dispatch`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Starter** (the paid tier — this is what makes your
     data persistent)
4. Add a persistent disk so your database survives restarts: scroll to
   **Disks** → **Add Disk** → **Name**: `data`, **Mount Path**: `/data`,
   **Size**: 1 GB (plenty for this).
5. Add an environment variable so the server uses that disk: **Environment**
   → **Add Environment Variable** → **Key**: `DB_PATH`, **Value**:
   `/data/board.db`.
6. Click **Create Web Service**. First deploy takes a few minutes.

When it's done, Render gives you a URL like `https://medcom-dispatch.onrender.com`
— that's your permanent server address.

### 3. Point the app at its own server
Open `src/lib/board-api.jsx`, find this line:
```js
export const LIVE_SITE = "https://REPLACE_WITH_YOUR_SERVER_URL";
```
Replace it with your actual Render URL, run `npm run build`, and push both the
changed source and the rebuilt `public/index.html`. Render redeploys
automatically whenever the repo changes, and rebuilds the app as it deploys.

### 4. Check it worked
Visit your Render URL in a browser. Sign in, create a test call — same
check as the local test, but now it's live on the internet, permanently, on
a server you control.

---

## Data disappears after every deploy

If the board is empty after an update — no calls, no submitted logs, admin
statistics back at zero — the database is being stored inside the app folder,
and the host rebuilds that folder on every deploy. Nothing is wrong with the
app; the file is simply being thrown away with the old container.

### 1. Confirm it

Open `https://your-server-url/api/health`. The `database` section answers it
directly:

```json
"database": {
  "path": "/data/board.db",
  "chosenFrom": "the persistent disk mounted at /data",
  "survivesRedeploy": true
}
```

`"survivesRedeploy": false` is the problem. The server also prints a large
warning block in the deploy logs on every start when it happens, so it is
visible without going looking for it.

### 2. Fix it (Render, dashboard)

A service created by hand in the dashboard does **not** read `render.yaml`, so
it has to be told directly:

1. Your service → **Disks** → **Add Disk** → Name `data`, Mount Path `/data`,
   Size 1 GB.
2. Your service → **Environment** → **Add Environment Variable** →
   `DB_PATH` = `/data/board.db`.
3. **Manual Deploy** → **Deploy latest commit**.

Then reload `/api/health` and check `survivesRedeploy` is now `true`.

A persistent disk requires a paid instance type. Free tiers discard the disk,
which puts you back where you started.

### 3. Or create the service from the blueprint

`render.yaml` in this repo declares the disk and the variable already. A service
created via **New + → Blueprint** picks both up with nothing to set by hand.
This only applies to new services — it will not retrofit an existing one.

### What about the data already lost?

It is gone; there is no copy of it to restore from. The steps above stop it
happening again from the next deploy onward.

---

## Backups

A persistent disk stops a deploy erasing the board. It does not stop the disk
failing, and it does not stop somebody deleting a member of staff by mistake.
Those need a copy you can go back to.

The server takes one automatically: on start-up and then every 24 hours, using
SQLite's own online backup so the copy is consistent while the app keeps
serving. Copying `board.db` by hand does **not** work — the database is
mid-write and, with WAL on, that file is not even all of it.

Every copy is kept for 30 days, then one a week for 12 weeks. About 100 MB for
a year of history.

**Where they go.** `BACKUP_DIR` (defaults to a `backups` folder beside the
database). Set `BACKUP_DIR_2` and the same snapshot is written to a second
place as well — on a server you own, that is where an external drive is
mounted, and the two copies are then on two different disks.

**Seeing that it is working.** Admin → Archive → BACKUPS. It shows how old the
newest copy is, how many there are, and whether the second destination is
reachable. If backups stop, it says so in red — a backup that quietly stopped
a month ago is worse than none, because nobody is worried about it.

### Taking a copy off the server

A backup file contains every patient MRN on the board, so the download route
does not exist until you deliberately switch it on:

1. In Render → Environment, add `BACKUP_TOKEN` and set it to a long random
   string.
2. Admin → Archive → BACKUPS now offers **Download newest**. Paste the token
   once; that browser remembers it.

Keep the file where the department keeps confidential records — not a personal
folder, not a consumer cloud drive.

### An offline copy on an external drive

If the server is yours, set `BACKUP_DIR_2` to the drive's mount path and you
are done — two copies, two disks, nothing else to run.

A hosted server (Render) has no socket to plug a drive into. Pull to the drive
from the office computer instead:

```
node scripts/pull-backup.mjs --to /media/backup-drive/pulseops \
    --server https://medcom-dispatch.onrender.com \
    --token YOUR_BACKUP_TOKEN --every 24
```

Leave it running with the drive attached and it fetches a copy every 24 hours.
It refuses to write if the drive is not mounted, and checks that what came back
is really a database before keeping it.

### Restoring — read this before you need it

A backup nobody has ever restored is a hope, not a backup. Practise it once:

1. Stop the service (Render → Suspend, or stop the process).
2. Put the backup where the database lives, named `board.db`, and delete any
   `board.db-wal` and `board.db-shm` sitting beside it.
3. Start the service.
4. Open the app and check a shift you remember.

That is the whole procedure. It has been tested: a call deleted from a running
board came back, MRN and all, from a copy on the second drive.

## Using this with the native iOS/Android app

The native app project I gave you earlier (`medcom-native-app.zip`) needs
one small update to match: open its `www/index.html`, make the same
`LIVE_SITE` change as above, then continue with that project's own README
from Part 2 onward (the Xcode/Capacitor build steps don't change at all).

---

## One thing worth flagging again

Same note as every version before this one: `/api/board` has no
server-side authentication of its own — the app's login screen is the only
gate, exactly as it was on Netlify. Before this holds real patient data
(MRNs, real crew rosters), have your hospital's IT/compliance team review
this setup.
