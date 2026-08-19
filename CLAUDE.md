# MEDCOM Dispatch

An ambulance dispatch board for a hospital EMS department. Dispatchers raise
and assign calls; crews stamp the five timeline steps from the vehicle;
administrators read statistics and file shift logs.

## Shape of the repo

- `public/index.html` — **the entire application**, ~21k lines: React via
  Babel-standalone in one `<script type="text/babel">` block, styles in a
  single `styles` object. There is no build step. Edit this file directly.
- `server.js` — Express + SQLite. Serves the app, the `/api/board` key/value
  store the app reads and writes, and the two Play Store policy pages.
- `public/sw.js` — notification service worker. Deliberately **no fetch
  handler**, so a deploy is never served from a stale cache.
- `design/` — design mockups only. Not loaded by the app.

## Read before you redesign anything

**`design/README.md` records the approved visual direction**, signed off
18 August 2026. When the ask is "remodel", "redesign" or "the next big
patch", that document is the target — do not start a fresh exploration.

## Things that will bite you

- **The native app bundles its own copy.** The Android/iOS shell ships
  `www/index.html` inside the build; it does not download the app from the
  server. Changing `public/index.html` updates the web only — the app version
  needs a rebuild and a reinstall. Links must go through `API_BASE`, not bare
  paths, or they resolve against the bundle and dead-end.
- **The database must live on a persistent disk.** `DB_PATH`, or a disk
  mounted at `/data`. Without one the board is erased on every deploy.
  `GET /api/health` reports which it is.
- **This is a health app under Google Play policy.** It stores patient MRNs,
  so it needs a verified Organization developer account, a reachable privacy
  policy and deletion page, and the not-a-medical-device disclaimer.
- **A dispatch alert must be unmissable, and the web layer can only get part
  of the way there.** In the app: call alerts ignore the in-app loudness
  setting entirely — including SILENT — and vibrate alongside the tone; the
  audio context declares itself as `playback` so iOS treats it as media
  rather than as ambient sound. What the web layer **cannot** do is override
  the hardware silent switch, the OS volume slider, or Do Not Disturb. That
  needs the native shell: an `AVAudioSession` set to `.playback` with
  `.duckOthers` on iOS, and on Android a notification channel created with
  `USAGE_ALARM` so the alert plays on the alarm stream. Until the Capacitor
  project does both, a muted phone is a phone that can miss a call — say so
  rather than implying the app has it covered.
- **UHU is per person, not per vehicle.** A medic keeps working while crews
  change over; attributing a truck's total to everyone who sat in it was a
  real bug. See `computePersonUhu`.
- **`SHOW_LOGOS` and `ORG_NAME`** near the top of the app switch the crests
  and the organisation's name back on. Both are deliberately off/empty.

## Checking your work

There is no test suite. Before pushing a change to `public/index.html`,
confirm the JSX still compiles — extract the `text/babel` block and run it
through `@babel/preset-react`. The sandbox cannot reach the CDN, so the app
itself cannot be rendered here; say so rather than implying it was tested in
a browser.
