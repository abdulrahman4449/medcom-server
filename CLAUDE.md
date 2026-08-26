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
  is set.
- **Nothing reaches `/api/board` without a token, and passwords are never
  handled on the device.** Accounts live in their own `accounts` table, not on
  the board — `ems:accounts` is refused outright by the board API. Sign-in is
  `POST /api/auth/login`, which checks a salted scrypt hash and issues an
  HMAC-signed token the app sends with every request. `src/lib/auth.jsx` holds
  it; `noteAuthLost()` signs the device out on a 401, but only if it had a
  token — before sign-in the board answers 401 to everything, and treating that
  as a sign-out fires on a loop at the sign-in screen. `loadAll`/`loadCold`
  wait for a token before polling at all. An old unsalted SHA-256 hash is
  accepted once and replaced with a salted one on that sign-in.
- **Only an administrator may write the department's definitions.**
  `ADMIN_ONLY_KEYS` in `server.js` — policies, checklists, inventory. Everyone
  signed in may write the day's work. Roles are checked on the server; a
  screen that hides a button is not a permission.
- **Consent in the app is not permission from the phone.** The tracking consent
  sheet asks the device for a position inside the tap on "Allow"
  (`primeDeviceLocation`), because that tap is the only user gesture there is —
  `watchPosition` from inside the tracking effect is not one, and on a native
  shell it produced no OS dialog and no error, just a truck that never appeared.
  The shells also need `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` on
  Android and `NSLocationWhenInUseUsageDescription` on iOS; still never
  `ACCESS_BACKGROUND_LOCATION`. See `native/README.md`.
- **A browser suspends audio on every load, and that is not worth a notice.**
  `alertsArmedBefore()` remembers that this device has armed once, so
  `CallAlertNotice` only nags about the thing that genuinely needs a deliberate
  tap — notification permission. Saying "not fully armed" after every refresh
  taught crews to ignore the one line that matters. The native shells have **no
  `Notification` API at all**, so `permission` there is `"unsupported"` and any
  test written as `permission === "granted"` can never pass — which made the
  notice permanent on exactly the devices it was least use to. A shell carrying
  the alarm plugin does not go through browser audio in the first place and is
  never nagged.
- **The stand-down speaks; the repeat must not.** `speakStandDown` opens with
  `speechSynthesis.cancel()` — it has to, or a second stand-down queues behind
  the first. That is right when it is called once and wrong on a loop: a repeat
  every 450 ms cut the sentence mid-word and the crew heard "the call — the
  call — the call" until they pressed Understood. `soundStandDownTone` is the
  tone alone and is the only thing that repeats. The words are said once, twice
  over, at the start.
- **An alarm must not have a missing-file case.** Both plugins looked up
  `dispatch_alert.mp3` and gave up without it, falling back to the web tone —
  which cannot play before the page has been tapped, so a phone opened fresh to
  a waiting call made no sound at all. iOS now synthesises its own two-tone WAV
  in memory, Android falls back to the device's alarm ringtone. The bundled mp3
  is still preferred and still optional.
- **"The tone does not work in the background" is not a sound problem.** iOS
  suspends a backgrounded app, JavaScript stops, the poll stops, and the call
  never arrives — there is nothing for an alarm to sound about. `setNativeStandby`
  asks the shell to hold an audio session open with silence while somebody is
  signed on, because iOS does not suspend an app that is playing. It costs
  battery, and it does **not** survive a force-quit or a restart; only a push
  notification does, and on iOS getting past the silent switch means a Critical
  Alert entitlement from Apple. Say that rather than implying it is covered.
- **A Capacitor 6+ plugin registers through `CAPBridgedPlugin`, not the `.m`
  file.** Up to Capacitor 5 the ObjC `CAP_PLUGIN` macro was what registered a
  plugin; from 6 it is gone, and a class that conforms only to `CAPPlugin`
  compiles, ships and is never loaded — `window.Capacitor.Plugins.PulseOpsAlarm`
  simply is not there. That one missing conformance is why the iPhone had no
  banner, no alarm-path tone, and fell back to page audio iOS had already
  interrupted. Every new method must be added to `pluginMethods` as well as
  written; one without the other is a method the app can never call. There is no
  `.m` file any more and there must not be one — the macro registers the same
  plugin a second way alongside the conformance. **And conformance alone still
  does not load it:** Capacitor only auto-discovers plugins that arrive as
  packages, so a class in the app target has to be registered by hand from
  `capacitorDidLoad` in a `CAPBridgeViewController` subclass — the iOS
  counterpart of Android's `registerPlugin(...)`. See
  `native/ios/MainViewController.swift`, which does nothing unless
  `Main.storyboard` names it as the view controller's class.
- **The shells have no `Notification` API, so every web notification path is
  dead on a phone.** `notifyAssignedCall` returned on its first line and an
  iPhone showed no banner for a call at all. `nativeNotify` goes through the
  alarm plugin instead — iOS via `UNUserNotificationCenter`, Android on the
  `USAGE_ALARM` channel. Local, not push: it needs the app running. Permission
  is asked at sign-in *and* on mount, because a restored session never passes
  through the sign-in screen.
- **`BUILD_STAMP` is on the crew screen under the speaker check.** A whole round
  of testing once went into a fault that was already fixed, because the phone
  was still running the previous build and nothing on screen said so. The same
  line reports whether the alarm is going through the system path or page audio,
  and what state that audio is in — ask for it before diagnosing "no tone".
- **An interrupted AudioContext never comes back on its own.** "Suspended" is
  not the only way page audio stops. When anything else in the app activates an
  audio session — which is what going on duty does, to stop iOS suspending the
  shell — WebKit puts the page's context into `"interrupted"`, and `resume()`
  then resolves without making it runnable. Every web-made sound goes silent,
  including the speaker check, on a phone that is not muted. `playWhenAwake`
  takes the ref rather than the context so it can throw a dead one away and
  build another. A context is cheap; a silent tablet is not.
- **Any text field under 16px zooms the whole board on iOS.** Focusing one makes
  iOS enlarge the page and leave it there, with the layout hanging off the side
  and no way back. Every `<input>`, `<textarea>` and `<select>` style is 16px
  for that reason alone — `scripts/check.mjs` does not catch this, so check the
  size when adding a field. The viewport meta also pins `maximum-scale=1`.
- **Coming back to the app must read the board, not wait for the timer.** The
  poll is three seconds and a phone waking from a locked screen adds its own
  pause, so a crew who opened the app because they felt the buzz looked at a
  board with no call on it. `visibilitychange`, `focus` and the shell's
  `appStateChange` all trigger a read, because no one of them fires in every
  case; a duplicate read costs nothing.
- **The crew's message dock belongs outside every page test.** It sits at the
  end of `TeamView`, not inside `onPage("teams")` — a crew reading their call
  had no way to answer the desk and no sign that the desk had said anything.
  The unread count and the tone come with it (`useMessageAlerts`), and the pill
  always reads "Dispatch" on a crew tablet: naming the trucks that are talking
  is the desk's behaviour, and on a crew screen it put the crew's own truck name
  on the pill.
- **An administrator can take the dispatch desk, and it is a real dispatcher
  session.** The sign-in role choice offers it to admins only; it goes through
  the same shift and station steps and the same `finishDispatcherLogin`, so the
  log records a dispatch sign-on under their own name. The alternative people
  were using was signing in on somebody else's ID.
- **Wiping the board is `docs/RESET-THE-BOARD.md`, not a button.** The `-wal`
  file has to go with the `.db` or the last few minutes come back. Accounts live
  in their own table, so the board can be cleared without touching them.
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
