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

`design/README.md` also carries the **card contract**, and it is the answer to
"which of these two looks is right": **16px radius, `1px solid var(--hair)`,
`0 6px 18px var(--lift)`, on a flat `--raised` surface.** Modals, sheets and
overlays are their own class and keep their larger radii; buttons are their own
vocabulary again. When a surface looks like it belongs to an older version of
the app, check it against those three numbers first.

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
  **A call belongs to the shift it was RAISED in, whenever it finishes.**
  `isNightCall` reads `createdAt`, so one raised at 23:30 that closes at 00:40
  and one raised at 06:30 that closes at 08:10 are both the night crew's, and
  both are shaded night grey on the sheet; a day row is painted white rather
  than left unpainted, or the app's own gridlines show through the one part of
  the table that has no fill. **An export is titled by the date the day OPENED,
  and by the period it actually covers.** `buildDispatchLogAOA` takes a `periodLabel`: without one it
  says `Operational day 29 Aug 2026 · day and night shift`, and with one it says
  what that one says. Naming both ends — "29 Aug 07:00 → 30 Aug 07:00" — asks a
  reader to work out which of the two dates the file is filed under, and a file
  covering ONE shift used to say "day and night shift" regardless, so opening
  the 28th's night shift gave a sheet claiming to hold both.
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
- **A poll answers 304 unless the key actually changed, and every board write
  must say so.** A mature board's cold poll is tens of megabytes that change
  once a day, and at seventy devices the old always-send-everything read was
  measured flooding the server: cold polls queued to ninety seconds and the
  3-second poll sat behind them. `GET /api/board` sends an ETag (an in-memory
  per-key write counter, `bumpBoardKey` in `server.js`; the row's
  `updated_at` + byte length as the cross-restart fallback) and honours
  If-None-Match; `fetchKeyValue` in `src/lib/offline-queue.jsx` holds the
  per-key cache, and the pending-write merge still runs on every read so a
  cache hit can never hide a held record. **Any new route that writes the
  board table must call `bumpBoardKey`** (bulk rewrites call
  `bumpAllBoardKeys`) or devices holding the old tag are answered 304 for
  ever. The read also sends the stored JSON text as-is — parsing forty
  megabytes only to stringify it straight back was the other half of the
  cost; never put `JSON.parse(row.value)` back into that route.
- **A day's bookings are tiles, not a column.** `schedGrid` — a day with eight
  transfers was eight full-width cards and a scroll, and the desk could not read
  its own day. The tile says what the booking is, when, and whether it has a
  team; the two-times breakdown, the return note and the waiting time appear on
  the one the desk has opened, not on all of them.
- **A booked-ahead card is a diary entry, not a call card.** Bookings were drawn
  with the full call-card treatment and carried every control inline — a team
  picker, a reschedule button, a cancel button — 167px of controls under 92px of
  information, on every one. A day with eight transfers could not be read on a
  phone. The card says what the booking is and who is on it; `openCard` puts the
  controls one tap away on the one being worked.
- **A repeating booking is an arrangement, and the board carries today.**
  `REPEAT_HORIZON_DAYS` is 0 — occurrences reach the dispatcher board on the day
  they run, not two days early beside the calls being worked. Sun/Tue/Thu means
  three cards on three days. NEITHER the arrangement nor the day's copy appears
  in Upcoming: `schedIsTemplate` keeps out the first (it is not an appointment)
  and `schedIsOccurrence` the second (it is already on the board). The
  arrangement itself lives in Schedule → Repeating, which is where somebody goes
  to see what is coming or to stop it.
- **The day a repeating booking was BOOKED for is an occurrence too.** The form
  takes a date and time AND a set of days, and `repeatOccurrencesDue` only ran
  the days — so "today at 09:00, repeating Sun/Tue/Thu", booked on a Saturday,
  silently never happened: not in Upcoming (a template), not on the board (a
  template is never released), and nothing anywhere saying so. Its own comment
  had said "the booking itself is the first occurrence" since before an
  arrangement stopped being dispatchable, and that stopped being true without
  anything noticing. `localDayKey(template.scheduledFor)` is checked alongside
  the weekday list, and the two can never make two occurrences for one day
  because `repeatKey` is that same day key.
- **A booking is raised fifteen minutes before it LEAVES, not before it is
  due.** `schedLeaveAt` / `schedReleaseAt` — the leaving time is `dispatchAt`
  where the desk gave one and the appointment time where it did not, and
  `SCHED_LEAD_MS` comes off whichever it is. The lead used to apply only to
  `dispatchAt`, so a booking taken without one was raised AT its appointment
  time — the crew told about it exactly as late as it is possible to be told.
- **A stopped arrangement stops.** `schedRepeatIsLive` — the pass that throws
  off the day's copy picked its templates on shape alone (repeat days, not a
  return leg, not itself a copy) and never looked at the status. So cancelling a
  standing transfer took it off the Repeating tab, which filters cancelled ones
  out, and changed nothing else: it went on raising a call every one of its days
  for ever, from a card the desk could no longer see to stop it a second time.
  Cancelling the arrangement also cancels the copy it has already thrown off for
  today, unless that copy has already been released — a released one is a live
  call and is cancelled from the board, where the crew can be told.
- **Rush is demand against capacity, and nothing about it is stored.**
  `src/domain/rush.jsx` — the live meter under the room counts reads calls
  running against trucks STAFFED (by `effectiveStatus`, like the counts beside
  it), and turns RUSH the moment everything staffed is out or a call is waiting
  with nothing free. The history is `rushHourProfile`: call intervals cut into
  hour-of-day buckets, averaged over the period's days, anchored at 07:00 so
  the chart reads day-then-night like every sheet. It uses `callStartTs`/
  `callEndTs`, so the one-shift cap on an abandoned call applies here too, and
  it is fed the statistics corpus — board plus archive — so filed months have a
  profile. There is deliberately no sampled load log: a stored one would grow,
  need pruning and restoring, and add nothing the call intervals don't hold.
  Rush wears amber (`--hold`), never red — red is a critical call and NO
  COVERAGE. **The number on a peak bar is CALLS, never fractional trucks** —
  "0.2 ambulance" meant nothing to the person the chart is for, so the peak
  prints `raised` and the caption says "N of M calls landed in this hour"; the
  bars stay weighed by busy time. A peak can hold zero raised calls (a long
  call merely ran through it), so the label and the caption's count are both
  guarded — a "0" on the busiest bar reads as a broken chart. Trucks-out and
  waiting-now belong to the LIVE meter on the board; the history cannot say
  them, because nothing about rush is stored.
- **The category mix lists every category, including the ones at nought.**
  `categoryMixRows` seeds from `CALL_CATEGORIES` and then counts. Built from the
  calls alone, a category nothing came in against was absent from the panel —
  and absent reads as an incomplete list, not as a nought. What the department
  was NOT called for is half of what somebody opens that panel to find out.
  Anything the board holds that the vocabulary does not, "Not stated" included,
  is kept alongside: the sheet's list is the starting point, never the limit.
- **"Still running" on the response gauge means literally open on the board.**
  `responseCompliance` — a CLOSED call with no arrival time will never get one,
  whatever it closed for: a cancellation, a refusal (no destination was ever
  reached), a timeline the desk closed unfinished, or a call closed before the
  close-reason box existed and so carrying no reason for `callWasCancelled` to
  match. Every one is an exclusion, folded into `notCounted` and said as
  "closed without a response time, not counted"; `running` (status not yet
  `completed`) is the only part anybody has to act on. Before the second split,
  ten closed-for-weeks calls read as ten open emergencies — the same
  dressing-history-as-backlog bug the calledOff/pending split had already fixed
  once at 52-against-34. The average response belongs on the gauge's face
  beside the percentage — a percentage says how often ten minutes was made, the
  average says what a patient actually waits.
