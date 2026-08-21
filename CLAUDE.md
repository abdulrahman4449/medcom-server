# PulseOps

**PulseOps** — "Where Every Second Matters". An ambulance dispatch board for
a hospital EMS department. Dispatchers raise
and assign calls; crews stamp the five timeline steps from the vehicle;
administrators read statistics and file shift logs.

## Shape of the repo

- `src/` — **the application**, ~78 ES modules under `lib/`, `domain/`,
  `export/`, `brand/`, `ui/`, plus `styles.jsx` and the `main.jsx` entry
  point. **This is what you edit.** Every module is named after the section
  banner it came from, so `// ---------- no coverage ----------` is now
  `src/domain/coverage.jsx`.
- `build.mjs` — esbuild packs `src/` into one script and inlines it into
  `public/index.template.html`. `npm run build`.
- `public/index.html` — **GENERATED. Never edit it by hand**; the next build
  silently discards your change. It stays committed because the server serves
  it, the native shell bundles it, and a deploy must not depend on the build
  succeeding.
- `public/index.template.html` — the surrounding HTML: the CDN script tags,
  the `<style>` reset, and an `<!--APP-->` marker where the bundle lands.
- `scripts/check.mjs` — the checks below. `npm run check`.
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
- **Location is foreground-only, and must stay that way.** Tracking runs only
  while a crew is on a call, only from the Alpha seat's device, only with that
  person's consent, and only while the app is on screen. Only the latest fix
  per truck is stored and it is deleted at back-in-service — there is no route
  history by design. Do not add `ACCESS_BACKGROUND_LOCATION`, a wake lock, or
  a service worker that keeps polling: background location triggers Google's
  Location Permissions declaration form, which is the thing this design exists
  to avoid. A refusal takes effect immediately; the admin acknowledgement is a
  record, never a gate.
- **A day runs 07:00 to 07:00, and a shift belongs to the date it opened.**
  The day shift of 20 August is 07:00–19:00 on the 20th; the night shift of
  20 August is 19:00 on the 20th to 07:00 on the 21st, and files under the
  20th. `opDayStart` is the boundary; nothing may invent a second idea of
  what a date means. Three logs come out of each day: each station's day
  shift, each station's night shift, and the operational day itself (both
  stations, both shifts) which is kept automatically once every call raised
  on it is closed — a night call still running at 08:00 holds its own day
  open rather than being archived half-written.
- **Never key a crew stay by the word "day" or "night".** It repeats every
  24 hours, so one person's Tuesday and Thursday merge into a single stay
  that appears to run for two days and overlaps every call between them.
  Key by the shift window. See `medicCrewStamps`.
- **The board is polled at two speeds, and adding a key to the wrong one is
  expensive.** `loadAll` runs every 3 seconds and must only carry what
  changes while somebody is watching. `loadCold` runs every 30 seconds and
  carries the filed logs, the kept days, the event log and the checklists —
  together nine tenths of the bytes. Policies are on neither: a shelf of
  scanned PDFs is megabytes, so it is read only when that tab is opened.
  `GET /api/health` lists every key with its size; check there before
  putting anything new on the fast path.
- **Restocking belongs to History, not to the live call.** A crew cannot do
  the paperwork of replacing a cannula while the patient is still in the
  truck. A finished call joins `callsAwaitingRestock`, the History tab
  carries a red count, and it clears only when somebody presses the button —
  `RESTOCK_KEY` marks it per call, because "we used nothing" has to be
  distinguishable from "nobody has looked at it".
- **Signing in again is not a handover.** `seatHeldBy` — if the person
  already holds a seat, offer "Continue as MEDIC 1" and write nothing. The
  old code offered them "take over" against their own name, which stood them
  down, reset their hours and recorded a swap saying they relieved
  themselves.
- **UHU is per person, not per vehicle.** A medic keeps working while crews
  change over; attributing a truck's total to everyone who sat in it was a
  real bug. See `computePersonUhu`.
- **Zahrawi's shift is 9:30, not 12:00.** It is the denominator of every UHU
  figure its crews appear in. `shiftMsForUnit`.
- **Overtime is written in hours, and approved hours are the only total.**
  `otHoursStr`, never `msDurationStr`, for anything paid. A declined claim
  is shown in its own column and adds to nothing.
