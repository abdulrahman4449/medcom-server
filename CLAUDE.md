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
- **A booked-ahead card is a diary entry, not a call card.** Bookings were drawn
  with the full call-card treatment and carried every control inline — a team
  picker, a reschedule button, a cancel button — 167px of controls under 92px of
  information, on every one. A day with eight transfers could not be read on a
  phone. The card says what the booking is and who is on it; `openCard` puts the
  controls one tap away on the one being worked.
- **A repeating booking is an arrangement, and the board carries today.**
  `REPEAT_HORIZON_DAYS` is 0 — occurrences reach the dispatcher board on the day
  they run, not two days early beside the calls being worked. The arrangement
  itself lives in Schedule → Repeating, which is where somebody goes to see what
  is coming or to stop it.
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
- **An employee ID is printed on a badge, so it is not enough to claim an
  account.** An account with no password yet needs a **one-time code** an
  administrator issues (`claim_hash`, hashed and salted like a password, spent
  on use, seven days). Without it, anyone who could name an ID that had never
  been signed into could become that person. A fresh database prints a bootstrap
  code for `F1525518` to the server log — that is the only way into a new board,
  and every code after it is handed out from Teams. Clearing a password issues
  the replacement code in the same call, because clearing without one leaves the
  person unable to set a new password and with nothing to say why.
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
  navigation ducks.
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
  build another. A context is cheap; a silent tablet is not.
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