- **The statistics period is one string, and every size can look backwards.**
  `stat-range.jsx` — five sizes: shift, week, month, quarter, year, all on the
  KPI band, and `StatPeriodPicker` chooses WHICH one of whatever size ("the
  month — May"). The chosen period is written INTO the range key
  (`month:2026-4`, `week:2026-7-23`, `shift:1725...` — a shift is pinned by its
  window's own start), never held as second state beside it. The operational
  week is Sunday 07:00 to the next Sunday 07:00, through `opDayStart` so the
  07:00 boundary keeps its one definition — the small hours of Sunday belong to
  the week that is ending — and a past shift or week is named by the date it
  OPENED, like everything else on this board. The picker never offers a period
  that has not happened.
- **The service mix never assumes a level.** `serviceMixRows` — CCT, ALS and
  BLS as shares of every call the period received, read the way the sheet's
  Svc column reads them: the category decides (`serviceTypeFor`), an explicit
  priority is honoured on a call not yet coded (the EMERGENCY buttons set one
  first), and a call with neither is "Not stated" — never quietly counted as
  BLS the way `priorityKeyOf`'s fallback would. The three the department runs
  are always listed, zeros included, in the order it says them; anything else
  the board holds is kept alongside. Both mixes fold closed on the KPI band —
  the count line stays readable without the column.
- **A no-coverage gap has TWO endings, and both are the board's own.** The
  first team back in service, and the LAST team signing off —
  `coverageGapCloseReason` in `domain/coverage.jsx`, under `npm test`. The
  opening pass has always known that a station with nobody signed on is
  CLOSED, not uncovered; the closing pass did not, so a gap declared in the
  afternoon was held open all night by an empty station and the morning board
  read "NO COVERAGE — 19:25:27" over a team standing ready. Zahrawi alone
  does not hold a gap open — it is not coverage, exactly as when opening.
- **The fresh start is the owner's, cannot be delegated, and keeps what was
  configured.** `POST /api/reset-board` — for the day the pilot starts and
  the day it goes live. Gated by the same `mayOpenRestoreWindow` test as
  restores (only F1525518's own full-admin session passes) plus a typed
  `RESET`. It erases every worked key AND every backup file — the copies hold
  the trial's MRNs and sync-all would drag them back — and keeps accounts
  (their own table), `ems:policies`, `ems:checklists`, `ems:inventory`,
  `ems:fleetSeeded`, and the fleet as names only (id, name, station; seats
  and statuses stripped). `FreshStart` in `BackupPanel.jsx` draws it for the
  owner alone.
- **Inside an opened launcher tile, a section is a title, not a drawer.**
  `FlatSections` in `AdminView.jsx` — the tile was the press, so a second,
  collapsed FoldingSection inside the screen somebody chose is a door behind
  a door: under the flag it renders as a plain banner with its body open.
  The accounts screen opts out (`SectionScreen flat={false}`) because its
  five drawers ARE the content, siblings, not the chosen section repeated;
  the KPI band's two mixes are outside any tile and keep their folds.
- **Firebase cannot mint a token before Apple has issued one.**
  `registerForRemoteNotifications()` is a round trip to Apple, and asking
  `Messaging.messaging().token` before it returns fails with "No APNS token
  specified before fetching FCM Token" — which reads like a broken setup and
  is only an ask made too early. Found on a real handset: the console showed
  the failure and then `token refreshed (142 chars)` a moment later, so the
  token DID arrive and had already been thrown away. `awaitApnsToken` waits
  for `Messaging.messaging().apnsToken` (250 ms poll, 15 s deadline so a phone
  with no network answers rather than hanging the sign-on), and the refresh
  delegate caches whatever arrives so a token that lands after the ask is
  never lost. A cached token answers the next ask immediately.
- **A push is ONE banner and ONE tone, so the SERVER asks again.**
  `callStillNeedsWaking` in `lib/push-triggers.cjs` (under `npm test`) +
  `chaseCall` in `server.js` — a crew asleep at 03:00 or in a bay with a diesel
  running can miss a single buzz, and the app's own 1.7-second alarm loop
  cannot help because it only runs once the app is OPEN, and the app being
  shut is the whole reason a push was needed. So an unacknowledged call is
  pushed again every `PUSH_REPEAT_MS` (25 s) up to `PUSH_REPEAT_MAX` (6) — a
  bit over two minutes, after which the desk should be telephoning rather than
  trusting a notification, and a phone buzzing for ever in a locker helps
  nobody. It stops on acknowledgement, completion, a move to another truck, or
  the call leaving the board; the acknowledgement IS a board write, so every
  write also sweeps the chase list and the nagging ends within one poll of the
  crew's tap. Keyed truck|call so a second dispatch never cancels the first
  one's chase, and the timer is `unref`'d so a notification can never hold the
  process open.
- **A push carries BOTH platforms or it silently carries one.** `callMessage`
  / `ownerMessage` in `lib/push-fcm.cjs` (under `npm test`) — the payload had
  an `android` block and nothing else, which on an iPhone is a DATA-ONLY
  message: no banner, no sound, delivered silently to an app that is not
  running. The same call woke Android and not iOS with nothing anywhere saying
  so. The `apns` block sends `apns-priority: 10`, a collapse id (the iOS twin
  of the Android tag, so a second push replaces the banner) and
  `interruption-level: time-sensitive`, which is the strongest thing available
  WITHOUT Apple's Critical Alert entitlement: it breaks through Focus modes
  and not through the silent switch, the volume slider or Do Not Disturb. An
  owner notice is `active`, never time-sensitive — a disk warning has no
  business breaking through somebody's Focus at three in the morning.
  `native/ios/PulseOpsPushPlugin.swift` is the iPhone half: permission, then
  APNs registration, then the FCM token, in that order and in one method,
  because asking out of order returns an empty string that reads like a bug.
  Firebase rather than a second APNs sender — the server already speaks FCM
  and does not change. Setup: `native/README.md` → "Push on iOS".
- **A locked phone is woken by the SERVER, and the push names no patient.**
  The WebView freezes when a phone locks, the poll stops, and no alarm in the
  app can sound about a call it never learned of — so the server sends the
  wake-up. `lib/push-triggers.cjs` (`newAssignments`, under `npm test`)
  decides what fires: a truck is woken when a call it did not have becomes
  assigned to it, once — re-saving the same assignment wakes nobody, and a
  completed call never does. `lib/push-fcm.cjs` sends it, dependency-free,
  over FCM v1 with `FIREBASE_SERVICE_ACCOUNT` (a server credential like
  `AUTH_SECRET`; without it every push path is a no-op). The message is a
  notification-type FCM carrying the dispatch channel id, so ANDROID displays
  it — alarm stream, through silent, app killed — with no app code running.
  The body is "NEW CALL … open the app": it crosses Google and sits on a lock
  screen, and an MRN in either place is a disclosure. Tokens follow the SEAT
  (`src/lib/push.jsx` registers at sign-on against the truck, unregisters at
  sign-out, and the server prunes two months' silence); the push fires after
  the board write commits and can never fail or slow one. iOS is deliberately
  not wired — no developer account, and past-the-silent-switch needs Apple's
  Critical Alert entitlement. Setup: `native/README.md` → "Push (FCM)".
- **The owner account cannot be taken over, because it is the prize.** Every
  owner power anchors to F1525518, so an admin who could delete that account,
  demote it, or clear its password and pocket the sign-in code would destroy
  the restore authority or simply BECOME the owner — and a regular admin was
  in fact offered Remove on the owner's roster row. `ownerAccountRefusal` in
  `lib/restore-guard.cjs` (under `npm test`) guards the three account routes:
  nobody deletes the owner, nobody demotes it (the owner included — an owner
  that is not an admin cannot open the restore window), and only the owner
  edits it or clears its password. The `/api/accounts` listing marks the row
  `isOwner` so the roster explains instead of offering a button that can only
  answer 403. A forgotten owner password is recovered by setting
  `OWNER_RESCUE=1` on the server and restarting — a one-time code prints to
  the log, the same trust the bootstrap code rests on; unset it after use.
- **The System page is the owner's, and watching must never cost the
  watched.** Archive → System (`SystemPanel.jsx`, `GET /api/system` behind
  `requireOwner`) — devices report their own uncaught errors
  (`src/lib/system-report.jsx`: install-once listeners, one report per fault
  per 10 min, never signed out, never throws) and say hello with their build
  and truck every few minutes, so the owner sees faults with the build stamp
  that says whether the phone was even current, and sees a signed-on phone
  that has gone SILENT — a crew that will miss a call. Reports are scrubbed
  before they are kept (`lib/system-health.cjs`, under `npm test`: digit
  runs ≥5 are masked — an MRN must not ride a stack trace into the store),
  deduped by message+build, capped at 100, and persisted in `settings` so a
  crash that kills the process is still on the page after the restart.
  Perf/fleet counters are in-memory on purpose (like the rush meter); the
  page is read on OPEN, never on a poll. **A guard that fires silently is
  how the ghost hid**: every server-side refusal or correction is a FINDING
  (`noteFinding` → `addFinding`, persisted like reports) — the reset-replay
  guard, shape-mismatch answers, refused board writes, sign-in limiter
  trips, and a device hello reporting a queue held over an hour. Findings
  name employee IDs on purpose (that IS the answer the page exists for) and
  are length-capped, but any STRANGER-typed text a finding quotes must go
  through `scrubText` at the call site — the limiter's does. Add a guard
  anywhere in `server.js` and add its `noteFinding` in the same breath.
  **The server also tests itself** (`runSelfTest`: shortly after boot, then
  daily, and on the page's button): DB integrity, every board key parses,
  backup freshness AND the newest copy opened and judged against the live
  board (an empty copy of an empty board is a fresh deployment — it retries
  one fresh backup before alarming), the push credential (`pushProbe` mints
  a token without sending), disk headroom. Each run appends ONE history row
  (`historyAppend`, capped at 90 days). The few conditions that cannot wait
  are pushed to the OWNER's phone via `alertOwner` — `sendOwnerNotice`
  deliberately carries no channel_id so a disk warning never sounds like a
  call — rate-limited to one per condition per hour; the watchdog
  (`silentActiveTrucks`) pages only when EVERY seated phone on a truck with
  a live call has been silent past three minutes, and never in the first
  minutes after boot. Test-push (`/api/system/test-push`) goes down the
  REAL dispatch channel on purpose. Device diagnostics are pull-only: the
  owner asks, the device answers on its next heartbeat, nothing streams —
  and the answer includes `shellReport` and the four Android settings from
  `nativeBackgroundStatus`. A short call's "Find on the board" jumps tabs
  via `onGoToPage` and a one-shot `focusSignal` that CompletedCalls consumes
  (opens the fold, clears filters, prefills the search with the MRN). `isOwner` is stamped on the login,
  set-password, act and me answers — never on `publicAccount`, which
  `/api/auth/lookup` serves to anybody.
- **Putting data back belongs to the owner; taking copies does not.**
  `lib/restore-guard.cjs`, under `npm test` like the merge and the delegation
  list. Anyone holding the archive area may take a backup whenever they like —
  it writes nothing anybody works on. Restore and sync-all rewrite the record,
  so they answer only to `RESTORE_OWNER` (F1525518, the bootstrap account) or
  to a delegate inside a 30-minute window the owner has opened
  (`POST /api/backups/allow-restore`; `{stop:true}` closes it early). Another
  FULL admin is still not the owner. The window lives in the `settings` table,
  never on the board — it is a permission, and permissions live where the
  server checks them. `RestoreWindow` in `BackupPanel.jsx` draws the switch
  for the owner and the explanation for everyone else; the server enforces it
  either way.
- **A call called off before the crew reached the patient needs no restock.**
  `restockNotNeeded`. Both halves are needed: a call stood down at the bedside
  may well have cost gloves and a blanket, and a call with no scene stamp is an
  unfinished timeline rather than a cancellation. So it comes off the list only
  when the close reason says it was called off AND `times.arrival` is empty.
- **A date field carries `lang="en-GB"`.** The browser draws its own calendar
  and follows the ELEMENT's language, so on a device set to Arabic the picker
  opens on the Hijri calendar and types a Hijri date into a field the board
  reads as Gregorian — filing a call years out. `styles.dateInput` is the large
  form; pair the two.
- **The workbook and the PDF are one document in two formats.** They carry the
  same columns, in the same order, under the same captions — `# · Patient coming
  from · From · To · MRN · times · Resp. · Team · Svc · Km · Call category ·
  E-PCR author · Bravo · Request status`. Add a column to `SHIFT_LOG_COLUMNS`
  and add it to `buildShiftReport` in the same breath, or a reader has to work
  out which column of one is which of the other. The PDF is a template literal,
  NOT JSX: a `{/* … */}` comment inside it prints on the page as text.
- **An empty cell is not part of the table, and taking OUR border off it is not
  enough.** `gridLogSheet` rules only cells that hold something — but a
  spreadsheet application draws its OWN faint grid over every cell with no fill,
  `<sheetView>` carries no `showGridLines="0"`, and this library gives no way to
  write one. So `blankOutEmptyCells` paints the space around the tables solid
  white and removes the border key outright (`border: {}` is still a style with a
  border on it). A filled cell covers the app's gridline; that is the only way to
  make the area read as paper. It runs at the end of `autoFitSheet`, which every
  sheet goes through, and again at the end of `dressLogSheet`.
- **A cancelled call is read from the CLOSE REASON, never from `status`.** There
  is no `cancelled` status on this board — a call the desk stands down is closed
  like any other — so `requestOutcomeKey` reads the reason. The PDF asked
  `r.status` under a column headed REQUEST STATUS and printed COMPLETED for a
  call the spreadsheet beside it called CANCELLED. Both documents shade a
  stood-down row the same light yellow (`FFF2CC`/`7F6000`); red already means no
  coverage and must not also mean cancelled.
- **A cell cannot be wider than its column, so widen the CELL.**
  `mergeCoverageCells` — the NO COVERAGE block sits under a forty-four column
  call table and borrows its widths, so "MEDIC 1, MEDIC 2, MEDIC 3" landed in a
  column sized for a ward name and was cut off. Widening the column would widen
  it for the call table too, so the teams cell is merged across two columns the
  builder leaves BLANK for exactly that — merging over columns that carry
  something swallows them, which is how STARTED and ENDED disappeared off the
  block. A merged region is drawn from the borders of the cells under it, so the
  anchor's style is copied across the span or the box comes out open on the
  right; and `blankOutEmptyCells` skips anything inside a merge. `paintRows`
  paints only cells that hold something, or a nine-column block shades all
  forty-four. The block's own `— NO COVERAGE` heading is merged the same way
  (`coverageTitleRows`, columns 0–3): a sentence sitting in the five-character
  counter column spilled across whatever was blank to its right and belonged to
  none of it.
- **Every sheet in a workbook wears the same header band.** `paintHeaderRow`
  runs inside `autoFitSheet`, which every sheet already goes through, so a new
  one cannot be added without it. It used to live in `dressSheet`, which only
  some sheets were passed through — one workbook that looked like two.
  `isCounterColumn` narrows a column of short whole numbers to six characters:
  every column starts at the nine-character minimum and grows to fit its
  heading, so a row counter headed anything longer than `#` came out wide
  enough for a sentence with "12" in the middle of it.
- **A control opens where it was pressed.** Schedule → Repeating draws one card
  per patient, and Manage on an arrangement used to open that booking's controls
  in a SEPARATE list below every patient card on the page — so on a desk with
  two standing patients the team picker and the cancel button appeared off the
  bottom of the screen behind the message dock. The button flipped to Done and,
  from where the desk was looking, nothing happened. `bookingCard(entry)` is the
  card as a function so the same one can be drawn inside the row that opened it.
- **A booking being worked takes the whole row.** `schedCardOpen` —
  `schedGrid` is a two-up tile grid and a grid item is as wide as its column
  however much is inside it, so pressing Manage built the full card, controls
  and all, inside a 195px cell: one narrow vertical column of buttons. A booking
  being worked is the diary equivalent of an active call, and an active call
  card is full width.
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
- **An open call counts up to now, and never for longer than one shift.**
  `MAX_CALL_MS` in `domain/uhu.jsx`. A call still running should tick live; a
  call nobody has closed for two days is not work, and left uncapped it went on
  earning on-call time for whoever was signed on — an abandoned call reading
  48h 50m carried one medic's UHU to **81.7% for a month** on a truck that had
  not moved. The BOARD still shows the true age (`now - callStartTs`), because a
  call open for two days is exactly what a desk needs to see; it is the
  statistic that must not treat it as two days of work.
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
  `db.backup()` in `server.js`, on start-up and daily just after the 07:00
  operational boundary (`BACKUP_DAILY_UTC_HOUR`, 04:00 UTC), to `BACKUP_DIR`
  and — if set — `BACKUP_DIR_2` as well. Retention is ALL-DAILY: every copy
  kept `BACKUP_KEEP_DAYS` (90) days, no weekly thinning — long history belongs
  to the year-end archive, not the backup folder. Downloading one hands over
  every patient MRN on the board, so the route does not exist unless
  `BACKUP_TOKEN` is set.
- **The temporary tier guards the day that is still running, and only a
  VERIFIED daily may clear it.** `lib/backup-tiers.cjs`, under `npm test` — a
  copy every 30 minutes into `BACKUP_DIR/temp` under its own `temp-` prefix,
  so the restore picker, the download route and sync-all (all matching
  `board-`) can never see one. `runBackup` opens the copy it just wrote
  (`verifyBackupFile`) and clears only temps taken at or before it — a daily
  that fails verification deletes NOTHING and files a finding, because the
  temps it would have covered are exactly the copies that day still needs.
  The safety copies taken `before a restore`/`before a sync` never clear
  temps (`backupClearsTemps`): they precede a rewrite of the board, and the
  temps beside them are the record of what is being rewritten. Temps are
  capped at three days (`TEMP_CAP` — filling up means dailies are failing,
  itself a finding), skipped when the disk is over its warning threshold, and
  erased by the owner's board reset like every other copy — they hold the
  same MRNs.
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
- **Changing your own password asks for the current one, signed in or not.**
  `POST /api/auth/change-password` (the name chip in the masthead —
  `AccountChip` in `Header.jsx`) — the token alone must not be enough, or a
  tablet left unlocked at the station re-keys the account; wrong guesses burn
  the same limiter as sign-in. The token is not tied to the hash, so nothing
  signs out — changing a password is not a sign-out.
- **An employee ID is printed on a badge, so it is not enough to claim an
  account.** An account with no password yet needs a **one-time code** an
  administrator issues (`claim_hash`, hashed and salted like a password, spent
  on use, seven days). Without it, anyone who could name an ID that had never
  been signed into could become that person. A fresh database prints a bootstrap
  code for `F1525518` to the server log — that is the only way into a new board,
  and every code after it is handed out from Teams. Clearing a password issues
  the replacement code in the same call, because clearing without one leaves the
  person unable to set a new password and with nothing to say why.
- **A settled password request stays settled; only `/api/auth/forgot`
  creates one.** `settledResetsHold` in `lib/reset-requests.cjs` (under
  `npm test`), applied to BOTH board write paths for `ems:passwordResets` —
  a phone on an old build queued its ask as a board write at the sign-in
  screen (401), then replayed it on every later sign-in, and a held record
  wins the merge: the admin's Dismiss at 20:17 was back as "pending" by
  20:28, from a device nobody could see. Board writes may settle a request,
  never create one and never flip a settled one back to waiting. The
  accepted cost: an ask from a not-yet-rebuilt shell no longer lands — the
  rebuild is the fix that shell needs anyway.
- **Nothing in the app can deliver a sign-in code to the person it belongs to.**
  They have not signed in, so they have no seat and nowhere for a message to
  land, and there is no email or SMS anywhere in this app. The last step is
  always a human passing it on — which is why "I don't receive a code" was a
  real report and not a bug in the code path. `claimCodeMessage` writes the
  whole hand-over message, not just the code, and `Copy the message` puts it on
  the clipboard for Teams; the password-reset path goes through the same banner
  rather than a `window.alert`, which nothing can be copied out of on a phone.
  The roster row carries `CODE OUT · nD` so an administrator can tell "I have
  not done this yet" from "I did, they lost it". `codeIssued`/`codeExpires` are
  on the `/api/accounts` listing and deliberately **not** on `publicAccount` —
  `/api/auth/lookup` answers to anybody, and there they would name every account
  sitting unclaimed with a live code on it.
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
- **A bundled mp3 must never be the tone for every priority.** iOS reached for
  `dispatch_alert.mp3` FIRST and played it whatever the call was, so the whole
  priority argument was discarded the moment somebody dragged one file into the
  project — and the app disagreed with the browser, which is exactly how "the
  ALS tone is right on the server and wrong in the app" happens. Both shells now
  build the tone in memory from the same note figures as `playAlertTone`, and a
  bundled file may override only *per tone* (`dispatch_alert_cct.mp3`,
  `dispatch_alert_bls.mp3`). The single generic file is no longer used for a
  dispatch: one file cannot express two tones. `alert()` hands back which tone
  and which source it used, and the crew screen prints it.
- **There are two call tones, not three: ALS and CCT share one, BLS keeps its
  own.** The department's decision — both ALS and CCT mean somebody getting up
  and moving now, and a crew woken at three in the morning does not act on the
  difference between two urgent tones. BLS must stay different, because that IS
  a difference they act on. This is not the old bug where every priority
  collapsed onto one fallback tone; `npm test` asserts BLS is never the urgent
  tone. `toneKeyFor`/`playAlertTone` in `src/lib/dates.jsx` and
  `alarmWav(priority:)` in the iOS plugin carry the same figures, note for note;
  change one and change the other. Android picks a raw file by the same rule
  (`dispatch_alert_cct` / `dispatch_alert_bls`, falling back to
  `dispatch_alert`), so a build shipping one mp3 uses it for everything.
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
  `native/ios/MainViewController.swift`, which does nothing until something
  actually constructs it. On Capacitor 8 that is `SceneDelegate.swift`, which
  builds the screen in code — `Main.storyboard` is never used, so setting a
  class on it changes nothing. Check with
  `grep -rn CAPBridgeViewController ios/App/App/*.swift` rather than assuming.
- **The shells have no `Notification` API, so every web notification path is
  dead on a phone.** `notifyAssignedCall` returned on its first line and an
  iPhone showed no banner for a call at all. `nativeNotify` goes through the
  alarm plugin instead — iOS via `UNUserNotificationCenter`, Android on the
  `USAGE_ALARM` channel. Local, not push: it needs the app running. Permission
  is asked at sign-in *and* on mount, because a restored session never passes
  through the sign-in screen.
- **"Sometimes the Android alert works and sometimes it doesn't" is a poll that
  stopped, not a sound that failed.** A backgrounded WebView has its timers
  throttled to one a minute and then frozen outright, and the board is read by a
  three-second timer inside it — so a sleeping tablet learns about a call a
  minute late, or never, and Doze plus each manufacturer's battery saver decide
  which. `setScreenAwake` holds the screen on while somebody is signed on — the
  shell's `FLAG_KEEP_SCREEN_ON` and the browser's Screen Wake Lock, neither of
  which needs a permission or a Play declaration — because a screen that stays
  on is a page that is never backgrounded. It does **not** survive Home or a
  lock; only a foreground service or FCM would, and both cost a Play
  declaration or a server. Say that rather than implying it is covered.
- **"Failed to fetch" is the browser's words, and it names nothing.** A fetch
  rejects only when the request never completed — a 401 or a 500 is a resolved
  promise — so anything thrown by the call itself is the device having no route
  to the server. `fetchOrExplain` / `serverUnreachable` in `lib/board-api.jsx`
  (under `npm test`) turn that into the address it tried and the three things
  to check, and mark it `offline: true` so a caller can tell "the server said
  no" from "nothing answered". It matters most on the sign-in screen, where the
  browser's own wording sat in red under the password box and read as a
  rejected password: the causes are the device being offline, the address not
  resolving from THIS device (an emulator with no DNS, a hospital wifi), or the
  server not answering — including a certificate the device will not trust,
  which a browser reports identically to being offline.
- **An iPhone never buzzed for a dispatch, because `navigator.vibrate` does not
  exist on iOS.** The web layer's `buzz()` is the Vibration API, which Safari
  and WKWebView have never shipped — so the call was a silent no-op and the iOS
  plugin had no vibration of its own, while Android had had it from the start.
  On a phone face-down in a cradle the buzz is what gets noticed first, and it
  is the one channel the silent switch does not touch. `startVibrating` /
  `stopVibrating` in the iOS plugin repeat `kSystemSoundID_Vibrate` every 1.6 s
  — iOS has no looping vibration, so an alarm-length buzz is one call on a
  timer. Idempotent, like the player: the web layer calls `alert()` every
  1.7 s and a restart each time buzzes forever on its first pulse. It starts
  BEFORE the tone (a tone that cannot be built is when the buzz matters most)
  and stops at the top of `stopPlayer()`, before its early returns, or an
  acknowledged call leaves a phone vibrating in a pocket. The pattern is not
  ours to choose and it obeys the owner's Sounds & Haptics setting, which the
  app may not read or change. `vibrating` rides on `alert()`'s answer so the
  crew line says `buzzing` or `NO BUZZ` rather than leaving it to be guessed.
- **The shell bundles its OWN `index.html`, so copying it to the server puts
  it nowhere near the phone.** Reported four times as "the fix is not
  implemented": the app was rebuilt in Android Studio (new plugin) while
  `android/app/src/main/assets/public/index.html` was still hours old, and the
  crew line then reports NOTHING wrong — the plugin-version warning can only
  be printed by a web build new enough to look for one, so a fresh plugin
  behind a stale bundle is invisible from the screen. The version that does
  not depend on the web half at all is in logcat: the plugin prints
  `plugin loaded, build …` from `load()`. `native/README.md` opens with the
  two files and the two places they go.
- **A method list is not a version — the plugin stamps its own build.**
  `SHELL_METHODS` catches a plugin that is missing a method, and on Android it
  caught nothing: every method this web layer needs already existed in the
  previous plugin, so a handset carrying a fortnight-old Java answered every
  name it was asked for and printed `shell up to date` while the fix written
  into that file was simply not on the device. Both plugins now report
  `pluginBuild`, and `shellBuildNote` (`npm test`) puts `PLUGIN IS 2026-08-20,
  THIS BUILD NEEDS …` on the crew line. A plugin too old to carry the stamp at
  all is older than the build that introduced it, and says so.
  **`SHELL_BUILD_WANTED` names the two platforms SEPARATELY**
  (`shellBuildWanted(platform)`), because the two plugins change separately:
  one number for both meant an Android-only fix — the volume floor, which iOS
  cannot have at all — told every iPhone it was out of date and demanded an
  Xcode rebuild that would have changed nothing but a constant, and a version
  that cries wolf on the platform it did not touch is one people learn to
  ignore. **Bump the constant in the plugin you actually changed and its entry
  in `SHELL_BUILD_WANTED` — only that one.**
- **The volume floor is ANDROID's, and iOS has none — say so rather than
  implying otherwise.** Android raises `STREAM_ALARM` to `MIN_ALARM_SHARE`
  (70%) for the length of an alert and re-asserts it on every 1.7-second
  repeat, so a thumb on volume-down mid-alarm is undone. iOS cannot:
  `AVAudioSession.outputVolume` is read-only and Apple publishes no API that
  sets the system volume, so an alert on an iPhone plays at whatever the slider
  says. `.playback` buys the ring/silent switch and nothing else — not the
  slider, not Do Not Disturb; past those needs Apple's **Critical Alert**
  entitlement, which needs a developer account and Apple's approval. Reported
  as a real thumb-on-volume-down test that "the foreground guaranteed volume
  floor did not kick in", on both handsets.
- **A trace is only worth what the eye behind it was doing.** "The stream
  never dipped" and "nothing was watching when it dipped" read identically
  from the outside, and the second is exactly what a floor that has quietly
  died looks like — an alert reported `dipped to 86%` on a phone whose sound
  had just vanished, because the watch had stopped on its first tick and that
  86% was simply the last reading anyone took. `floorTicks` counts how many
  times the watch actually looked during THIS alert; `volumeFloorNote` prints
  `held 74×`, or `WATCHED 1× — the floor was not being held` when a whole
  alert produced one look. Never publish a min/max trace without the count of
  observations beside it.
- **`MediaPlayer.create()` returns a PREPARED player, and audio attributes
  must be set BEFORE prepare.** Every alarm player was built with `create()`
  and then given `setAudioAttributes(USAGE_ALARM)` afterwards — out of
  contract, tolerated by older platforms, and not by Android 17 (API 37). When
  the call throws, `startPlayer` releases the player, every fallback below
  fails identically for the same reason, the alert is handed back to the web
  layer, and the page tone plays on the MEDIA stream — where the volume floor
  does not reach and a thumb on volume-down kills it outright. That one line in
  the wrong order produced every symptom of two days: a tone that died with the
  volume, an alarm stream sitting untouched at 86%, and finally no sound at
  all. `buildPlayer(uri)` now does `new MediaPlayer()` → `setAudioAttributes`
  → `setDataSource` → `prepare`, so the tone is on the alarm stream by
  construction rather than by permission; `rawUri` makes a bundled resource
  just another uri so ONE builder serves the bundled tone, the built one, the
  phone's own alarm and the stand-down. **Never reach for
  `MediaPlayer.create()` here again.** The plugin also logs the whole path —
  which source, whether it opened, whether it started, and any error mid-loop —
  because silence with no explanation is the one outcome nobody can act on.
- **A floor with a case where it stops holding is not a floor.** Three ways it
  quietly stopped: the watch bailed out on a momentary `false` from
  `isPlaying()` and never rescheduled — MediaPlayer gives that freely while
  preparing, seeking or recovering from an interruption, so one false killed
  the floor for the rest of the call; a once-a-second tick let a thumb held on
  volume-down keep the alarm quiet long enough to be heard as quiet; and
  `setStreamVolume` alone is refused on devices that would still honour
  `adjustStreamVolume`. So the watch now runs for as long as the PLAYER EXISTS
  (`stopFloorWatch` is the only thing that ends it, and `stopPlayer` is the
  only thing that calls it), ticks at `FLOOR_TICK_MS` (400 ms) starting
  immediately, registers a `ContentObserver` on `Settings.System` so a volume
  change is corrected in the same breath as it is made, and climbs with
  `ADJUST_RAISE` when the absolute set is refused. The player is also pinned at
  `setVolume(1f, 1f)` — the stream's level and the player's own multiply, so a
  player under 1.0 caps the alarm below the floor whatever the stream says.
  The observer must be unregistered in `stopFloorWatch` BEFORE
  `restoreAlarmVolume` runs, or the restore is instantly undone by its own
  notification.
- **The floor holds ITSELF, on the plugin's own timer.** It used to be
  re-applied only when the web layer repeated `alert()` every 1.7 s — which
  makes an alarm's loudness depend on a JavaScript timer inside a WebView, and
  Android throttles those the moment the page is busy, backgrounded or
  scrolling. A thumb on volume-down during a live call then took the alarm
  stream to zero and nothing put it back: the tone went on playing, correctly,
  into silence. Reported as "when I lowered the volume the sound stopped
  entirely". `startFloorWatch` re-asserts once a second for as long as the
  plugin's OWN player is running, and `stopFloorWatch` runs first and
  unconditionally in `stopPlayer()` — a watch left behind holds somebody's
  phone at 70% after the call was acknowledged. `noteFloor` logs to logcat only
  when the outcome CHANGES, or a once-a-second line buries everything else.
- **The speaker check runs ITSELF at sign-on, on the shell only.**
  `src/domain/speaker-check.jsx` (rules under `npm test`) + the effect in
  `TeamView`. The buttons have always been there and are pressed on somebody's
  first day and never again; a phone that has gone quiet since is discovered by
  missing a call. So the crew screen plays the dispatch tone down the same path
  a real call takes, once per sign-on, and puts the answer on the screen —
  including "this phone is at 10%, turn it up". Keyed by person + truck +
  shift window together, remembered on the DEVICE, so a refresh, a re-render
  or coming back from the background is not a second tone but the same crew
  member's next shift is. It never runs in a browser (page audio cannot play
  before a tap, and silence pretending to be a check reads as a broken
  speaker), never over a live alarm, and never on a truck already out on a
  call. `soundSpeakerCheck` now RETURNS what the shell said, because a check
  whose result nobody sees is not a check.
- **A guard that only speaks when it FAILS cannot answer "what happened".**
  The floor line printed only on a refusal, so "FLOOR not attempted yet"
  vanished after the first call and the screen went quiet — the crew line said
  nothing at all about an alert that had just gone wrong. `volumeFloorNote`
  (`npm test`) always says what the floor last did. And a reading taken after
  the call is the volume NOW, which is not the question: the plugin keeps
  `alarmVolumeMinPct` (the lowest the alarm stream reached while the tone was
  playing) and `floorRaises` (how many times it put it back), reset when a
  FRESH alert starts and never on the 1.7-second repeat, so the line reads
  `FLOOR put it back to 70%, dipped to 0%, put back 3×` once the call is over.
  That one line separates "volume-down hit the alarm stream and we corrected
  it" from "volume-down hit some other stream and the sound died for another
  reason" — which no amount of watching a phone can.
- **A raise that is REFUSED looks exactly like one that worked — so verify it,
  and say which.** `raiseAlarmVolume` used to call `setStreamVolume` and assume
  it landed. Android accepts that call and quietly does nothing under Do Not
  Disturb without notification-policy access, and several manufacturers' focus
  modes do the same: no exception, no error, the stream stays where the thumb
  left it, and every diagnostic on the phone said fine. It now reads the stream
  back (`after >= want`) and records `volumeFloorOk` / `volumeFloor` on
  `status()`, which reaches the crew's diagnostics line, `BackgroundAlertNotice`
  and the owner's device diagnostics. A refused raise also no longer arms
  `restoreAlarmVolume`: it changed nothing, so it has nothing to put back, and
  arming it wrote the LOWERED value back as "the owner's setting".
- **An iPhone answers `backgroundStatus` too.** It had no such method, so the
  four-settings notice and the crew's diagnostics line were blank on exactly
  the devices where the volume slider is the only thing between a call and
  silence. iOS reports its output volume (as `alarmVolumePct` as well, so one
  reader serves both platforms), notification permission, and the channel and
  battery fields as fine — an undefined value reads as a fault in the notice.
  `alert()` hands the volume back on BOTH the first call and the 1.7-second
  repeat, so the crew line tracks the volume buttons live. `alarmLoudnessNote`
  (`npm test`) turns that into the words on the line, and the notice tells an
  iPhone to turn it up BEFORE the shift, because nothing can raise it after.
- **A notification channel belongs to the user, not to the app.** Android
  refuses to change an existing channel's importance, sound or DND bypass, for
  ever — so a handset that installed an early build, or whose owner once chose
  "turn off notifications like this", kept a silent channel that reinstalling
  did not fix while the phone beside it was fine. `CHANNEL_ID` carries a version
  and the old ids are deleted on the way past. Bump it whenever the sound, the
  importance or the bypass changes; nothing else can hand somebody a corrected
  channel.
- **Four settings silence the alert and the app may change none of them.**
  Notifications off, the channel silenced, the alarm stream at zero, battery
  optimisation on. `backgroundStatus()` reads all four and `BackgroundAlertNotice`
  names the one in the way with a button that opens that exact settings page —
  ask for that line before diagnosing "no tone". The alarm volume and audio
  focus are the two the plugin does handle: it raises the alarm stream to 70%
  for the length of an alert and puts it back, and takes transient focus so
  navigation ducks. Three details of that floor, each a report once: `notify()`
  raises it too — the channel sound is the path a phone woken from a pocket
  takes, and it used to play at wherever the slider sat; the repeating
  `alert()` no-op re-asserts it, or volume-down mid-alarm made the tone "go
  quiet by itself" (acknowledging is how an alert goes quiet); and
  `volumeBefore` records the owner's setting only once, or a mid-alarm
  re-raise "restored" the stream to mid-alarm quiet for every alert after.
- **The stand-down speaks; the repeat must not.** `speakStandDown` opens with
  `speechSynthesis.cancel()` — it has to, or a second stand-down queues behind
  the first. That is right when it is called once and wrong on a loop: a repeat
  every 450 ms cut the sentence mid-word and the crew heard "the call — the
  call — the call" until they pressed Understood. `soundStandDownTone` is the
  tone alone and is the only thing that repeats. The words are said once, twice
  over, at the start.
- **The tone leads the stand-down and the words follow it.** Speaking takes the
  device's audio session — an iOS utterance activates its own, Android takes
  audio focus — and `speakStandDown` holds it for roughly the first four
  seconds. With the words first, the three tones scheduled at 0/450/900 ms were
  spoken over, and the first tone a crew actually heard was the repeat at four
  seconds. Reported twice off a handset as "the phrase played, the tone did not,
  then a tone came a few seconds later". Tone at 0, words at 1400 ms, repeat
  from 5600 ms: nothing scheduled on top of anything else.
- **Stopping the alarm must not stop the stand-down with it.** A cancellation
  does both at the same moment, from two places in the web layer, and on the
  shells they land on the main queue in whichever order they arrive. When
  `stop()` won, iOS deactivated the audio session out from under the stand-down
  player that had just started, and Android handed back audio focus and dropped
  the alarm stream — so the crew heard the spoken sentence, no tone, then a tone
  four seconds later when the repeat came round. Reported exactly like that from
  a handset. `stopPlayer()` returns early while a stand-down is playing; the
  stand-down's own completion tidies up after it.
- **`ems:requests` and `ems:log` shrink on a healthy board, on purpose.**
  `pruneArchivedWork` drops a completed call four shifts after its own shift was
  filed and finalised — verified against the stored submission, not assumed from
  dates — and its log lines with it. So `restore.mjs diff` reporting those two
  as "smaller now" is usually the board tidying itself, not a loss: check
  whether `ems:archives` and `ems:submissions` grew. Putting them back
  resurrects filed calls onto the live board twice. The tool says so itself now,
  because the `put` command it prints looks like the obvious next step.
- **A statistic is counted over the board PLUS the archive, never the board
  alone.** `src/domain/stat-source.jsx` — `statsRequests` / `statsLog`, merged
  by record id with the live copy preferred. The live stores are working stores:
  `pruneArchivedWork` takes a filed call off four shifts after its shift was
  finalised, and `ems:log` is capped at 400 lines regardless — and sign-on and
  sign-off are log lines, which are the DENOMINATOR of every UHU figure. So a
  month whose shift log downloaded as a forty-call PDF showed a handful of calls
  and a UHU nobody recognised, and restoring a backup could not fix it because
  nothing was ever missing: `ems:submissions` had it all along and the
  statistics were not looking there. `IndicatorBand`, `Statistics` and
  `OvertimePanel` all read the merged corpus — overtime for the same reason, a
  pay period is thirty days and the claim is built from a sign-off line the
  board no longer holds. Anything new that counts a PERIOD must do the same.
  `FiledNote` says how much came from the archive, because a figure that grew
  without the board changing is one somebody has to be able to explain.
- **A log line belongs to ONE shift, and the line says which.** `logShiftHome`
  / `logForFiledShift` in `domain/shift-log.jsx`. Both re-cuts of a filed
  submission used to end the window at `Date.now()` to pick up the sign-offs
  that landed after the desk submitted — so a day shift finalised at 21:00
  swallowed the night crew's 19:00 sign-on, which is also in the night shift's
  own submission: the same line filed under two shifts and printed on two
  sheets. Held open by a running call it took DAYS of that station's lines the
  same way. A line that NAMES a shift (`detail.shiftStart`) belongs to that
  shift wherever its clock time falls — an Alpha signing off at 19:40 in
  overtime worked the day — and everything else belongs to the window its
  timestamp is in. Resolved through `shiftWindowAt`, never compared outright:
  Zahrawi starts at 09:30, and a line matching no window is filed under nothing
  and lost from every sheet.
- **Only a shift's OWN crew hold its log open.** `shiftStillStaffed` in
  `domain/shift-log.jsx`, under `npm test`. The automatic filing asked "is
  anyone at the station seated?" — and at a station that runs around the clock
  the answer is always yes, because the night crew sign on before the day
  shift ends. So the day log never filed while the operational day beside it
  was kept perfectly well: "1 kept, 0 filed". A seat holds a window open only
  if the person in it signed on FOR that window (`shiftStart` on the seat), and
  a seat still held a whole shift after the window closed is a forgotten
  sign-out, not a shift still running.
- **The ambulance number is asked of each shift, and the field starts EMPTY.**
  `ambulanceInput` in `TeamView.jsx` — a second, unguarded effect mirrored the
  unit's stored number into the field on every poll, undoing the guard above
  it, so the crew signing on found last shift's truck already typed in and
  pressed Confirm beside it. The number is stamped with `ambulanceShiftStart`;
  the field shows it only when that stamp is THIS shift's window.
- **The shell paints the mark before the script runs, and the splash never
  waits on a chain of reads.** `#splash` in `index.template.html` is plain HTML
  with the lockup inlined by `build.mjs` from `BRAND_LOCKUP_SRC`, hidden by CSS
  the moment `#root` has content — a cold start used to be an empty dark page
  for as long as the 1.6 MB script took to compile. After sign-in `loadAll`
  reads its six small keys with one `Promise.all`; one after another they were
  six round trips to Riyadh under the CONNECTING screen. The theme attribute is
  set from localStorage by a one-line script in the head, so a light-theme
  phone does not open dark and flip.
- **A prompt built from a slow-poll key waits for the slow poll.** `coldReady`
  in `App.jsx`, set only after `RESTOCK_KEY` and `CHECKLIST_RUNS_KEY` have been
  READ successfully. The restock nudge, the History badge and the
  mandatory-checklist demand were computed from the empty defaults on first
  render and claimed, for one round trip after every refresh, that calls were
  waiting and a checklist was owed — an amber banner that flashed and vanished
  on every open, on film. Anything new that prompts a person off a cold key
  must gate on it too; `loadCold` reads its keys together for the same reason.
- **A call stood down before arrival, or refused, was run as NO service: Svc
  is E.** `serviceTypeFor` in `uhu-person.jsx`, under `npm test` — never ALS,
  BLS or CCT, whatever category or code the record carries: the category says
  what was asked for, E says what was delivered. A call stood down AT the
  bedside keeps its level, because the crew responded to it.
  `stoodDownBeforeArrival` in `close-reasons.jsx` is the one definition
  (reason says called off AND no arrival stamp) shared by the Svc column, the
  restock list, the picker's suggestion and the PCR-compliance denominator —
  a call with no patient cannot be missing a patient care report. The PDF's
  summary tiles say TRANSFERRED and CANCELLED / NO TRANSPORT, never
  "Completed" over rows the sheet itself calls CANCELLED.
- **The sign-in screen draws every list off the board it read itself.**
  `boardUnits` in `LoginScreen.jsx` — the `units` prop is the app's poll, and
  on a phone that has just signed in the poll has not run (it waits for a
  token), so the station list said "0 medics on this station" and the team
  list was empty for the first seconds of every sign-in. The screen reads
  `ems:units` the moment the password is accepted and every five seconds
  while somebody is choosing, and says "Reading the board…" until it has.
- **A filed log is held open only by its own crew, exactly as the automatic
  filing is.** `submissionOutstanding` — the finalise pass counted every seat
  at the station, so a day log filed while the night crew were seated was
  never finalised, its overtime never final, its calls never tidied away.
  `unitsStaffedForShift` is the one rule for both, with a one-shift grace for
  a forgotten sign-out.
- **The desk has no seat on the board, so "who is on the desk today" is read
  from the shift log.** `dispatchersOnDuty` in `domain/desk-duty.jsx`, under
  `npm test`: a stay runs from its `kind: "on"` line (role `dispatcher`) until
  an `off` line for the same person AND the same window, never past one whole
  shift after the window closed (a forgotten sign-out, not a desk still
  working), and an `off` from an earlier stay does not end a later one. The
  admin's Teams page draws it above the rosters — shift, since when, time left
  or overtime — with the same whole-shift grant the seats have:
  `grantWholeShiftOvertime` takes `unit: null` and keys the decision to
  `desk`, named "Dispatch desk" on the overtime panel. The live log is capped
  at 400 lines, so the panel says "no sign-on in the log" rather than "nobody
  on the desk".
- **Being signed out on a device never empties the seat — but the desk can
  clear a seat a signed-out phone left behind.** The seat belongs to the person
  (changing phones is not a sign-out), so a one-phone sign-out, a dead handset
  or going home early leaves the seat on the board showing AVAILABLE with no
  live phone behind it, and a refresh cannot fix that — the seat is genuinely
  still theirs. `reliefSituationFor` returns `on-shift` for such a seat, and
  the dispatcher roster card now offers **Sign out** on it (not only on a
  shift-ended `forgot-to-sign-out` seat); `still-out` stays excluded so the
  desk can never take a running call off a crew. `relieveSeat` closes the
  hours at NOW for a still-running shift (not at shift end) and logs it as
  "mid-shift, seat left by a signed-out phone". The crew's own recovery is
  unchanged: sign in on the new phone and Continue as MEDIC N.
- **ADDED SERVICE is the sheet's own column, and it is a PICKER.** `addedService`
  (singular) — sheet column Q, vocabulary `ADDED_SERVICES` in
  `sheet-vocabulary.jsx`, already on the export, already in `EDITABLE_FIELDS`
  for the desk and already chased by `LOG_COMPLETENESS`. The crew's control sits
  under LOADED KM on the call card (`TeamView`, `setAddedService`) as the same
  chip row CALL TYPE and LOADED KM use, so the crew and the desk pick from one
  list and what is chosen is the word that lands in the column. A free-text
  `addedServices` (plural) shipped for one build and was a SECOND field for the
  same thing, typed beside a column that has a vocabulary; a record still
  carrying one shows it as a caption under the picker rather than losing it. It
  is NOT one of the three paperwork ticks and never blocks going back in
  service — no ring beside it — and tapping the code already set clears it,
  because a picker with no free text is otherwise a choice that cannot be
  taken back.
- **The elapsed clock on the call card ticks every SECOND.** It ran on a
  15-second interval to save re-renders and read as a frozen app: 00:02:58 sat
  still and then jumped to 00:03:13, on the one number a crew watch to know
  their response time. Reported as "the counter is not smooth". A card is a
  handful of elements; one re-render a second costs nothing beside a stopwatch
  nobody trusts.
- **The desk's note on a call carries its own caption.** `NOTES FROM DISPATCH`
  in the route block — an unlabelled paragraph under the destination reads as
  part of the address, and the crew asked where the notes banner had gone. It
  is drawn only when the call has notes: an empty banner on every call teaches
  a crew to stop looking at it.
- **The employees schedule is the plan, not the board.** `src/domain/schedule.jsx`
  (rules under `npm test`) + `src/ui/SchedulePage.jsx`, on the admin Teams page,
  gated on the `schedule` delegation area so it can be lent to a preparer. Six
  weeks of codes per employee, grouped; a code is set, changed or cleared by
  tapping the cell. The rules are checked live: 22 shifts per employee (office
  staff exempt), overtime ≤ 80 h (H6 = a 12 h day, 6 of them overtime; a bare
  H/P/CH/CP is a whole overtime shift), no sixth working day in a row, no more
  than five off days in a row, a leave bracketed by a worked day each side.
  Coverage rows count PEOPLE (a team is two) against the department's minimums,
  weekend = Fri/Sat. Stored as ONE object in `ems:schedule` (an
  `ADMIN_ONLY_KEYS` key, writable by the schedule area), written whole on each
  edit like `ems:inventory` — this is a planning doc, not the live board, so
  the whole-key write is the right shape here. It rides the slow poll only.
  Dates are the DEVICE's local day (Riyadh), keyed `YYYY-MM-DD`, deliberately
  NOT the 07:00 operational boundary — a planner reads a wall calendar.
- **The schedule has two documents from one source, and the totals never cross
  over.** `src/export/schedule-export.jsx`. The staff PDF is the department's
  own KFSH layout (title band, the six-column legend, the navy period band, the
  Hijri/Gregorian/day-of-week header, group separators, the colour coding) and
  carries the GRID ONLY — no per-employee shift or overtime totals, no
  per-day coverage or team totals. The Excel working copy carries exactly those
  three (Shifts, OT h, the coverage rows and a TOTAL TEAMS/PEOPLE row) for the
  next revision. The PDF is offered only once the schedule is APPROVED. The
  owner/admin account never appears on the roster (`scheduleEligibleAccounts`
  filters the `isOwner` row from the picker and the view).
- **The schedule's codes are editable, and the edits travel with the sheet.**
  `effectiveScheduleCodes` / `effectiveScheduleCodeOrder` merge the built-in
  legend with the schedule's own `customCodes` (added or label/colour-overridden)
  and `hiddenCodes`, and EVERY reader goes through them — the picker, the
  legend, the grid, `employeeScheduleSummary` (which takes a `codes` map), and
  both exports — so a custom code is the same code everywhere. `normalise` in
  `SchedulePage.jsx` MUST carry `customCodes`/`hiddenCodes` or the next edit
  wipes them (it read them back stripped once). A custom code's `kind`
  (day/night/overtime/office/off) decides how it counts; coverage rows stay on
  the built-in sites. The admin's own account is excluded, and the employee
  NAME column is `position: sticky; left: 0` so it holds while the 42 days
  scroll.
- **The schedule is prepared, submitted and approved, and any edit reopens it.**
  `status` on `ems:schedule` is draft → submitted → approved with a climbing
  `version`. A preparer (schedule area) submits; a REAL admin (`role === "admin"`
  and not `isDelegatedAdmin`) approves or sends back; `saveEdit` stamps the
  object back to draft on any content change, so an approved sheet on screen is
  always the one that was approved. Approval authority is enforced in the UI
  only — a schedule-area delegate can write the key — which is the same trust
  every delegated area carries; server-side sub-field enforcement is a later
  refinement if it is ever wanted.
- **Signing on somewhere else releases the seat you left behind.** `releaseAbandonedSeat`
  in `App.jsx`, from `handleLogin`: if the account was holding a seat and this
  sign-on is NOT continuing that exact seat (they came in as admin, on the desk,
  or on a different truck), the old seat is signed out at once — hours closed at
  now, an `off` line logged, a queued reliever taking it if there is one — so a
  truck is never left showing AVAILABLE with no live phone behind it. A truck
  OUT on a live call is left alone (`liveRequestFor`): that is the desk's to
  resolve, never a sign-in's. The change-phones path (`Continue as MEDIC N`,
  same unit and slot) keeps the seat, exactly as before.
- **The UHU and event-log side column belongs to the roster level, not inside a
  section.** `adminPanelOpen` in `App.jsx` — `AdminView` reports its open panel
  through `onPanelChange`, and the side column is gated on
  `navTab === "teams" && !adminPanelOpen`, so opening a section (the schedule,
  accounts, a kept day) gives it the full width and the column returns when the
  section is closed.
- **A sheet prints one row per record id, and `dedupeById` is the last gate.**
  `exportAndShareLog` dedupes both lists on the way in and `buildDispatchLogAOA`
  again before sorting. Everything upstream merges by id, but a workbook is
  built from several sources at once — board, submission snapshot, kept day,
  restored backup — and the sheet is the only place a duplicate is visible to a
  human, where a call printed twice reads as two jobs and every total summed off
  the page is wrong by one.
- **Checklist compliance counts SHIFTS COVERED, not lists filed.** The rule is
  one list per person per shift, so somebody who changed truck mid-shift filed
  twice and scored two out of one shift — clamped to 100%, which then paid for a
  shift they had filed nothing on. Over a month that reads as full compliance on
  a department that is not at full compliance. Keyed by the shift window, the
  same key `shifts` uses, and only counted for a shift the log says they worked,
  so numerator and denominator are the same set.
- **A repeat of `alert()` must be a no-op, not a restart.** The web layer calls
  the plugin every 1.7 seconds for as long as a call is unacknowledged, and both
  plugins used to stop the player and build a new one each time. `stopPlayer()`
  ran FIRST, so any rebuild that failed — another app taking the audio device,
  the activity mid-pause — turned a working alarm into permanent silence, and
  there is no second chance once the page is frozen. It also re-took audio focus
  every pass (a fight the alarm can lose when somebody opens another app) and
  restarted the vibration from its first pulse. Both players already loop; if
  one is playing, resolve and return.
- **A stand-down must go out the same way the alarm did.** It was Web Audio and
  nothing else — the one context least likely to work at that moment, because an
  alarm has just been playing over it on the system path and the app has
  probably been backgrounded. A crew who were never told the call was off keep
  driving to a patient nobody needs moved, which is worse than a missed alert.
  `soundStandDownTone` goes through the plugin's `standDown` (one shot; the
  repeat stays in the web layer) and falls back to the page tone without it.
- **Read `REQ_STATUS` through `reqStatusMeta`, never directly.** The crew's own
  call card did `REQ_STATUS[status].color` unguarded, alone among every reader
  of that table, so any status the board holds that the table does not know
  threw there and React unmounted the tree — no card, no stand-down banner, no
  tone, nothing to press. A blank screen on a crew's own call is the worst one
  available. Note `statusMeta` in `domain/in-service.jsx` is a UNIT's status and
  `reqStatusMeta` is a CALL's; they are not interchangeable.
- **`BUILD_STAMP` says nothing about the SHELL, and the two ship separately.**
  `index.html` is copied into the project; the plugin is rebuilt in Xcode or
  Android Studio. Doing one and not the other looks completely healthy — today's
  build stamp, "plugin loaded" — while a method the web layer depends on simply
  is not there. A whole round of testing went into a stand-down that could never
  have worked, on a phone carrying an app built before the method existed.
  `SHELL_METHODS`/`shellReport()` name what this build needs and check it, and
  the crew line reads `SHELL IS OLD — rebuild the app (missing …)` rather than
  anything a crew would mistake for a settings problem.
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
  build another. A context is cheap; a silent tablet is not. Two later
  lessons of the same disease: the rebuild must happen SYNCHRONOUSLY, inside
  the tap — going through `resume()`'s promise first costs the user gesture
  on WebKit, and a context built outside a gesture starts suspended with
  nothing entitled to resume it, dead until the app is relaunched. And the
  SPEAKER CHECK must prove the path a dispatch actually takes: on a shell
  that is the plugin's alarm stream (`soundSpeakerCheck` — alert, then stop
  after two seconds), because checking page audio there tests a path a
  dispatch never uses and goes silent after every real call. The volume
  chip's preview and the arming taps stay on page audio on purpose — the
  preview demonstrates the chosen loudness, and an arming tap exists to
  unlock page audio itself.
- **A colour written as a literal cannot follow a theme.** `alarmAckBtn` had
  `background: var(--ink-alt)` with a hard-coded `#FFFFFF` text — and
  `--ink-alt` is near-white in dark mode, which is what every crew tablet runs.
  White on white, on ACKNOWLEDGE CALL, on the screen a crew looks at with a
  call coming in. `--ground` is the token that inverts alongside `--ink-alt`;
  pair them. A quick scan for a hard-coded light text colour on a
  theme-flipping background (`--ink*`, `--panel`, `--raised`, `--ground`,
  `--inset*`) finds this class of bug; white on `var(--crit)` or `var(--flow)`
  is fine, because those do not flip.
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
- **Moving to a lent area is not a sign-out.** `switchRole` in `App.jsx` flips
  the role the SCREEN is drawn for and writes nothing: the desk is kept, no
  sign-off/sign-on pair goes into the shift log, and the board never shows the
  desk empty. Switching INTO administration on lent authority must carry
  `delegatedScopes` with it — `canArea` reads the ABSENCE of that list as "a
  real administrator, holds everything", so without it a dispatcher lent the
  overtime alone was offered the whole of administration. The server still
  refuses the writes, but a screen that offers what it cannot do is a screen
  that lies. It is a plain function, not a `useCallback`: it sits below
  `if (!ready) return`, and a hook there is React error #310 and a blank screen.
- **A session is written once; authority moves underneath it.** Every session
  the sign-in screen builds must carry `ownRole`, `roles` and `delegation` from
  the account (`authorityOf` in `LoginScreen.jsx`) — none of them did, so
  `DelegatedTag` had nothing to draw the lent-area chip from and `RoleSwitch`
  had no second role to offer: a dispatcher lent the overtime saw no chip beside
  their name and no way into it without signing out, which is the whole feature.
  Carrying it at sign-in is still not enough — an area lent at 22:00 to somebody
  who signed on at 19:00 never appeared, and one taken back stayed on screen.
  `GET /api/auth/me` is re-read on the slow poll and merged in with
  `updateSession`, which is deliberately NOT `setSession`: that one stamps a
  whole new session and resets `overtimeWindow`, the marker saying this shift's
  crossing into overtime has already been logged, so using it on a poll writes
  the same crossing to the shift log every thirty seconds.
- **An administrator can take the dispatch desk, and it is a real dispatcher
  session.** The sign-in role choice offers it to admins only; it goes through
  the same shift and station steps and the same `finishDispatcherLogin`, so the
  log records a dispatch sign-on under their own name. The alternative people
  were using was signing in on somebody else's ID.
- **"Understood" has to outlive the screen it was pressed on.** The refused
  out-of-service notice was dismissed into component state, and Policies is a
  *shared* page — opening it unmounts the crew view, so coming back rebuilt it
  with the flag cleared and the refusal in the crew's face again. From their
  side the button did nothing. It is remembered on the device now, keyed by the
  answer's timestamp so a new refusal is still a new notice.
- **Signing out is a write, and the seat must not be released before it lands.**
  Releasing the seat makes the "somebody has taken your seat" effect fire, and
  that calls `setSession(null)`, which takes the token with it — in the middle
  of `handleLogout`. Every line after that point went to the board with no
  Authorization header and came back 401: the shift's `kind: "off"` entry, and
  with it the hours, the overtime claim and that stay's UHU. The screen looked
  right and nothing was recorded. `signingOutRef` holds the effect off while
  `recordSignOut` runs. It only ever bit crews — a dispatcher's sign-out
  touches no seat — which is to say it only bit the people the department is
  measured on.
- **A sign-off entry carries `unitId` and `station`, or it is not a claim.**
  Without them `overtimeClaimId` keys the stay to `"?"`, the claim files under
  the default station, and `heldByCallAt` has no unit to look for — so "were
  they on a call?" was always no. Whether a call held them is decided at
  sign-off and **stamped on the entry**; deriving it later from a live board
  that no longer carries the call gives the wrong answer every time.
- **Overtime is sent, not merely observed.** A stay a call held them through
  goes to administration on its own; anything else is the person's to send
  (`ems:overtimeSent`, written by them) or to leave. `ems:overtime` — the
  decisions — is `ADMIN_ONLY_KEYS`: anyone signed in could otherwise approve
  their own hours by posting to the board.
- **Authority is lent one AREA at a time, and it stands until it is taken
  back.** Lending the whole job was too much: "cover the overtime while I am
  away" should not also hand over the accounts, the policy shelf and the power
  to restore the board. `lib/delegation.cjs` is the list — the server's copy,
  because the server enforces it; `src/domain/delegation.jsx` is the app's copy
  for the screens, and `npm test` asserts the two cannot drift. `requireArea`
  guards a route, `mayWriteKey` guards a board key, `canArea` draws a panel.
  There is deliberately **no expiry**: an expiry that runs out mid-shift takes
  authority away at the moment it is being used, and revocation is immediate
  anyway because `requireAuth` re-reads the account every request. Two things a
  delegate may never do, both on `requireFullAdmin`: lend it on, and widen their
  own. Never trust `act` or `scopes` from the token on their own — they are
  re-derived from the account every time.
- **The mark that says "this fleet is the department's" belongs to the board.**
  It was in `localStorage`, which marks the tablet: a truck an administrator had
  removed came back the first time anybody signed in on a new phone. It is
  `ems:fleetSeeded` on the board now, read only when a top-up would otherwise
  happen — and a failed read is never taken as "never seeded".
- **One section banner, `SectionBanner` in `AdminView.jsx`.** A heading used to
  be one of three things depending on the screen. Buttons belonging to a
  section go *inside* its banner (`styles.bannerBtn`, sized for a banner, not
  the 40px `ghostBtnSm`). Do not reintroduce `styles.sectionHeader` as a 20px
  display heading: on a phone it wrapped across its own button, and per
  `design/README.md` nothing but NO COVERAGE may shout.
- **A repeating booking is a patient, not an arrangement.** Schedule →
  Repeating groups by MRN (`groupRepeatsByPatient`), because one patient can
  hold two standing arrangements and drawn separately they read as two people.
  MRNs are joined across spaces and hyphens — `MRN-1234` and `mrn 1234` are one
  person, and joining on the raw string answered "have we had them before?"
  with "no".
- **A repeating booking is an arrangement and is never dispatched.** The board
  used to release the template itself, so Schedule → Repeating showed a standing
  dialysis run as "Sun 23 Aug 07:15 · DISPATCHED" for ever, and it sat in
  Upcoming as a booking that had already gone. `schedIsTemplate` keeps it out of
  the release loop, out of Upcoming, off the pre-alert chime and off the export
  sheet; the occurrence it throws off for the day is what goes out. The booking
  pass repairs arrangements that older builds already dispatched.
- **A write says what CHANGED. It never sends the whole board.** This is the
  single most important rule in the app. The board used to be written whole —
  close one call and all sixty went up — which works perfectly until two people
  are using it: a phone that has been in a pocket for ten minutes holds a
  ten-minute-old board, and the first thing its crew taps sends that up and
  erases everything raised in between. No error, no queue, nothing to notice.
  Reproduced in a browser: **one tap on a sleeping tablet erased four of five
  calls.** `POST /api/board/records` merges `upsert`/`remove` into whatever the
  server holds, inside a transaction, so a stale device can only ever affect the
  records it actually touched. `writeList` for lists, `mergeWrite` for maps, and
  the merged board comes back so the writer adopts everybody else's work in the
  same breath. `mergeRecordsInto` is in `lib/merge-records.cjs` and is under
  `npm test`; do not reimplement it in the client.
  `POST /api/board` — the whole-key write — is still right for exactly two
  things: pruning the board when it outgrows the server (`board-size.jsx`), and
  a key that is genuinely one whole object. Reach for it and you are choosing to
  overwrite everybody.
- **The manual-call seat pickers list every crew member, not only the ones the
  log has seen.** `knownCrew(log, units, accounts)` in `domain/crew-roster.jsx`
  (under `npm test`) — the Alpha and Bravo dropdowns on `PastCall` (the admin
  form) now merge the accounts list in: anyone the board has actually seen
  sorts first (by last-seen), then every other crew member on file. Crew
  accounts carry role `crew` in the accounts table while a shift-log line for
  the same person carries `team`, so the merge accepts EITHER; a dispatcher and
  the owner are never crew. `accounts` is threaded PastCallSection → PastCallForm.
- **A call the board never saw can still be written up, and it says so.**
  `PastCall.jsx` — the desk types the six times, the truck, the route and *why*
  it is being entered by hand, and the record carries `enteredAfterTheFact`
  wherever it is read: on the folded row, beside the times, and as its own
  column on the sheet. `createdAt` is the time it RAN, not the time it was
  typed, or it files under the wrong operational day. A call that crosses
  midnight rolls forward rather than being refused. It cannot be credited to
  anybody's UHU — that comes from who was signed on at the time, and during an
  outage nobody was — and the form says so rather than pretending otherwise.
- **Getting data back is a button on the Backups panel**, and
  `scripts/restore.mjs` for the day the app will not open. Both compare a copy
  with the live board key by key, mark what holds fewer items than it did — the
  shape a loss makes — and put back only the keys chosen. A whole-file rollback
  throws away every hour worked since and is almost never the right answer.
  `/api/backups*` is `requireAdmin` throughout, a safety copy is taken before
  any restore, and accounts are unreachable from it.
- **A backup filename must not be able to land on an existing one.** Seconds
  were added when two copies in the same minute collided; seconds are not enough
  either, because taking a copy and restoring from it inside the same second is
  two clicks, and `db.backup()` overwrites — so the safety copy became a picture
  of the damage it was meant to undo, silently. `backupName(at, dir)` checks the
  directory and suffixes `-2`, `-3`. Found by a test that did exactly that.
- **A restore must not resurrect work that was in flight.** The first sweep put
  back whatever a copy held, so a call that was mid-dispatch two days ago came
  back reading `DISPATCHED · 48h · no crew signed on`, and bookings whose time
  had passed came back waiting for a team that would never be sent. A desk
  cannot tell a ghost from a job. `safeToRestore` in `server.js` puts back
  finished work — completed calls, dealt-with bookings, every log line — plus
  anything recent enough to still be real (a call raised inside the last day, a
  booking whose time has not passed). Everything else stays in the copy.
- **The panels a delegate sees are gated on the AREA, never the role.**
  `BackupPanel` tested `role === "admin"` — and a delegate holding the archive
  IS an admin session, but the areas decide what they may touch. The one person
  asked to look after the backups was the one person who could not see them.
  `canArea(user, "archive")`.
- **"Put back what is missing" reads EVERY copy, not one.**
  `POST /api/backups/sync-all` sweeps all thirty, oldest first, and adds every
  record the live board no longer has, by record id. A loss is rarely confined
  to the newest backup — the missing week is spread across the copies that saw
  it — so asking somebody to pick the right one is asking them to do the search
  by hand. Nothing already on the board is touched, a record in several copies
  comes back once and keeps its newest version, nothing is ever removed, and
  running it twice writes nothing. It skips anything a finalised submission
  already contains, so the completed calls `pruneArchivedWork` correctly dropped
  are not dragged back onto the live board.
- **A backup filename carries seconds.** Two in the same minute collided, and
  `db.backup()` overwrites — so the safety copy taken before a restore
  destroyed the copy being restored from. Backups are also settled to
  `journal_mode = DELETE` so each is one self-contained file: a `.db` with a
  live `-wal` beside it is not a database anybody can copy away safely.
- **A housekeeping pass must never run on a failed read.** `readKey(key, fallback)`
  answers an outage with the fallback, and inside an effect the fallback is React
  state frozen at the render the effect was created on. The archive pass used it,
  so a redeploy could have kept an operational day out of a stale snapshot and
  written that as the record. `readKeyRaw` and a `READ_FAILED` bail, always.
- **Wiping the board is `docs/RESET-THE-BOARD.md`, not a button.** The `-wal`
  file has to go with the `.db` or the last few minutes come back. Accounts live
  in their own table, so the board can be cleared without touching them.
- **`SHOW_LOGOS` and `ORG_NAME`** near the top of the app switch the crests
  and the organisation's name back on. Both are deliberately off/empty.

- **A guard that refuses must file a finding — every one does now.** The
  September pentest held 39 of 39 and the owner's System page showed NOTHING:
  the role/area/full-admin middleware, the forbidden board keys, the owner-only
  restore window, reset, restore and sync-all, the System page, the
  owner-account edits and the role `act` route all refused silently. Each now
  calls `noteFinding` (`refused-role`, `owner-power`, `probe`); `addFinding`
  merges identical messages with a count, so a UI bug hammering a route is one
  row, not a hundred. A backup download refused for a wrong token or ticket is a
  `probe` too. `process.on("unhandledRejection")` records a `server-fault`
  rather than letting Node exit — a rejection nobody caught used to be a few
  seconds of "offline" on every phone with nothing anywhere saying why.
- **The self-test must never pull the board into the JS heap.** "Every board
  key parses" was `JSON.parse` over `SELECT key, value FROM board` — on a
  year-scale board (131 MB) that is 70 MB of JSON on the main thread, measured
  under load as RSS at 2.2 GB and a **50-second p95 on every phone's poll**.
  It is `SELECT key FROM board WHERE json_valid(value) = 0` now, judged inside
  SQLite. The daily run is at `SELF_TEST_UTC_HOUR` (01:00 UTC = 04:00 Riyadh),
  through `nextDailyAt` like the backup, not "24 hours after boot", which
  could be shift change. The startup run at boot+90s stays.
- **Human-facing dates are stamped in `OPS_TZ`, never the host's zone.** An
  Alibaba Cloud image ships on UTC+8, so from 19:00 Riyadh the System page's
  history row was dated TOMORROW. `opsParts(at)` (default `Asia/Riyadh`)
  feeds the history day key and backup filenames; the backup HOUR stays UTC.
- **The backup token never rides in a URL.** The panel's download link used
  to carry `?token=` — a long-lived secret in nginx's access log, holding the
  key to every MRN. `POST /api/backups/:name/ticket` takes the token in a
  body (archive area AND token, the same two things a download always
  needed) and mints a 60-second single-use ticket bound to that one file;
  the tab is opened inside the tap and pointed at `?ticket=` afterwards, or
  iOS blocks it. `pull-backup.mjs` keeps the header. Compare with
  `backupTokenMatches` — constant-time, like every other secret here — and
  `BACKUP_NAME_RE` accepts the `-2` collision suffix `backupName` can emit.
- **Two sign-in date pickers and two `REQ_STATUS[...]` reads escaped their
  rules.** `OvertimePanel`'s range inputs had no `lang="en-GB"`; `DayArchive`
  and `ChatDock` read `REQ_STATUS[req.status].color` unguarded. Both rules are
  above; both were found by grepping for the pattern, which is the check to
  run when adding a date field or a status pill.

- **A seat somebody is working is theirs until they hand it over.**
  `src/domain/seat-handover.jsx`, under `npm test`. Taking a seat whose holder
  is MID-SHIFT no longer stands them down: the ask rides the relief queue
  (`unit.relief[slot]` with `needsApproval`), the person asking is signed on and
  WAITING (`awaitingRelief`, hours running from now), the holder's phone is
  pushed (`newHandoverAsks` in `lib/push-triggers.cjs`, no channel id — it must
  not sound like a call) and shows Approve / Decline at the top of `TeamView`.
  Approving is the holder's own sign-out — their hours close by
  `recordSignOut`, the seat transfers by the rule that already existed, and the
  log says "handed over … (approved on their phone)". Declining keeps the seat;
  `queuedReliefFor` never transfers a declined ask, the asker's phone signs off
  and the sign-in screen names who declined. A dead phone cannot answer, so
  `DispatcherView` lists unanswered asks with **Hand over now** (the holder is
  signed off with their hours, `forcedBy` the desk) and **Withdraw**. Two cases
  are NOT asks and must stay that way: a holder still out on a call is queued
  for (as before), and a holder whose shift is over and who is not out went
  home without signing out — nobody to ask, plain takeover (`handoverKind`).
- **One phone at a time, and changing phones is not a sign-out.**
  `startDeviceSession` in `server.js`: signing in mints a device session id
  (`active_sid` on the account, `sid` in the token) and every other token for
  that account is answered 401 with `X-Auth-Reason: other-device` on its next
  request. NOTHING on the board moves — the seat, shift and hours belong to the
  person — so the new phone carries on through "Continue as MEDIC 1" (which
  writes nothing) and the old phone's sign-in screen says exactly what happened
  (`loginNotice`, App → LoginScreen). An account that has never signed in
  through the rule (`active_sid` null) still honours its older tokens, so the
  rule arrives without signing the department out. Choosing a hat (`act`)
  keeps the same sid. The old phone's push tokens are dropped at the new
  sign-in; the new phone re-registers. **Any harness that mints tokens must
  carry the account's live sid** (`sidOf` in the pentest harness).
- **One phone at a time — but never silently out of a seat.** The owner opened
  the website with the account that was seated on MEDIC 1 in the app; the
  one-phone rule signed the app out, the app was locked so nobody saw it, and
  the next call assigned to MEDIC 1 made no sound — and the System page said
  nothing, because both guards fired silently. `POST /api/auth/login` now
  answers **409 `seated-elsewhere`** when another device is live for the
  account AND it holds a seat on the board (`seatHeldOnBoard`); the sign-in
  screen's `seatedElsewhere` stage says which truck and that continuing signs
  that phone out, and `force: true` is the person's answer. A partner's
  password check on a shared tablet sends `verifyOnly: true` and starts NO
  device session — it used to sign the partner's own phone out of the truck.
  Every displacement and every refused poll from the displaced phone is an
  `other-device` finding. `one-device.js` in the scratchpad harness covers all
  of it against a real server.
- **A waiting reliever is not the seat's occupant.** Two places assumed it
  was: `recordSignOut` treated a queued reliever pressing Sign out as the
  seat's holder — it stood the real holder down and "signed off" a seat the
  reliever never held — and the "someone took your seat" effect bounced a
  reliever to the sign-in screen twelve seconds after they queued, because the
  seat's accountId was never theirs. `recordSignOut` now withdraws the ask and
  closes the reliever's own short stay; the effect exempts a reliever whose
  ask is still on the seat.

- **A change the desk makes to a live call reaches the crew with a tone and a
  red star.** `src/domain/call-changes.jsx`, under `npm test`. Only the desk's
  APPLIED edits count (`byRole: "dispatcher"`, `status: "applied"`) — a
  correction the crew proposed themselves is theirs already — and nothing
  from before `times.assigned` is starred. `TeamView` keys the tone on
  `newestDispatchEditAt` (forced, like a message from the desk), stars each
  changed line (`Star`), and lists what it was and what it is now until the
  crew tap Seen; "seen" is a per-device timestamp in `lib/edits-seen.jsx`, so
  a phone that was locked while the desk edited catches up on its next read.

- **The crew's call card is the approved "one glance, one thumb" design.**
  `TeamView` — category colour on the SIDE (ALS red, CCT amber, BLS blue),
  status and elapsed time above the call, one route block (pick-up →
  destination, needs, MRN large and tabular, notes), the five stamps as a
  HORIZONTAL stepper (ticks behind, ring on now, nothing ahead, times under),
  the next stamp pinned under it, and PCR author / call type / loaded km as
  ONE paperwork strip that turns amber at the last step. Chips are the short
  codes (A–E, bands 1–5) with the names in a caption line, because the band
  names wrapped the strip onto four lines on a phone. Verified by rendering
  the real bundle at 390px (`scratchpad` harness: real server, seeded call,
  real sign-in) — that is the check to repeat when touching the card.
- **The sign-in screen reads the board before deciding where to send you.**
  `routeAfterPassword` used the `units` prop, which is empty on a phone that
  has just signed in for the first time (the poll waits for a token), so the
  person changing phones mid-shift — the one "Continue as MEDIC 1" exists
  for — was sent to pick a shift and a truck as if they were new.

## Checking your work

Two commands, and both must pass before you build.

**`npm test`** runs the domain rules for real — the ones in this file. That a
day runs 07:00 to 07:00 and files under the date it opened; that Zahrawi is
measured against nine and a half hours; that a crew who came on at one o'clock
is not credited with the call that ran at eight; that a checklist belongs to the
person and not the truck; that a stale `"available"` on an empty truck reads as
out of service; that an archived day exports with its own date and not today's;
that a crew stay is keyed by the shift window and never by the word "day".
Fifty of them, in `tests/domain.test.mjs`, each one there because getting it
wrong has been a real bug at least once. **When a fault turns out to be a rule
nobody had written down, add it there** — it costs nothing to run and it is the
only thing that will catch it coming back.

**`npm run check`** is the static half. It walks every module in `src/` and
asserts:

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

Between them: `npm run check` proves the code parses and every name resolves,
`npm test` proves it still does what the department decided it should do. A
green compile has never been evidence of the second.

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