- **The name lives in `APP_NAME_A` / `APP_NAME_B` / `APP_TAGLINE` /
  `APP_SLUG`, near the top of the app.** Never type "PulseOps" into a screen,
  a report footer or an export filename — every one of those reads the
  constants, so a rename is four lines. `BrandMark` and `Wordmark` draw the
  identity; the mark is inline SVG on a navy plate, not an image file, so it
  is sharp at every size and needs nothing deployed beside it. Brand colour
  tokens (`--brand`, `--brand-navy`) are deliberately separate from the five
  status colours: on this board red already means "critical call", and it
  must not also mean "our logo" in the same glance.
- **The Render service is still called `medcom-dispatch`, on purpose.** On
  Render the service name is the hostname, and that hostname is compiled
  into the native app as `LIVE_SITE`. Renaming it breaks every installed
  phone. The app is PulseOps; the address it lives at is not.
- **A unit's `status` field is written, and writes go missing.** Anything shown
  to a human goes through `effectiveStatus(unit, requests)`, which derives it
  from whether anyone is signed on and whether the unit is on a live call. The
  board once counted a stale `"available"` left behind by a crew whose sign-off
  never landed, and told the desk a truck was ready when everyone had gone
  home. Coverage and dispatch already derived it; the display layer did not.
- **The checklist belongs to the person, once per shift — not to the truck.**
  `personChecklistRun` / `checklistIsMandatory`. Keying it to the vehicle asked
  somebody who changed trucks mid-shift to do it twice, and counted a truck as
  done because the previous crew had filed. The first list of a person's shift
  is the mandatory one and the one the statistics count; a second, on a truck
  they moved onto later, is offered and not required.
- **The department's UHU target is `UHU_TARGET` (45%), measured across people.**
  `departmentUhu` weights by shifts worked rather than averaging percentages.
  Dispatchers are deliberately absent: `staffStatsFor` only counts log entries
  with `role: "team"`, so a dispatcher can never appear at 0% and drag the
  department's figure down. They need a measure of their own; it is not defined
  yet.
- **`buildDispatchLogAOA` must be given the day it is describing.** Without the
  `dayStart` argument it falls back to the operational day of the moment the
  file is made, so a day pulled out of the archive a week later was titled with
  today's date and had its shifts worked out against today's 07:00.
- **Backups are the server's job, and a live SQLite file cannot be copied.**
  `db.backup()` in `server.js`, on start-up and every 24 hours, to `BACKUP_DIR`
  and — if set — `BACKUP_DIR_2` as well. Downloading one hands over every
  patient MRN on the board, so the route does not exist unless `BACKUP_TOKEN`
  is set. Note that `/api/board` itself has no authentication at all.
- **`SHOW_LOGOS` and `ORG_NAME`** near the top of the app switch the crests
  and the organisation's name back on. Both are deliberately off/empty.

## Checking your work

There is no test suite. `npm run check` is what stands in for one, and it must
pass before you build. It walks every module in `src/` and asserts:

1. **It parses.**
2. **Every identifier resolves** — declared locally, imported, or a browser
   global. A green compile proves nothing about whether the things the code
   names exist; esbuild will happily build a module that references something
   it never imported, and it only fails when that line runs. This has caught
   two shipped bugs: eleven components deleted by a bad splice, and a Policies
   tab that named four variables nobody had declared — which threw before the
   first element was built, so React unmounted the tree and the screen went
   **black with nothing responding**. A blank screen in this app is almost
   always an unresolved name.
3. **Nothing is declared twice** in a module, and no key appears twice inside
   the `styles` object, where the later one silently wins.

Then `npm run build`, and `git diff --stat`. An index-based splice that removed
more than you meant to looks like a large deletion count and like nothing else.

### Two things the checks cannot see

- **A name that moves between modules must move its import with it.** The
  checker catches the module that lost it. It cannot tell you the split was
  wrong, only that it does not resolve.
- **`String.replace` with a `$` in the replacement.** `build.mjs` inlines the
  bundle with a *function* replacement on purpose: a minified bundle is full of
  `$&` (from `x && y`), and in a replacement **string** `$&` means "the matched
  text". It silently rewrote part of the app and produced a syntax error 470 KB
  in. Never pass a bundle as a replacement string.

### Rendering it for real

The sandbox cannot reach unpkg, so the CDN copies of React never arrive and the
app cannot be opened from `public/index.html` directly. npm *is* reachable, so
`npm install react react-dom leaflet xlsx-js-style` puts the same UMD builds on
disk; serve them locally, stub `/api/board` (the key is a **query parameter**,
`?key=`, and writes are `POST {key, value}`) and the app boots in headless
Chromium. That is how the split was verified: sign in as `F1525518`, walk the
tabs, and compare screenshots against the same walk on the previous build.
