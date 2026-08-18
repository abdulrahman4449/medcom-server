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
- `public/index.html` — your actual app (same one from `testapp449`,
  unchanged except where it reads its API address — see below).
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
Open `public/index.html`, find this line near the top:
```js
const LIVE_SITE = "https://REPLACE_WITH_YOUR_SERVER_URL";
```
Replace it with your actual Render URL, then re-upload that one changed file
to your GitHub repo (same "upload a file" method as before) — Render
redeploys automatically whenever the repo changes.

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
