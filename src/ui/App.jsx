import { markAlertsArmed } from "../lib/sound.jsx";
import { clearToken, getToken, listAccounts, onAuthLost, removeAccount, saveAccount } from "../lib/auth.jsx";
import { BrandLockup, COLD_POLL_MS, HOUSEKEEPING_MS, LOG_CAP, POLL_MS } from "../brand/artwork.jsx";
import { APP_NAME } from "../brand/brand.jsx";
import { callFrom, callRoute, callTo } from "../domain/call-locations.jsx";
import { CHECKLIST_KEY, CHECKLIST_RUNS_KEY, emptyChecklists } from "../domain/checklist.jsx";
import { STATUS } from "../domain/constants.jsx";
import { COVERAGE_KEY, closeCoverageGapIfClear, openCoverageGapIfStuck } from "../domain/coverage.jsx";
import { queuedReliefFor } from "../domain/crew-relief.jsx";
import { ON_CALL_STATUSES, idleStatusFor, isOnCall, liveRequestFor } from "../domain/in-service.jsx";
import { INVENTORY_KEY, INVENTORY_MOVES_KEY } from "../domain/inventory.jsx";
import { DEFAULT_ACCOUNTS, DEFAULT_STATION, DEFAULT_UNITS, STATIONS, atStation, stationLabel, stationOf } from "../domain/live-sheet.jsx";
import { MESSAGES_KEY, clockStr, msDurationStr, otHoursStr } from "../domain/messages.jsx";
import { ARCHIVE_KEY, archiveOpDay, opDayComplete, opDayEnd, opDayLabel, opDayStart, requestsForOpDay, unarchivedOpDays } from "../domain/op-day.jsx";
import { OVERTIME_KEY, OVERTIME_SENT_KEY, heldByCallAt, overtimeClaimId, sendOvertimeClaim } from "../domain/overtime.jsx";
import { RESTOCK_KEY, callsAwaitingRestock } from "../domain/restock.jsx";
import { callsNeedingReturn, isRecurring, isReturnLeg, repeatOccurrencesDue, returnBookingFor, wantsReturn } from "../domain/return-journeys.jsx";
import { callTypeMeta, loadedKmMeta } from "../domain/sheet-vocabulary.jsx";
import { crewShiftWindow, overtimeMs, scheduledShiftKey, seatLabel, shiftAssignment, shiftMeta, shiftPhrase, shiftWindowAt } from "../domain/shift-helpers.jsx";
import { SUBMISSION_KEY, amendSubmissionsWithLateCalls, finaliseOpenSubmissions, requestsForShift, submissionId, submitShiftLog } from "../domain/shift-log.jsx";
import { SHIFTS, SHIFT_MS } from "../domain/shifts.jsx";
import { LOCATION_KEY, TRACKING_CONSENT_KEY, pruneLocations } from "../domain/truck-locations.jsx";
import { actorStamp } from "../export/name-stamps.jsx";
import { exportAndShareLog } from "../export/workbook.jsx";
import { API_BASE, READ_FAILED } from "../lib/board-api.jsx";
import { pruneArchivedWork } from "../lib/board-size.jsx";
import { ensureAudioCtx, nowTime, setNativeStandby } from "../lib/dates.jsx";
import { uid } from "../lib/helpers.jsx";
import { AlertTriangle, Radio } from "../lib/icons.jsx";
import { alertsSupported, registerAlertWorker, requestAlertPermission, requestNativeNotifications } from "../lib/notify.jsx";
import { connectionListeners, connectionOk, lastWriteError, loadPendingWrites, pushPendingWrites, readKey, readKeyRaw, totalPendingCount, writeInFlight, writeKey, writeList } from "../lib/offline-queue.jsx";
import { useCallback, useEffect, useRef, useState } from "../lib/react.jsx";
import { SESSION_VERSION, clearSession, patchSession, readSession, writeSession } from "../lib/session.jsx";
import { styles } from "../styles.jsx";
import { BottomBar } from "./AssistanceTasks.jsx";
import { DispatcherView } from "./ChatDock.jsx";
import { AdminView } from "./DayArchive.jsx";
import { Header } from "./Header.jsx";
import { LoginScreen } from "./LoginScreen.jsx";
import { PWRESET_KEY, pendingResets } from "./PasswordResets.jsx";
import { POLICY_KEY, PolicyLibrary, readPolicyFile } from "./PolicyLibrary.jsx";
import { LogSheet } from "./ShiftReport.jsx";
import { TeamView } from "./TeamView.jsx";
import { UhuPanel } from "./UhuPanel.jsx";
import { schedDue, whenStr } from "./booking-cancel.jsx";
import { GlobalFont } from "./font.jsx";
import { BIG_KEY_BYTES, POLICY_SHELF_LIMIT, bytesStr, keyName } from "./storage-banner.jsx";

// The board-wide mark that says the default fleet has already been laid down
// and the trucks on this board are the department's own from here.
const FLEET_SEEDED_KEY = "ems:fleetSeeded";


// ---------- is this board actually being kept, and is there room? ----------
//
// Two different questions with one answer between them, so they share a fetch.
//
// The first is whether the database survives a deploy at all — see server.js.
// The second is whether the disk it sits on is filling up. Every store in this
// app has a cap, so it settles at a ceiling rather than growing forever; the one
// thing with no cap is the policy shelf, which is scanned PDFs and is therefore
// the thing that will actually fill a disk if anything does.
//
// The percentage is read off the filesystem rather than added up from the rows:
// SQLite's file is bigger than the sum of its values, the write-ahead log sits
// beside it, and other things share a hosted volume. Only the disk knows.
export function StorageBanner({ role }) {
  const [state, setState] = useState(null);
  const warned = useRef(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/health`);
        if (!res.ok) return;
        const body = await res.json();
        if (!alive || !body) return;
        setState(body);

        // A notification, once, when it first crosses the mark. Not on every
        // poll: a warning that arrives every ten minutes is one nobody reads,
        // and this is a "sort it out this week" problem, not an alarm.
        const d = body.disk;
        if (
          !warned.current &&
          d &&
          d.measured &&
          d.warning &&
          (role === "admin" || role === "dispatcher")
        ) {
          warned.current = true;
          try {
            if (alertsSupported() && Notification.permission === "granted") {
              new Notification(`${APP_NAME} — storage ${d.usedPct}% full`, {
                body:
                  `${bytesStr(d.freeBytes)} left on the disk. ` +
                  `Nothing is lost yet, but the board stops being able to save when it fills.`,
                tag: "pulseops-disk",
                renotify: false,
              });
            }
          } catch (e) {}
        }
      } catch (e) {
        // Unreachable is the connection banner's job, not this one's.
      }
    };
    check();
    // Ten minutes. A disk does not fill between two blinks, and this is a
    // separate request from the board's own polling.
    const t = setInterval(check, 10 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [role]);

  if (!state) return null;
  if (role !== "admin" && role !== "dispatcher") return null;

  const db = state.database || {};
  const disk = state.disk || {};
  const big = ((state.board || {}).largest || []).filter((k) => (k.bytes || 0) >= BIG_KEY_BYTES);

  // Not being kept at all is the worse problem and gets said first.
  if (!db.survivesRedeploy) {
    return (
      <div style={styles.storageBanner}>
        <AlertTriangle size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
        <strong>This server is not keeping the board.</strong> The database is on{" "}
        {db.chosenFrom || "temporary storage"} ({db.path}), which is rebuilt on every deploy — the
        statistics, the filed logs and the archive will be erased the next time the app is updated.
        Attach a persistent disk in the hosting dashboard and point DB_PATH at a file on it.
      </div>
    );
  }

  if (disk.measured && disk.warning) {
    return (
      <div style={styles.storageBanner}>
        <AlertTriangle size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
        <strong>Storage {disk.usedPct}% full.</strong> {bytesStr(disk.freeBytes)} left of{" "}
        {bytesStr(disk.totalBytes)}. Nothing is lost, and nothing stops working yet — but the board
        cannot save once the disk is full.
        {big.length > 0 && (
          <span>
            {" "}
            Biggest: {big.map((k) => `${keyName(k.key)} (${bytesStr(k.bytes)})`).join(", ")}.
          </span>
        )}
      </div>
    );
  }

  // Disk is fine, but one store has grown out of proportion to the rest.
  if (big.length > 0) {
    return (
      <div style={styles.bigKeyBanner}>
        <AlertTriangle size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
        <strong>One store is unusually large.</strong>{" "}
        {big.map((k) => `${keyName(k.key)} — ${bytesStr(k.bytes)}`).join(", ")}. Everything else on
        this board is capped and settles by itself; this one is worth a look.
      </div>
    );
  }

  return null;
}

export function ConnectionBanner() {
  const [, force] = useState(0);

  useEffect(() => {
    // Driven by events only. It used to also re-render on a 2-second timer,
    // which made the banner twitch on a screen a crew is trying to read.
    const fn = () => force((n) => n + 1);
    connectionListeners.add(fn);
    return () => connectionListeners.delete(fn);
  }, []);

  const held = totalPendingCount();
  if (connectionOk && held === 0) return null;

  // Offline is the loud one. "Back online, still catching up" is quieter: the
  // crew can carry on, and it clears itself.
  // The server is reachable but refusing to store what it is sent. Nothing is
  // lost, but it is not being saved either, and pretending it is offline hides
  // a problem that will not fix itself.
  if (lastWriteError) {
    return (
      <div style={styles.offlineBanner}>
        <AlertTriangle size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
        {lastWriteError}
        {held > 0 ? ` ${held} change${held === 1 ? "" : "s"} waiting.` : ""}
      </div>
    );
  }

  if (!connectionOk) {
    return (
      <div style={styles.offlineBanner}>
        <AlertTriangle size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
        NO SIGNAL — you can keep working. Everything you enter is saved on this device
        {held > 0 ? ` (${held} waiting)` : ""} and sent automatically when signal returns.
      </div>
    );
  }

  return (
    <div style={styles.syncingBanner}>
      <Radio size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
      Back online — sending {held} saved {held === 1 ? "change" : "changes"}…
    </div>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  // Restored from the last session on this device, so a refresh doesn't make
  // anyone sign in again. It is still checked against the board once the data
  // arrives — see the two effects near the bottom of this component.
  const restoredSession = useRef(readSession());
  const [user, setUser] = useState(() => (restoredSession.current ? restoredSession.current.user : null));
  const [units, setUnits] = useState([]);
  const [requests, setRequests] = useState([]);
  // Requests booked for a future time. Held apart from `requests` so a booking
  // for tomorrow is never mistaken for a live call — see the scheduling section
  // near ScheduledRequests.
  const [scheduled, setScheduled] = useState([]);
  // The kept days. Read once at load and refreshed whenever one is closed.
  const [archives, setArchives] = useState([]);
  // Shift logs the desks have submitted, per station.
  const [submissions, setSubmissions] = useState([]);
  // Periods with no ambulance available, per station.
  // Which tab is showing, and the anchors it scrolls to.
  //
  // Declared here with the other hooks, above every early return. A hook placed
  // after `if (!user) return <LoginScreen/>` is skipped on the renders that show
  // the login screen and called on the ones that do not — React counts hooks by
  // order, sees the count change the moment somebody signs in, and throws. That
  // is precisely what turned the screen black after choosing a station.
  // Every role opens on its board. It is the thing anybody signing in wants to
  // see first, and for a desk mid-shift it is the only thing.
  // Light or dark, remembered on this device.
  //
  // A desk under fluorescent light at midday and a crew in a cab at 3am are not
  // looking at the same screen, and neither should have to squint. The choice
  // belongs to the person, not to the app — and it is kept per device, because
  // the tablet in the truck and the desktop at the desk are different rooms.
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("ems:theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch (e) {}
    return "dark";
  });

  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem("ems:theme", theme);
    } catch (e) {}
  }, [theme]);

  const [navTab, setNavTab] = useState("board");
  // Bumped when the bar's New call is pressed. The form itself stays where it
  // lives, on the dispatch board; this only tells it to open.
  const [newCallSignal, setNewCallSignal] = useState(0);

  const [coverage, setCoverage] = useState([]);
  // The checklist items administration has set, and every list filed.
  const [checklists, setChecklists] = useState(emptyChecklists());
  const [checklistRuns, setChecklistRuns] = useState([]);
  const [overtimeSent, setOvertimeSent] = useState({});
  const refreshAccountsRef = useRef(null);
  // True while a deliberate sign-out is being recorded. See `handleLogout`.
  const signingOutRef = useRef(false);
  const [messages, setMessages] = useState([]);
  const [inventory, setInventory] = useState(null);
  const [inventoryMoves, setInventoryMoves] = useState([]);
  const [overtimeDecisions, setOvertimeDecisions] = useState({});
  const [locations, setLocations] = useState({});
  const [trackingConsents, setTrackingConsents] = useState({});
  // The policy shelf, and whether an upload is in flight.
  //
  // These four were referenced by the Policies tab but never declared, so
  // opening that tab threw a ReferenceError before the first element was
  // built. React unmounts the whole tree on a render error, which is why the
  // screen went black and nothing on it responded — the app was gone, not
  // frozen.
  const [policies, setPolicies] = useState([]);
  // Who is locked out. Cold: it changes when somebody cannot get in, which is
  // rare, and the page that shows it refreshes on every tab change anyway.
  const [passwordResets, setPasswordResets] = useState([]);
  // Which finished calls have had the truck made up again after them.
  const [restockDone, setRestockDone] = useState({});
  const [policyBusy, setPolicyBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [clock, setClock] = useState(nowTime());
  const storageOk = useRef(true);
  const audioCtxRef = useRef(null);
  const userRef = useRef(user);
  // Units that looked orphaned (pointing at a finished call) on the previous
  // poll, so the repair pass in loadAll only acts on a condition that held
  // twice rather than on a snapshot taken mid-write.
  const staleUnitsRef = useRef(new Set());
  // Identifies this open board when it claims a due booking, so only one of the
  // desks polling at the same moment turns it into a live call.
  const clientIdRef = useRef(uid("board"));
  // Guards against a slow release overlapping the next poll.
  const releasingRef = useRef(false);

  // Signing in and signing out are the only two things that change who this
  // device is, and both have to be mirrored to storage or a refresh would
  // resurrect a session that had already ended.
  const setSession = useCallback((next) => {
    userRef.current = next;
    setUser(next);
    if (next) writeSession({ v: SESSION_VERSION, user: next, overtimeWindow: null });
    else {
      // Signing out has to take the token with it. Leaving it behind would
      // leave a signed-out tablet holding a working key to the whole board.
      clearSession();
      clearToken();
    }
  }, []);

  // Browsers only let a page make noise, buzz or ask about notifications off
  // the back of a real interaction. Sign-in provides one; a session that came
  // back from a refresh never had one, so the first tap or key press on the
  // restored page arms everything again.
  const armAlerts = useCallback(() => {
    try {
      const ctx = ensureAudioCtx(audioCtxRef);
      if (ctx && ctx.state === "suspended") ctx.resume();
      // Remembered, so a reload does not ask the crew to arm alerts they
      // armed days ago. The first tap on the restored page does it again
      // without anybody being told.
      if (ctx) markAlertsArmed();
    } catch (e) {
      // audio not available; ignore
    }
    // On the native iOS app only: switch the audio session to "playback" so
    // the alert tone can sound through the hardware silent switch, the same
    // way a podcast or alarm app does. No-op everywhere else (web, Android) —
    // window.Capacitor only exists inside the native shell at all.
    try {
      window.Capacitor?.Plugins?.AudioSession?.enablePlaybackCategory?.();
    } catch (e) {
      // native plugin not available; ignore
    }
    // Crews need this for an incoming call; the dispatch desk needs it for the
    // quarter-hour reminder on a booking, which is no use if it only shows on a
    // tab nobody is looking at.
    if (userRef.current) requestAlertPermission();
    // The shell's own permission, which is a different one entirely: the
    // browser API does not exist on a native build, so without this an iPhone
    // shows no banner for an incoming call at all.
    requestNativeNotifications();
  }, []);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // On duty means awake. See setNativeStandby: an iOS app that is not playing
  // audio gets suspended, and a suspended app has stopped polling, so a call
  // raised while the phone is in a pocket never reaches it and there is nothing
  // for the alarm to sound about. Signed out, the shell is let go again.
  useEffect(() => {
    setNativeStandby(!!user);
    return () => setNativeStandby(false);
  }, [!!user]);

  useEffect(() => {
    registerAlertWorker();
    // Asked on mount as well as at sign-in. A tablet that came back from a
    // refresh with its session restored never goes through the sign-in screen,
    // so asking only there left exactly the long-running devices this matters
    // most on without permission. iOS does not require a gesture for this one,
    // and it only ever prompts once however many times it is called.
    requestNativeNotifications();
  }, []);

  // Whatever this device was still holding when it was last closed. Without
  // this, force-quitting the app underground — or the tablet simply running out
  // of battery — would throw away the stamps it had not managed to send yet.
  useEffect(() => {
    // Backspace must not navigate.
    //
    // Older browsers treat Backspace outside a text field as Back, so a desk
    // clearing a number in a select — or pressing it out of habit after a
    // mis-tap — was thrown off the board mid-shift and had to find its way
    // again. Nothing in this app wants that key at the document level.
    const guardBack = (e) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      const el = e.target;
      const tag = el && el.tagName ? el.tagName.toUpperCase() : "";
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || (el && el.isContentEditable);
      if (!typing) e.preventDefault();
    };
    document.addEventListener("keydown", guardBack);

    loadPendingWrites();

    return () => {
      document.removeEventListener("keydown", guardBack);
    };
  }, []);

  useEffect(() => {
    const opts = { capture: true, passive: true };
    window.addEventListener("pointerdown", armAlerts, opts);
    window.addEventListener("keydown", armAlerts, opts);
    window.addEventListener("touchstart", armAlerts, opts);
    return () => {
      window.removeEventListener("pointerdown", armAlerts, opts);
      window.removeEventListener("keydown", armAlerts, opts);
      window.removeEventListener("touchstart", armAlerts, opts);
    };
  }, [armAlerts]);

  // If sign-in or the first data load hasn't finished in 8s, something in
  // the Firebase setup is off (most commonly: Anonymous auth not enabled,
  // or no Firestore database created yet). Surface that instead of leaving
  // the "Connecting..." screen spinning forever with no explanation.
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setConnectFailed(true), 8000);
    return () => clearTimeout(t);
  }, [ready]);

  const loadAll = useCallback(async () => {
    // Nothing to poll for until this device is signed in. Before that the
    // board answers 401 to everything, which is correct - the door is shut -
    // and asking anyway just fills the console at the sign-in screen.
    if (!getToken()) {
      setReady(true);
      return;
    }
    // Anything this device is still holding from a spell without signal goes up
    // first, before the board is read back. Sending it first means the read
    // below already contains it, instead of the server's older copy briefly
    // landing on screen and undoing a crew's stamps in front of them.
    await pushPendingWrites();

    const [u, r, sch] = await Promise.all([
      readKeyRaw("ems:units"),
      readKeyRaw("ems:requests"),
      readKeyRaw("ems:scheduled"),
    ]);

    // Bail out of this tick if the board couldn't be read at all. Carrying on
    // would mistake the outage for an empty board and write defaults over the
    // live units and accounts. The next poll retries; on a first load the
    // "still connecting" screen explains it instead.
    //
    // Requests are read the same way for the same reason: the repair pass
    // below decides a unit's call is over by not finding it in this list, so a
    // failed read must never reach it as "there are no calls".
    if (u === READ_FAILED || r === READ_FAILED) return;

    // A read that started before a write landed is stale by definition. Applying
    // it would undo the change on screen a moment after the crew made it, which
    // is what made buttons look like they needed two or three taps. Skip this
    // tick for the keys that are still settling; the next one is three seconds
    // away and will carry the change.
    if (writeInFlight("ems:requests") || writeInFlight("ems:units")) return;

    const requestsToUse = r || [];

    let unitsToUse = u;
    if (!unitsToUse) {
      unitsToUse = DEFAULT_UNITS;
      await writeKey("ems:units", unitsToUse);
    } else {
      // Top up any missing default Medic units (boards seeded before Medic
      // 4/5, ZAHRAWI, or the CCC units existed), AND retire the old default
      // "RESCUE 1" unit that some boards were originally seeded with — unless
      // it's actively on a call right now, in which case we leave it alone
      // rather than orphan that call. Any other custom unit a crew added
      // themselves is never touched. Also backfills alpha/bravo slots (and
      // resets an idle, unstaffed unit to "oos") on boards created before the
      // crew-roster feature existed.
      //
      // Units are matched on station AND name, never name alone: both stations
      // run a MEDIC 1, and matching on the name by itself would decide CCC's
      // medics already existed and never create them.
      // Only ever once.
      //
      // This exists to bring old boards up to the current fleet. Run on every
      // load it undoes the administrator: a truck they removed comes back, and
      // a truck they renamed reappears under its old name as a second vehicle —
      // which is exactly what was happening. Once a board has been topped up it
      // is marked, and the fleet is theirs from then on.
      // The mark that says "this board's fleet is the department's now" has to
      // live on the BOARD, not on the device.
      //
      // It was in localStorage. That marks the tablet, not the fleet — so a
      // truck an administrator had removed came back the first time anybody
      // signed in on a new phone, and came back again on the next new phone,
      // and the administrator's deletion looked like it had simply failed. A
      // board-wide decision needs a board-wide mark.
      //
      // localStorage is kept as the fast path: once this device has seen the
      // mark it never asks again, so the extra read costs nothing on the
      // three-second poll. The board is only consulted when a top-up would
      // otherwise happen, which after the first sign-in on a board is never.
      let seeded = false;
      try {
        seeded = localStorage.getItem("ems:fleetSeeded") === "1";
      } catch (e) {
        seeded = false;
      }
      const existingKeys = new Set(unitsToUse.map((x) => `${stationOf(x)}::${x.name}`));
      let missing = seeded
        ? []
        : DEFAULT_UNITS.filter((d) => !existingKeys.has(`${stationOf(d)}::${d.name}`));
      if (!seeded && missing.length > 0) {
        const mark = await readKeyRaw(FLEET_SEEDED_KEY);
        // A read that failed is not a board saying "never seeded". Adding five
        // trucks because the server was briefly unreachable is the worst
        // possible answer, so nothing is added until the board actually says.
        if (mark === READ_FAILED || mark) {
          missing = [];
          seeded = true;
        }
      }
      if (!seeded) await writeKey(FLEET_SEEDED_KEY, { at: Date.now() });
      try {
        localStorage.setItem("ems:fleetSeeded", "1");
      } catch (e) {}
      const withoutRetiredDefaults = seeded
        ? unitsToUse
        : unitsToUse.filter((x) => !(x.name === "RESCUE 1" && !x.assignedRequestId));
      // No two trucks may share an id.
      //
      // Renaming CCC's MEDIC 1 to MEDIC 7 made the seeding see "ccc::MEDIC 1"
      // as missing and add it back — with the same id the renamed truck already
      // held. Two units with one id put the same crew on two sheets. The first
      // one wins, which is the one the administrator curated.
      const seenIds = new Set();
      const deduped = withoutRetiredDefaults.filter((x) => {
        if (!x || !x.id) return true;
        if (seenIds.has(x.id)) return false;
        seenIds.add(x.id);
        return true;
      });
      const patched = deduped.map((x) => {
        // Anything from before stations existed is Main Office — that is where
        // the original medics run from.
        const needsStation = !x.station;
        if (x.alpha !== undefined && x.bravo !== undefined && !needsStation) return x;
        const next = {
          ...x,
          station: x.station || DEFAULT_STATION,
          alpha: x.alpha ?? null,
          bravo: x.bravo ?? null,
        };
        if (next.status === "available" && !next.assignedRequestId) next.status = "oos";
        return next;
      });
      const changed =
        missing.length > 0 ||
        deduped.length !== unitsToUse.length ||
        patched.some((x, i) => x !== deduped[i]);
      if (changed) {
        unitsToUse = [...patched, ...missing];
        await writeKey("ems:units", unitsToUse);
      } else {
        unitsToUse = patched;
      }
    }

    // Self-heal units left pointing at a call that has finished (or that no
    // longer exists — an old board, a cleared request list, a crew that closed
    // their browser mid-call while dispatch closed the call from the desk).
    // Such a unit keeps an on-call status like DISPATCHED forever, which is
    // what made dispatch see an empty board while crews were signed on and
    // waiting. Units genuinely on a live call are never touched.
    const flagged = new Set();
    const repaired = unitsToUse.map((x) => {
      // On a call that is still running: leave it be, only giving it a sane
      // status if it somehow carries one this build doesn't recognise.
      //
      // If the call names this team but the team doesn't point back at it, the
      // second half of the assignment never landed. Re-point it here so the
      // desk, the status board and the crew's own screen agree — the crew is
      // already being alerted off the call itself by this point.
      const live = liveRequestFor(x, requestsToUse);
      if (live) {
        const patch = {};
        if (x.assignedRequestId !== live.id) patch.assignedRequestId = live.id;
        if (!STATUS[x.status] || !ON_CALL_STATUSES.includes(x.status)) patch.status = "dispatched";
        return Object.keys(patch).length > 0 ? { ...x, ...patch } : x;
      }
      const needsReset =
        !!x.assignedRequestId || ON_CALL_STATUSES.includes(x.status) || !STATUS[x.status];
      if (!needsReset) return x;
      flagged.add(x.id);
      // Only act once a unit has looked orphaned on two polls in a row. An
      // assignment is saved as two writes (the call, then the unit), so for a
      // moment a unit can legitimately look like it points at a call this read
      // hasn't seen yet — undoing that would cancel a dispatch mid-flight.
      // Nothing waits on this: the desk's team lists already ignore stale
      // pointers, so the delay only affects the stored status label.
      if (!staleUnitsRef.current.has(x.id)) return x;
      return { ...x, assignedRequestId: null, status: idleStatusFor(x) };
    });
    staleUnitsRef.current = flagged;
    if (repaired.some((x, i) => x !== unitsToUse[i])) {
      unitsToUse = repaired;
      await writeKey("ems:units", unitsToUse);
    }

    setUnits(unitsToUse);
    setRequests(requestsToUse);
    // A failed read here leaves the schedule as it was rather than emptying it:
    // an outage must not make the desk think nothing is booked.
    if (sch !== READ_FAILED) setScheduled(sch || []);
    const cov = await readKey(COVERAGE_KEY, []);
    setCoverage(cov || []);
    // Messages ride the same poll as the rest of the board, so a line typed at
    // the desk reaches the truck on the next tick without a channel of its own.
    // readKeyRaw, not readKey.
    //
    // readKey swallows a failed read and hands back the fallback, so
    // `!== READ_FAILED` was always true and every one of these was overwriting
    // good state with an empty default on any poll that could not reach the
    // server. The chat emptied, the stock counts reset, and — worst of the
    // four — the tracking consents vanished, which put the consent prompt back
    // in front of a crew in the middle of a call. Only readKeyRaw reports a
    // failure, so only readKeyRaw can be used where "keep what we had" is the
    // right answer.
    const msgs = await readKeyRaw(MESSAGES_KEY);
    if (msgs !== READ_FAILED) setMessages(msgs || []);
    const inv = await readKeyRaw(INVENTORY_KEY);
    if (inv !== READ_FAILED) setInventory(inv || null);
    const ot = await readKeyRaw(OVERTIME_KEY);
    if (ot !== READ_FAILED) setOvertimeDecisions(ot || {});
    const locs = await readKeyRaw(LOCATION_KEY);
    if (locs !== READ_FAILED && locs !== null) {
      // Swept on the way in. Only written back when something actually needed
      // removing, so an idle board is not rewriting this key every poll.
      const { kept, dropped } = pruneLocations(locs || {}, unitsToUse, requestsToUse, Date.now());
      setLocations(kept);
      if (dropped > 0) await writeKey(LOCATION_KEY, kept);
    }
    const cons = await readKeyRaw(TRACKING_CONSENT_KEY);
    if (cons !== READ_FAILED) setTrackingConsents(cons || {});
    setReady(true);
  }, []);

  // The roster is no longer on the board and is no longer seeded from here. It
  // lives in its own table on the server, which seeds it on first start, and
  // only an administrator may read or change it - so a crew member's device
  // never asks for it and never holds it.
  //
  // Deliberately its own effect rather than a line inside loadAll: loadAll is a
  // useCallback with no dependencies, so anything it reads from state is frozen
  // at the first render, and `user` is null then. It would have loaded the
  // roster for nobody, forever.
  useEffect(() => {
    if (!user || user.role !== "admin") {
      setAccounts([]);
      return;
    }
    let alive = true;
    const pull = async () => {
      const roster = await listAccounts();
      if (alive) setAccounts(roster);
    };
    pull();
    // Anything that changes the roster out of band — delegating authority,
    // taking it back — reads it straight back rather than waiting half a minute
    // for the slow poll to notice.
    refreshAccountsRef.current = pull;
    // It changes when an administrator changes it, which is rare, so it rides
    // the slow poll rather than the three-second one.
    const t = setInterval(pull, COLD_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
      refreshAccountsRef.current = null;
    };
  }, [user]);

  // Signed out by the server - the token expired, or the account was removed
  // while the tablet was asleep. Better to be put back at the sign-in screen
  // than to sit in front of a board that quietly stopped saving.
  useEffect(() => onAuthLost(() => {
    clearSession();
    setUser(null);
  }), []);

  // The slow half. Nothing in here changes more than a few times a day, and
  // between them these are nine tenths of the bytes on the wire.
  //
  // Policies are not here at all: a shelf of scanned PDFs runs to megabytes,
  // and only the Policies tab has any use for it. It is read when that tab is
  // opened and at no other time.
  const loadCold = useCallback(async () => {
    // Nothing to poll for until this device is signed in. Before that the
    // board answers 401 to everything, which is correct - the door is shut -
    // and asking anyway just fills the console at the sign-in screen.
    if (!getToken()) {
      setReady(true);
      return;
    }
    const arch = await readKeyRaw(ARCHIVE_KEY);
    if (arch !== READ_FAILED) setArchives(arch || []);
    const subs = await readKeyRaw(SUBMISSION_KEY);
    if (subs !== READ_FAILED) setSubmissions(subs || []);
    const l = await readKeyRaw("ems:log");
    if (l !== READ_FAILED) setLog(l || []);
    const cl = await readKeyRaw(CHECKLIST_KEY);
    if (cl !== READ_FAILED) setChecklists(cl && (cl.medic || cl.emt) ? cl : emptyChecklists());
    const runs = await readKeyRaw(CHECKLIST_RUNS_KEY);
    if (runs !== READ_FAILED) setChecklistRuns(runs || []);
    const invMoves = await readKeyRaw(INVENTORY_MOVES_KEY);
    if (invMoves !== READ_FAILED) setInventoryMoves(invMoves || []);
    const pwr = await readKeyRaw(PWRESET_KEY);
    if (pwr !== READ_FAILED) setPasswordResets(pwr || []);
    const rst = await readKeyRaw(RESTOCK_KEY);
    if (rst !== READ_FAILED) setRestockDone(rst || {});
    // Who has sent their overtime in. A small map, read on the slow poll
    // because a claim being sent is not something anybody is watching for.
    const sent = await readKeyRaw(OVERTIME_SENT_KEY);
    if (sent !== READ_FAILED) setOvertimeSent(sent || {});
  }, []);

  // Read when the shelf is actually being looked at, and never on the poll.
  const loadPolicies = useCallback(async () => {
    const pols = await readKeyRaw(POLICY_KEY);
    if (pols !== READ_FAILED) setPolicies(pols || []);
  }, []);

  // Each tab is its own page.
  //
  // Scrolling to a section left everything else on screen underneath it, so
  // "History" still had the board above it and the teams below — which is not a
  // page, it is a long screen with a shortcut. Now a tab shows its own content
  // and nothing else, and the board is always one tap away.
  // Every sign-in starts on the board.
  //
  // The tab lives in App, which does not unmount when somebody signs out — so
  // the next person inherited whatever page the last one left it on. If that
  // was "Submit", the effect below fired the moment they signed in and filed
  // the shift without being asked. It looked like the app had pressed its own
  // button, and in effect it had.
  useEffect(() => {
    setNavTab("board");
    // And the New call signal with it.
    //
    // The signal is a counter that DispatcherView watches. It survived a change
    // of user, so if the last desk had pressed New call the counter was still
    // above zero — and the next person's freshly mounted view saw a truthy
    // value and opened the form the moment they signed in.
    setNewCallSignal(0);
  }, [user && user.accountId]);

  useEffect(() => {
    if (!user) return;
    // "Submit" is an action, not a place: it files the shift and drops straight
    // back to the board rather than leaving the desk on a page showing nothing.
    if (navTab === "log" && user.role === "dispatcher") {
      setNavTab("board");
      submitMyShiftLog();
      return;
    }
    // A new page starts at the top, as a page does.
    if (typeof window !== "undefined" && window.scrollTo) window.scrollTo({ top: 0 });
  }, [navTab, user && user.role]);

  // Ending a no-coverage period the moment a team is back in service. It is
  // closed by the board rather than by a person, so nobody has to remember —
  // which is the one thing nobody would, in the middle of the shift that caused
  // it.
  useEffect(() => {
    if (!ready || !user) return;
    if (user.role !== "dispatcher" && user.role !== "admin") return;
    let alive = true;
    const run = async () => {
      try {
        const u = await readKey("ems:units", units);
        const r = await readKey("ems:requests", requests);
        // Opened and closed by the same watcher, in that order: if the last
        // truck goes out and comes back between two passes, nothing is invented.
        const opened = await openCoverageGapIfStuck({ units: u, requests: r, list: coverage, addLog });
        const closed = await closeCoverageGapIfClear({ units: u, requests: r, list: coverage, addLog });
        if ((opened || closed) && alive) setCoverage((await readKey(COVERAGE_KEY, [])) || []);
      } catch (e) {
        console.error("coverage watcher failed:", e);
      }
    };
    run();
    const t = setInterval(run, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [ready, user && user.role, units, requests]);

  // Filing a shift that nobody filed by hand.
  //
  // The first version of this only ran on a signed-in dispatcher's board and
  // read the window off *their own session* — which meant it could never fire in
  // the one situation it exists for. The desk finishes, signs out, and there is
  // no longer a dispatcher session anywhere to notice that the shift is over.
  // An administrator opening the app next morning found nothing submitted,
  // because nothing was left running that could submit it.
  //
  // So it no longer depends on anyone being signed in as the desk. It works from
  // the clock and the board: for each station, look back over the last few shift
  // windows, and file any that has ended, has calls, has none of them still
  // running, and has nobody from that station still signed on. An admin opening
  // the app is enough to catch up whatever was missed.
  const autoSubmitRef = useRef(false);
  const AUTO_SUBMIT_LOOKBACK = 6; // shifts — three days

  useEffect(() => {
    if (!ready || !user) return;
    if (user.role !== "dispatcher" && user.role !== "admin") return;
    let alive = true;

    const run = async () => {
      if (autoSubmitRef.current) return;
      autoSubmitRef.current = true;
      try {
        const now = Date.now();
        const freshRequests = await readKey("ems:requests", requests);
        const freshUnits = await readKey("ems:units", units);
        const freshLog = await readKey("ems:log", log);
        const freshScheduled = await readKey("ems:scheduled", scheduled);
        let all = (await readKey(SUBMISSION_KEY, [])) || [];

        // The windows that have already ended, newest first.
        const current = shiftWindowAt(now).start;
        const windows = [];
        for (let n = 1; n <= AUTO_SUBMIT_LOOKBACK; n++) {
          const start = current - n * SHIFT_MS;
          windows.push({ start, end: start + SHIFT_MS, key: scheduledShiftKey(start) });
        }
        // The window running now is deliberately not a candidate: it is not over,
        // and filing it would shut the rest of the shift out of its own log.

        for (const st of STATIONS) {
          const crewStillOn = freshUnits.filter(
            (u) => stationOf(u) === st.key && (u.alpha || u.bravo)
          ).length;

          for (const w of windows) {
            const id = submissionId(opDayStart(w.start), w.key, st.key);
            if (all.some((x) => x && x.id === id)) continue;

            const mine = requestsForShift(freshRequests, st.key, w.start, w.end);
            // Nothing happened on that shift at this station — there is no log to
            // file, and filing an empty one every twelve hours would bury the
            // real ones.
            if (!mine.length) continue;

            const stillOpen = mine.filter((r) => r.status !== "completed").length;

            // Only once the twelve hours are actually up.
            //
            // This used to also file a shift that had gone quiet early — every
            // call closed and everyone signed out before the window ended. That
            // was wrong: crews sign out for all sorts of reasons mid-shift, and a
            // log filed at that moment shut the rest of the shift out of it.
            // Anything raised afterwards fell into a window that already had a
            // submission and was refused, so it reached no log sheet at all.
            //
            // A desk that has genuinely finished early can still submit by hand;
            // that is a person deciding, not the board guessing.
            if (now < w.end) continue;
            if (stillOpen) continue;
            if (crewStillOn) continue;

            const res = await submitShiftLog({
              requests: freshRequests,
              units: freshUnits,
              log: freshLog,
              scheduled: freshScheduled,
              station: st.key,
              windowStart: w.start,
              windowEnd: w.end,
              shiftKey: w.key,
              by: "Filed automatically",
              coverageList: (await readKey(COVERAGE_KEY, [])) || [],
            });
            if (!res.ok) continue;
            all = (await readKey(SUBMISSION_KEY, [])) || [];
            if (alive) setSubmissions(all);
            await addLog(
              `${stationLabel(st.key)} — ${SHIFTS[w.key] ? SHIFTS[w.key].label : w.key} log ` +
                `(${opDayLabel(opDayStart(w.start))}) filed automatically · all calls closed and ` +
                `all crews signed out · ${res.entry.callCount} calls`,
              "status"
            );
          }
        }
      } catch (e) {
        console.error("auto submit failed:", e);
      } finally {
        autoSubmitRef.current = false;
      }
    };

    run();
    const t = setInterval(run, HOUSEKEEPING_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [ready, user && user.role]);

  // Keeping the whole day.
  //
  // Two logs a day were already being filed — a day shift and a night shift,
  // per station. The third, the one this fills, is the operational day itself:
  // both shifts, both stations, one workbook. All of the machinery for it
  // existed and nothing ever called it, so the archive an administrator opens
  // was always empty.
  //
  // It runs from the clock and the board, on any admin or dispatcher screen
  // that happens to be open. Nobody has to sign out and nobody has to press
  // anything: when the last call of a finished day is closed, the day is kept.
  const archiveRef = useRef(false);

  useEffect(() => {
    if (!ready || !user) return;
    if (user.role !== "dispatcher" && user.role !== "admin") return;
    let alive = true;

    const run = async () => {
      if (archiveRef.current) return;
      archiveRef.current = true;
      try {
        const now = Date.now();
        // Read for real, and give up on this pass if the board cannot be
        // reached. `readKey` answers a failed read with the fallback it was
        // given, and the fallback here is React state frozen at the render this
        // effect was created on — so during a redeploy this pass would have
        // archived a day out of a stale snapshot and written it as the record.
        // A day kept from the wrong data is worse than a day kept an hour late.
        const freshRequests = await readKeyRaw("ems:requests");
        const have = await readKeyRaw(ARCHIVE_KEY);
        if (freshRequests === READ_FAILED || have === READ_FAILED) return;
        const days = unarchivedOpDays(freshRequests || [], have || [], now);
        if (!days.length) return;

        const freshUnits = await readKeyRaw("ems:units");
        const freshLog = await readKeyRaw("ems:log");
        const freshScheduled = await readKeyRaw("ems:scheduled");
        if (freshUnits === READ_FAILED || freshLog === READ_FAILED || freshScheduled === READ_FAILED) return;

        for (const dayStart of days) {
          // A night call that ran past 07:00 holds its own day open until the
          // crew close it. That is the point: the archive gets the finished
          // call, not a snapshot of one halfway through.
          if (!opDayComplete(freshRequests || [], dayStart, now)) continue;

          const won = await archiveOpDay({
            dayStart,
            requests: freshRequests || [],
            units: freshUnits || [],
            log: freshLog || [],
            scheduled: freshScheduled || [],
            closedBy: "",
            reason: "clock",
            boardId: clientIdRef.current,
          });
          if (!won) continue;
          if (alive) setArchives((await readKey(ARCHIVE_KEY, [])) || []);
          await addLog(
            `Operational day ${opDayLabel(dayStart)} (07:00 → 07:00) kept to the archive automatically · ` +
              `${requestsForOpDay(freshRequests || [], dayStart).length} calls, both stations`,
            "status"
          );
        }
      } catch (e) {
        console.error("day archive pass failed:", e);
      } finally {
        archiveRef.current = false;
      }
    };

    run();
    const t = setInterval(run, HOUSEKEEPING_MS + 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [ready, user && user.role]);

  // Finishing off submissions that were filed with a call still running: once
  // the last call is closed and the station's crews are off, the submission
  // completes itself with the final times and the overtime counted.
  useEffect(() => {
    if (!ready || !user) return;
    if (user.role !== "dispatcher" && user.role !== "admin") return;
    let alive = true;
    const run = async () => {
      try {
        await amendSubmissionsWithLateCalls({
          requests: await readKey("ems:requests", requests),
          log: await readKey("ems:log", log),
        });
        const n = await finaliseOpenSubmissions({
          requests: await readKey("ems:requests", requests),
          units: await readKey("ems:units", units),
          log: await readKey("ems:log", log),
          boardId: clientIdRef.current,
        });
        if (n && alive) setSubmissions((await readKey(SUBMISSION_KEY, [])) || []);
      } catch (e) {
        console.error("finalise pass failed:", e);
      }
    };
    run();
    const t = setInterval(run, HOUSEKEEPING_MS + 40000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [ready, user && user.role]);

  // Taking finished, filed work off the live board so every write stays small.
  // Runs quietly on a desk or admin board, never a crew tablet, and only ever
  // removes a call it has just confirmed is sitting inside a finalised
  // submission.
  useEffect(() => {
    if (!ready || !user) return;
    if (user.role !== "dispatcher" && user.role !== "admin") return;
    let alive = true;
    const run = async () => {
      try {
        const subs = (await readKey(SUBMISSION_KEY, [])) || [];
        if (!subs.some((x) => x && x.status === "final")) return;
        const res = await pruneArchivedWork({
          requests: await readKey("ems:requests", requests),
          log: await readKey("ems:log", log),
          submissions: subs,
          now: Date.now(),
        });
        if (alive && (res.droppedRequests || res.droppedLog)) {
          await loadAll();
        }
      } catch (e) {
        console.error("prune pass failed:", e);
      }
    };
    // Not on a tight loop: this is housekeeping, not board state.
    const t = setInterval(run, 15 * 60 * 1000);
    const first = setTimeout(run, 20000);
    return () => {
      alive = false;
      clearInterval(t);
      clearTimeout(first);
    };
  }, [ready, user && user.role]);

  useEffect(() => {
    loadAll();
    loadCold();
    const poll = setInterval(loadAll, POLL_MS);
    const cold = setInterval(loadCold, COLD_POLL_MS);
    const clk = setInterval(() => setClock(nowTime()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(cold);
      clearInterval(clk);
    };
  }, [loadAll, loadCold]);

  // Coming back to the app is a moment to read the board, not to wait for the
  // next tick of a timer.
  //
  // The poll is every three seconds, and a phone waking from a locked screen
  // adds its own pause on top of that before the first request goes out - so a
  // crew who opened the app because they felt the buzz stood looking at a board
  // with no call on it for a few seconds. The call was already raised; this
  // device had simply not asked yet. Asking the moment the screen comes back
  // closes that gap.
  //
  // Three routes to the same event because no single one covers every case:
  // visibilitychange is the web's, focus catches a window brought forward
  // without a visibility change, and the shell's own appStateChange is the only
  // one that fires reliably on a native resume. Firing twice is a wasted read,
  // which costs nothing; not firing is a crew staring at an empty screen.
  useEffect(() => {
    const wake = () => {
      try {
        if (typeof document !== "undefined" && document.hidden) return;
      } catch (e) {
        // no document visibility here; read anyway
      }
      loadAll();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    let handle = null;
    try {
      const app = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (app && typeof app.addListener === "function") {
        const added = app.addListener("appStateChange", (state) => {
          if (state && state.isActive) loadAll();
        });
        if (added && typeof added.then === "function") {
          added.then((h) => {
            handle = h;
          });
        } else {
          handle = added;
        }
      }
    } catch (e) {
      // no shell, or no App plugin in it
    }
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      try {
        if (handle && typeof handle.remove === "function") handle.remove();
      } catch (e) {
        // already gone
      }
    };
  }, [loadAll]);

  // Opening a page is the moment its contents have to be right. The slow half
  // is refreshed on every tab change, so an administrator who taps Archive
  // never reads a copy that is up to half a minute old — and the shelf of
  // policy files is fetched here and nowhere else.
  useEffect(() => {
    if (!user) return;
    loadCold();
    if (navTab === "policies") loadPolicies();
  }, [navTab, user && user.accountId, loadCold, loadPolicies]);

  // Signing in counts as a user gesture, which unlocks the AudioContext so the
  // alert tone can keep playing later even without a fresh tap/click, and is
  // the moment to ask a crew member about notifications so calls still reach
  // them when the tab isn't the one in front.
  function handleLogin(u) {
    setSession(u);
    if (u) requestAlertPermission();
    if (u) requestNativeNotifications();
    armAlerts();
  }

  // `actor` is only passed in from the sign-in screen, where the person exists
  // but this device's session doesn't yet. Everything else is stamped with
  // whoever is signed in on this board right now.
  async function addLog(message, type, detail, actor) {
    const current = await readKey("ems:log", []);
    const entry = { id: uid("log"), ts: Date.now(), time: nowTime(), message, type };
    // Shift entries carry a structured record alongside the sentence so the
    // log sheet and the export can show the handover as columns, not prose.
    if (detail) entry.detail = detail;
    const stamp = actor || actorStamp(userRef.current);
    if (stamp) entry.actor = stamp;
    // The station this line belongs to, lifted onto the entry so a station's
    // log reads without having to know where in the entry the station hides.
    const st = (stamp && stamp.station) || (detail && detail.station) || null;
    if (st) entry.station = st;
    const next = [entry, ...current].slice(0, LOG_CAP);
    const prevLog = log;
    setLog(next);
    const sent = await writeList("ems:log", next, prevLog, { prepend: true, cap: LOG_CAP });
    if (sent.value && !sent.stale) setLog(sent.value);
  }

  // Administration names the policy, then attaches the file that already
  // exists — a signed PDF, or a photograph of the sheet on the wall. The name
  // is what everybody navigates by, so it is typed rather than inherited from
  // whatever the scanner called the file.
  async function addPolicy(title, file) {
    const name = String(title || "").trim();
    if (!name) {
      alert("Give the policy a name first.");
      return;
    }
    setPolicyBusy(true);
    try {
      const doc = await readPolicyFile(file);
      // Refuse here rather than let the server refuse it.
      //
      // The shelf is written whole on every change, and the server will not
      // accept a body past 25 MB. Sent anyway, the write is rejected, the app
      // reads the rejection as being offline, and the file sits queued on that
      // one device for good — which looks exactly like it worked. Better to say
      // no now, and say why.
      const shelfNow = policies.reduce(
        (n, x) => n + (x.bytes || (x.data ? x.data.length * 0.75 : 0)),
        0
      );
      const after = shelfNow + (doc.bytes || 0);
      if (after > POLICY_SHELF_LIMIT) {
        alert(
          `The policy shelf would be ${bytesStr(after)} with this file on it, and the limit is ` +
            `${bytesStr(POLICY_SHELF_LIMIT)}.\n\n` +
            `The shelf is saved as one piece, so past this the save is refused and the file is ` +
            `silently lost. Remove a policy that is out of date, or scan this one at a lower ` +
            `resolution, and try again.`
        );
        return;
      }
      doc.title = name.slice(0, 120);
      const stamp = actorStamp(userRef.current);
      doc.addedBy = (stamp && stamp.name) || "";
      const existing = (await readKey(POLICY_KEY, [])) || [];
      const next = [...existing, doc];
      setPolicies(next);
      const sent = await writeList(POLICY_KEY, next, existing);
      if (sent.value && !sent.stale) setPolicies(sent.value);
      await addLog(`Policy added: ${doc.title}`, "admin");
    } catch (e) {
      alert(e && e.message ? e.message : "That file could not be added.");
    } finally {
      setPolicyBusy(false);
    }
  }

  async function removePolicy(pol) {
    if (!pol) return;
    if (!confirm(`Remove "${pol.title}" from the policy shelf?`)) return;
    const existing = (await readKey(POLICY_KEY, [])) || [];
    const next = existing.filter((p) => p && p.id !== pol.id);
    setPolicies(next);
    const sent = await writeList(POLICY_KEY, next, existing);
    if (sent.value && !sent.stale) setPolicies(sent.value);
    await addLog(`Policy removed: ${pol.title}`, "admin");
  }

  // Every board save goes through writeList, which keeps whatever didn't reach
  // the server on the device and replays it later. The screen is updated first
  // either way: a crew underground must be able to keep working the call.
  // The screen is updated first, then the change is sent, then whatever the
  // server holds after merging it is adopted. That last step is the point: a
  // device whose copy was minutes old now has everybody else's work on it
  // straight away, instead of at the next poll — and, far more importantly, it
  // never sent its old copy over theirs to begin with.
  async function saveUnits(next) {
    const prev = units;
    setUnits(next);
    const sent = await writeList("ems:units", next, prev);
    if (sent.value && !sent.stale) setUnits(sent.value);
    return sent.value || next;
  }

  // Adding, changing and removing people, through the administrator-only
  // endpoint rather than by rewriting a board key. Whatever the server ends up
  // holding is what the screen shows, so a refusal cannot leave the roster on
  // screen disagreeing with the roster that exists.
  async function saveAccounts(next) {
    const prev = accounts;
    const byId = new Map((next || []).map((a) => [a.id, a]));
    // Any sign-in codes the server minted on the way through. A brand new
    // account comes with the one that opens it, and it is shown once — so it
    // has to be carried back to whoever pressed Add rather than dropped here.
    const issued = [];
    try {
      for (const account of next || []) {
        const before = prev.find((a) => a.id === account.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(account)) {
          const saved = await saveAccount(account);
          if (saved && saved.code) issued.push({ id: account.id, name: account.name, code: saved.code });
        }
      }
      for (const account of prev || []) {
        if (!byId.has(account.id)) await removeAccount(account.id);
      }
    } catch (e) {
      window.alert(e.message || "The server would not accept that change to the roster.");
    }
    setAccounts(await listAccounts());
    return issued;
  }

  async function saveRequests(next) {
    const prev = requests;
    setRequests(next);
    const sent = await writeList("ems:requests", next, prev);
    if (sent.value && !sent.stale) setRequests(sent.value);
    return sent.value || next;
  }

  async function saveScheduled(next) {
    const prev = scheduled;
    setScheduled(next);
    const sent = await writeList("ems:scheduled", next, prev);
    if (sent.value && !sent.stale) setScheduled(sent.value);
    return sent.value || next;
  }

  // The desk filing its own shift. This is the end-of-tour action: it takes the
  // twelve hours that have just been worked, files them to the archive, and
  // hands anything still running to the crew coming on.
  const submitMyShiftLog = useCallback(async () => {
    const u = userRef.current;
    if (!u || u.role !== "dispatcher") return;
    const station = u.station || DEFAULT_STATION;
    // The window this desk actually signed on for, not whatever the wall clock
    // says now — a night desk pressing this at 07:20 is filing the night.
    const windowStart = u.shiftStart || shiftWindowAt(Date.now()).start;
    const windowEnd = u.shiftEnd || windowStart + SHIFT_MS;
    const shiftKey = u.shift || scheduledShiftKey(windowStart);
    const shiftName = SHIFTS[shiftKey] ? SHIFTS[shiftKey].label : shiftKey;

    // The log is the record of a completed tour. Submitting halfway through
    // would file a shift that is still happening and shut the rest of it out of
    // the archive, so this waits until the twelve hours are actually up.
    const now = Date.now();
    if (now < windowEnd) {
      window.alert(
        `Not yet — this shift still has ${msDurationStr(windowEnd - now)} to run.\n\n` +
          `The log can be submitted from ${clockStr(windowEnd)}, once the twelve hours are complete.`
      );
      return;
    }

    const freshRequests = await readKey("ems:requests", requests);
    const mine = requestsForShift(freshRequests, station, windowStart, windowEnd);
    const stillOpen = mine.filter((r) => r.status !== "completed");

    const ok = window.confirm(
      `Submit the ${shiftName} log for ${stationLabel(station)} — ${opDayLabel(opDayStart(windowStart))}?\n\n` +
        `${mine.length} call${mine.length === 1 ? "" : "s"}.` +
        (stillOpen.length
          ? `\n\n${stillOpen.length} still running. ${stillOpen.length === 1 ? "It stays" : "They stay"} on this shift's log — ` +
            `${stillOpen.length === 1 ? "it is" : "they are"} handed to the next shift to finish, and this log completes ` +
            `itself once ${stillOpen.length === 1 ? "it is" : "they are"} closed and the crews have signed out, so the overtime is counted. ` +
            `You do not need to come back.`
          : "") +
        `\n\nIt goes straight to the admin archive.`
    );
    if (!ok) return;

    const res = await submitShiftLog({
      requests: freshRequests,
      units: await readKey("ems:units", units),
      log: await readKey("ems:log", log),
      scheduled: await readKey("ems:scheduled", scheduled),
      station,
      windowStart,
      windowEnd,
      shiftKey,
      by: u.name || "",
      coverageList: (await readKey(COVERAGE_KEY, coverage)) || [],
    });

    if (res.reason === "already") {
      window.alert(`The ${shiftName} log for ${stationLabel(station)} has already been submitted.`);
      return;
    }
    if (!res.ok) {
      window.alert("No signal — the submission is saved on this device and goes up automatically.");
      return;
    }

    // Anything still running is handed over rather than just left on the board.
    // The call keeps belonging to the shift that took it — that is what stops it
    // being counted twice — but it is stamped so the next desk can see at a
    // glance that it came from the shift before and is not theirs to file.
    if (stillOpen.length) {
      const handover = {
        fromShift: shiftKey,
        fromShiftLabel: shiftName,
        fromDay: opDayLabel(opDayStart(windowStart)),
        by: u.name || "Dispatch",
        at: Date.now(),
      };
      const openIds = new Set(stillOpen.map((r) => r.id));
      const fresh2 = await readKey("ems:requests", freshRequests);
      await saveRequests(fresh2.map((r) => (openIds.has(r.id) ? { ...r, handover } : r)));
      await addLog(
        `${stationLabel(station)} — ${stillOpen.length} call${stillOpen.length === 1 ? "" : "s"} handed to the next shift by ` +
          `${u.name || "Dispatch"}: ${stillOpen.map((r) => r.nature).join("; ")}`,
        "status"
      );
    }

    setSubmissions((await readKey(SUBMISSION_KEY, [])) || []);
    await addLog(
      `${stationLabel(station)} — ${shiftName} log submitted by ${u.name || "Dispatch"} · ` +
        `${res.entry.callCount} call${res.entry.callCount === 1 ? "" : "s"}` +
        (res.openCount ? ` · ${res.openCount} still running, completes automatically` : ""),
      "status"
    );
    window.alert(
      res.openCount
        ? "Submitted, and the open calls handed to the next shift.\n\nThis log completes on its own once they close and the crews sign out."
        : "Submitted to the admin archive."
    );
  }, [requests, units, log, scheduled]);

  // Turns bookings whose time has come into ordinary calls.
  //
  // This runs on the dispatch and admin boards only — a crew tablet must never
  // be the thing that raises a call — and every open desk polls, so the release
  // is claimed first: the booking is stamped with this board's id, read back,
  // and only the board whose id survived goes on to raise the call. Everything
  // after that is the normal dispatch path, which is the point: the crew
  // pencilled in gets the same alarm, notification and timeline they would get
  // from a call phoned in a second ago.
  const releaseDueScheduled = useCallback(async () => {
    const u = userRef.current;
    if (!u || (u.role !== "dispatcher" && u.role !== "admin")) return;
    if (releasingRef.current) return;

    const list = await readKeyRaw("ems:scheduled");
    if (list === READ_FAILED || !Array.isArray(list) || list.length === 0) return;
    const now = Date.now();
    const due = list.filter((s) => schedDue(s, now));
    if (due.length === 0) return;

    releasingRef.current = true;
    try {
      const dueIds = new Set(due.map((s) => s.id));
      await writeKey(
        "ems:scheduled",
        list.map((s) =>
          s && dueIds.has(s.id)
            ? { ...s, status: "releasing", claimedBy: clientIdRef.current, claimedAt: now }
            : s
        )
      );

      const after = await readKeyRaw("ems:scheduled");
      if (after === READ_FAILED || !Array.isArray(after)) return;
      const held = (listAfter) =>
        listAfter.filter(
          (s) => s && dueIds.has(s.id) && s.status === "releasing" && s.claimedBy === clientIdRef.current
        );
      if (held(after).length === 0) return;
      // Read the claim once more after a beat. Two desks that wrote their claim
      // at almost the same instant would both have seen their own id on the
      // first read-back; by now the later write has landed and only one of them
      // still holds it. The `scheduledId` check below is the backstop for the
      // remaining sliver.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const confirmed = await readKeyRaw("ems:scheduled");
      if (confirmed === READ_FAILED || !Array.isArray(confirmed)) return;
      const mine = held(confirmed);
      if (mine.length === 0) return;

      const freshRequests = await readKeyRaw("ems:requests");
      const freshUnits = await readKeyRaw("ems:units");
      if (freshRequests === READ_FAILED || freshUnits === READ_FAILED) return;

      let reqList = freshRequests || [];
      let unitList = freshUnits || [];
      let schedList = confirmed;
      const lines = [];

      for (const entry of mine) {
        // Already raised by another desk — mark the booking done and move on
        // rather than sending a second ambulance to the same appointment.
        const existing = reqList.find((r) => r && r.scheduledId === entry.id);
        if (existing) {
          schedList = schedList.map((s) =>
            s && s.id === entry.id
              ? { ...s, status: "released", releasedAt: existing.createdAt, releasedRequestId: existing.id, claimedBy: null }
              : s
          );
          continue;
        }
        const createdAt = Date.now();
        const picked = entry.assignedUnitId ? unitList.find((x) => x.id === entry.assignedUnitId) : null;
        // The team pencilled in weeks ago may be out on something else by the
        // time this comes round. The booking still goes out — as a call waiting
        // for a team — rather than pulling that crew off a live job.
        const assignNow = !!picked && !isOnCall(picked, reqList);
        const req = {
          id: uid("req"),
          station: stationOf(entry),
          locationFrom: callFrom(entry),
          locationTo: callTo(entry),
          location: callFrom(entry),
          nature: entry.nature,
          priority: entry.priority || "routine",
          mrn: entry.mrn || "",
          requirements: entry.requirements || [],
          status: assignNow ? "assigned" : "pending",
          assignedUnitId: assignNow ? picked.id : null,
          acknowledged: false,
          shift: scheduledShiftKey(createdAt),
          times: assignNow ? { assigned: createdAt } : {},
          createdAt,
          // Where this call came from, so the desk, the history and the
          // exported log can tell a booked transfer from a call phoned in.
          scheduledId: entry.id,
          scheduledFor: entry.scheduledFor,
          scheduledBy: entry.createdBy || "",
          notes: entry.notes || "",
          // Anything the desk already coded on the booking travels with it, so a
          // transfer booked last week as a BLS run doesn't arrive uncoded.
          callType: callTypeMeta(entry.callType) ? entry.callType : null,
          callTypeBy: callTypeMeta(entry.callType) ? entry.createdBy || "" : "",
          callTypeAt: callTypeMeta(entry.callType) ? entry.createdAt || createdAt : null,
          loadedKm: loadedKmMeta(entry.loadedKm) ? entry.loadedKm : null,
          loadedKmBy: loadedKmMeta(entry.loadedKm) ? entry.createdBy || "" : "",
          loadedKmAt: loadedKmMeta(entry.loadedKm) ? entry.createdAt || createdAt : null,
          // Which leg this is, and whether another follows it. Carried onto the
          // call so the board, the crew screen and the sheet can all say so
          // without going back to the booking.
          leg: entry.leg || (wantsReturn(entry) ? "out" : null),
          returnMode: entry.returnMode || null,
          returnAt: entry.returnAt || null,
          returnOf: entry.returnOf || null,
          deliveredAt: entry.deliveredAt || null,
        };
        reqList = [req, ...reqList];
        if (assignNow) {
          unitList = unitList.map((x) =>
            x.id === picked.id ? { ...x, status: "dispatched", assignedRequestId: req.id } : x
          );
        }
        schedList = schedList.map((s) =>
          s && s.id === entry.id
            ? {
                ...s,
                status: "released",
                releasedAt: createdAt,
                releasedRequestId: req.id,
                releasedUnitId: assignNow ? picked.id : null,
                claimedBy: null,
              }
            : s
        );
        lines.push(
          `Scheduled request due — ${req.nature} (${callRoute(req)}) raised for ${whenStr(entry.scheduledFor)}` +
            (assignNow
              ? ` · ${picked.name} dispatched and alerted`
              : picked
              ? ` · ${picked.name} is on another call, waiting for a team`
              : " · waiting for a team")
        );
      }

      await saveRequests(reqList);
      await saveUnits(unitList);
      await saveScheduled(schedList);
      for (const line of lines) await addLog(line, "call");
    } finally {
      releasingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Making the return leg, and keeping a repeating booking topped up.
  //
  // Both write to the forward book, and both have to survive two desks being
  // open — so both check first whether the thing they are about to make has
  // already been made, and neither invents anything the desk did not ask for.
  const bookingsRef = useRef(false);

  const ensureBookings = useCallback(async () => {
    const u = userRef.current;
    if (!u || (u.role !== "dispatcher" && u.role !== "admin")) return;
    if (bookingsRef.current) return;
    bookingsRef.current = true;
    try {
      const now = Date.now();
      const schedRaw = await readKeyRaw("ems:scheduled");
      const reqRaw = await readKeyRaw("ems:requests");
      if (schedRaw === READ_FAILED || reqRaw === READ_FAILED) return;
      let list = Array.isArray(schedRaw) ? schedRaw : [];
      const reqs = Array.isArray(reqRaw) ? reqRaw : [];
      const made = [];
      const lines = [];

      // 1. The patient has been delivered and the call is closed, so the
      //    journey home exists now.
      for (const req of callsNeedingReturn(reqs, list)) {
        const back = returnBookingFor(req, now);
        made.push(back);
        lines.push(
          `Return journey raised for ${back.nature} (${callRoute(back)})` +
            (back.awaitCall
              ? " — no time yet, the ward will call when the patient is ready"
              : ` — booked for ${whenStr(back.scheduledFor)}`)
        );
      }

      // 2. A repeating booking keeps the next couple of days stocked. Keyed by
      //    the calendar day so the same Tuesday is never booked twice, however
      //    many desks are watching.
      const templates = list.filter(
        (x) => x && isRecurring(x) && !isReturnLeg(x) && !x.repeatOf
      );

      // Arrangements that were dispatched before they stopped being
      // appointments. The board used to release the template itself, which left
      // a standing dialysis run reading "Sun 23 Aug 07:15 · DISPATCHED" for
      // ever, and sitting in Upcoming as a booking that had already gone. The
      // call it produced is a real call and stays exactly where it is; what is
      // repaired here is the arrangement, which is live and always was. A
      // stopped arrangement is left stopped.
      const stranded = templates.filter(
        (t) => t.status === "released" || t.status === "releasing"
      );
      for (const t of templates) {
        for (const occ of repeatOccurrencesDue(t, now)) {
          const exists = [...list, ...made].some(
            (x) => x && x.repeatOf === t.id && x.repeatKey === occ.key
          );
          if (exists) continue;
          made.push({
            ...t,
            id: uid("sch"),
            scheduledFor: occ.at,
            dispatchAt: t.dispatchAt ? occ.at - (t.scheduledFor - t.dispatchAt) : null,
            shift: scheduledShiftKey(occ.at),
            status: "scheduled",
            createdAt: now,
            createdBy: t.createdBy || "Repeat",
            repeatOf: t.id,
            repeatKey: occ.key,
            // The copy is an occurrence, not a second template — otherwise
            // every copy would start making copies of its own.
            repeat: null,
            releasedAt: null,
            releasedRequestId: null,
            releasedUnitId: null,
            cancelledAt: null,
            cancelledBy: null,
            readyCalledAt: null,
            readyCalledBy: null,
            claimedBy: null,
          });
          lines.push(
            `Repeating booking — ${t.nature} (${callRoute(t)}) added for ${whenStr(occ.at)}`
          );
        }
      }

      if (!made.length && !stranded.length) return;
      // Re-read immediately before writing: another desk may have made the same
      // ones in the seconds this took, and a duplicate booking is a second
      // ambulance sent to the same patient.
      const before = await readKeyRaw("ems:scheduled");
      if (before === READ_FAILED || !Array.isArray(before)) return;
      const keep = made.filter((m) =>
        m.returnOf
          ? !before.some((x) => x && x.returnOf === m.returnOf)
          : !before.some((x) => x && x.repeatOf === m.repeatOf && x.repeatKey === m.repeatKey)
      );
      const strandedIds = new Set(stranded.map((t) => t.id));
      const mended = strandedIds.size
        ? before.map((x) =>
            x && strandedIds.has(x.id) && (x.status === "released" || x.status === "releasing")
              ? {
                  ...x,
                  status: "scheduled",
                  releasedAt: null,
                  releasedRequestId: null,
                  releasedUnitId: null,
                  claimedBy: null,
                  claimedAt: null,
                }
              : x
          )
        : before;
      const changed = keep.length > 0 || mended.some((x, i) => x !== before[i]);
      if (!changed) return;
      await saveScheduled([...mended, ...keep]);
      for (const line of lines.slice(0, keep.length)) await addLog(line, "call");
    } catch (e) {
      console.error("booking pass failed:", e);
    } finally {
      bookingsRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!ready || !user) return;
    if (user.role !== "dispatcher" && user.role !== "admin") return;
    ensureBookings();
    const t = setInterval(ensureBookings, 15000);
    return () => clearInterval(t);
  }, [ready, user && user.role, ensureBookings]);

  // Checked on the same cadence as the board itself, and once straight away so
  // a desk opening after a booking's time has passed sends it out immediately
  // instead of waiting for the next tick.
  useEffect(() => {
    if (!ready) return;
    if (!user || (user.role !== "dispatcher" && user.role !== "admin")) return;
    releaseDueScheduled();
    const t = setInterval(releaseDueScheduled, POLL_MS);
    return () => clearInterval(t);
  }, [ready, user && user.role, releaseDueScheduled]);





  // Releases a crew member's Alpha/Bravo seat on sign-out and records the
  // shift they just finished, including any overtime. If that leaves the unit
  // completely unstaffed and it isn't on a call right now, the unit
  // automatically drops back to "Out of Service".
  async function handleLogout() {
    // Held up while this runs, so releasing the seat below does not read as
    // somebody else taking it and tear the session — and the token — down
    // before the shift has been written to the log.
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    try {
      await recordSignOut();
    } finally {
      signingOutRef.current = false;
    }
    setSession(null);
  }

  async function recordSignOut() {
    const now = Date.now();
    // Set inside the team branch below and answered once the seat has actually
    // been released. Asked before that, a crew member who cancelled the dialog
    // would have been signed out anyway with nothing recorded.
    let otAsk = null;
    if (user && user.role === "team" && user.unitId && user.slot) {
      const freshUnits = await readKey("ems:units", units);
      const unit = freshUnits.find((u) => u.id === user.unitId);
      if (unit) {
        const otherSlot = user.slot === "alpha" ? "bravo" : "alpha";
        const stillEmpty = !unit[otherSlot];
        const ot = overtimeMs(user, now);
        // Whether a call was holding them when the shift ended. Decided here,
        // where the board still has the call, and stamped on the log entry —
        // it is what decides whether the overtime goes to administration on
        // its own or is theirs to send. Worked out weeks later from a live
        // board that no longer carries the call, the answer is always "no".
        const heldBy = heldByCallAt(requests, unit.id, user.shiftEnd);
        if (ot > 0) {
          otAsk = {
            heldBy,
            claim: {
              id: overtimeClaimId({
                accountId: user.accountId,
                name: user.name,
                shiftStart: user.shiftStart,
                unitId: unit.id,
                seat: user.slot,
              }),
              name: user.name,
              accountId: user.accountId || "",
              unitName: unit.name,
              claimedMs: ot,
            },
          };
        }
        const outgoing = {
          name: user.name,
          accountId: user.accountId,
          shift: user.shift || null,
          shiftStart: user.shiftStart || null,
          shiftEnd: user.shiftEnd || null,
          signedOnAt: user.signedOnAt || null,
          signedOffAt: now,
          overtimeMs: ot,
        };
        // Somebody may already be waiting for this seat. They signed on while
        // this crew were still out; the seat becomes theirs now, without anyone
        // having to do anything about it.
        const waiting = queuedReliefFor(unit, user.slot);

        const patch = {
          [user.slot]: waiting
            ? {
                accountId: waiting.accountId,
                name: waiting.name,
                shift: waiting.shift,
                shiftStart: waiting.shiftStart,
                shiftEnd: waiting.shiftEnd,
                signedOnAt: waiting.queuedAt,
              }
            : null,
          relief: waiting ? { ...(unit.relief || {}), [user.slot]: null } : unit.relief,
          // Who last sat here, so whoever takes the seat next is recorded as
          // relieving them even though the seat was empty in between.
          lastCrew: { ...(unit.lastCrew || {}), [user.slot]: outgoing },
        };

        // A partner signed on from this device goes off with it. There is one
        // tablet between them; when it leaves the truck the second seat has no
        // way to sign itself off, and leaving them on the board would have the
        // sheet counting hours they were not working and dispatch believing the
        // unit is still crewed.
        const partner = unit[otherSlot];
        const partnerCameFromHere =
          partner && partner.viaSeat === user.slot &&
          (!partner.viaAccountId || partner.viaAccountId === user.accountId);
        if (partnerCameFromHere) {
          patch[otherSlot] = null;
          patch.lastCrew = {
            ...(patch.lastCrew || {}),
            [otherSlot]: {
              name: partner.name,
              accountId: partner.accountId,
              shift: partner.shift || null,
              shiftStart: partner.shiftStart || null,
              shiftEnd: partner.shiftEnd || null,
              signedOnAt: partner.signedOnAt || null,
              signedOffAt: now,
              overtimeMs: overtimeMs(partner, now),
            },
          };
        }

        const bothEmpty = (stillEmpty || partnerCameFromHere) && !waiting;
        if (bothEmpty && unit.status === "available") patch.status = "oos";
        const nextUnits = freshUnits.map((u) => (u.id === user.unitId ? { ...u, ...patch } : u));
        await saveUnits(nextUnits);
        if (partnerCameFromHere) {
          const pot = overtimeMs(partner, now);
          await addLog(
            `${unit.name} — ${partner.name} (${seatLabel(otherSlot)}) signed off with the shared device` +
              ` ${shiftPhrase(partner)}` + (pot > 0 ? ` · ${otHoursStr(pot)} overtime` : ""),
            "shift",
            {
              kind: "off",
              role: "team",
              name: partner.name,
              accountId: partner.accountId,
              unitId: unit.id,
              unitName: unit.name,
              station: stationOf(unit),
              seat: otherSlot,
              shift: partner.shift || null,
              shiftStart: partner.shiftStart || null,
              shiftEnd: partner.shiftEnd || null,
              overtimeMs: pot,
              onCall: !!heldBy,
              onCallNature: heldBy ? heldBy.nature : "",
              sharedDevice: true,
            }
          );
        }

        if (waiting) {
          await addLog(
            `${unit.name} — ${waiting.name} took over ${seatLabel(user.slot)} from ${user.name}, ` +
              `who has now cleared and signed out`,
            "shift",
            {
              kind: "on",
              role: "team",
              name: waiting.name,
              accountId: waiting.accountId,
              unitId: unit.id,
              unitName: unit.name,
              station: stationOf(unit),
              seat: user.slot,
              shift: waiting.shift || null,
              shiftStart: waiting.shiftStart || null,
              shiftEnd: waiting.shiftEnd || null,
              relievedName: user.name,
            }
          );
        }

        await addLog(
          `${unit.name} — ${user.name} (${seatLabel(user.slot)}) signed off ${shiftPhrase(user)}` +
            (ot > 0 ? ` · ${otHoursStr(ot)} overtime` : ""),
          "shift",
          {
            kind: "off",
            role: "team",
            name: user.name,
            accountId: user.accountId,
            // The id and the station were missing here, so every claim this
            // path raised was keyed to "?" and filed under the default
            // station — and `heldByCallAt` could never find the call that was
            // holding them, because it had no unit to look for.
            unitId: unit.id,
            unitName: unit.name,
            station: stationOf(unit),
            seat: user.slot,
            shift: user.shift || null,
            shiftStart: user.shiftStart || null,
            shiftEnd: user.shiftEnd || null,
            overtimeMs: ot,
            onCall: !!heldBy,
            onCallNature: heldBy ? heldBy.nature : "",
          }
        );
      }
    } else if (user && user.role === "dispatcher" && user.shift) {
      const ot = overtimeMs(user, now);
      await addLog(
        `Dispatch — ${user.name} signed off ${shiftPhrase(user)}` +
          (ot > 0 ? ` · ${otHoursStr(ot)} overtime` : ""),
        "shift",
        {
          kind: "off",
          role: "dispatcher",
          name: user.name,
          accountId: user.accountId,
          shift: user.shift,
          shiftStart: user.shiftStart || null,
          shiftEnd: user.shiftEnd || null,
          overtimeMs: ot,
        }
      );
    }

    // Overtime, and who it goes to.
    //
    // A call that held them past the end of the shift is not a choice anybody
    // made, and the department pays for it either way, so it goes to
    // administration on its own and they are simply told. Twenty minutes spent
    // tidying the truck is theirs — plenty of people would rather not claim for
    // it, and a queue full of hours nobody meant to claim is a queue an
    // administrator stops reading. So it is offered, once, here: after this
    // they are signed out and there is no tablet to offer it on.
    if (otAsk) {
      if (otAsk.heldBy) {
        window.alert(
          `You are ${otHoursStr(otAsk.claim.claimedMs)} past the end of your shift, and a call was ` +
            `running when it ended${otAsk.heldBy.nature ? ` — ${otAsk.heldBy.nature}` : ""}.\n\n` +
            `This has been sent to administration for you. You do not need to do anything.`
        );
      } else if (
        window.confirm(
          `You are ${otHoursStr(otAsk.claim.claimedMs)} past the end of your shift.\n\n` +
            `You were not on a call when it ended, so this is yours to claim or leave. ` +
            `Send it to administration?\n\n` +
            `It is on the shift log either way — this only decides whether anybody is asked to ` +
            `approve it.`
        )
      ) {
        await sendOvertimeClaim({
          claim: otAsk.claim,
          sent: overtimeSent,
          setSent: setOvertimeSent,
          user,
          addLog,
        });
      }
    }
  }

  // Swapping shift without leaving the board. The usual reason is a team that
  // ran past the end of their 12 hours on a call and is carrying straight on
  // into the next shift, or a dispatcher taking the desk over mid-seat. The
  // swap re-bases their 12-hour window on the shift they moved to and lands on
  // the log sheet with the overtime they carried across.
  async function changeShift(nextKey) {
    if (!user || !SHIFTS[nextKey] || nextKey === user.shift) return;
    const now = Date.now();
    const carried = overtimeMs(user, now);
    const next = shiftAssignment(nextKey, now);
    const from = shiftMeta(user.shift);
    const detail = {
      kind: "swap",
      role: user.role,
      name: user.name,
      accountId: user.accountId,
      fromShift: user.shift || null,
      shift: nextKey,
      shiftStart: next.shiftStart,
      shiftEnd: next.shiftEnd,
      overtimeMs: carried,
    };

    if (user.role === "team" && user.unitId && user.slot) {
      const freshUnits = await readKey("ems:units", units);
      const seated = freshUnits.find(
        (u) => u.id === user.unitId && u[user.slot] && u[user.slot].accountId === user.accountId
      );
      if (seated) {
        await saveUnits(
          freshUnits.map((u) =>
            u.id === user.unitId ? { ...u, [user.slot]: { ...u[user.slot], ...next } } : u
          )
        );
      }
      detail.unitName = user.unitName || (seated ? seated.name : "");
      detail.seat = user.slot;
      await addLog(
        `${detail.unitName ? `${detail.unitName} — ` : ""}${user.name} (${seatLabel(user.slot)}) swapped ` +
          `${from ? from.label : "shift"} → ${shiftPhrase(next)}` +
          (carried > 0 ? ` · ${otHoursStr(carried)} overtime carried over` : ""),
        "shift",
        detail
      );
    } else {
      await addLog(
        `Dispatch — ${user.name} swapped ${from ? from.label : "shift"} → ${shiftPhrase(next)}` +
          (carried > 0 ? ` · ${otHoursStr(carried)} overtime carried over` : ""),
        "shift",
        detail
      );
    }

    setSession({ ...user, ...next });
  }

  // The moment a session crosses the end of its 12 hours it goes on the log
  // sheet, once per shift window, from the device actually working it (so five
  // open boards don't log the same crossing five times). Someone who signs on
  // already past their shift end said so on the way in — that sign-on line
  // already carries the overtime, so this doesn't repeat it.
  //
  // Which window has already been announced is remembered with the session, so
  // refreshing the page halfway through a long shift doesn't put a second
  // OVERTIME line on the log sheet for a crossing that was recorded before the
  // reload.
  const overtimeLogged = useRef(restoredSession.current ? restoredSession.current.overtimeWindow || null : null);
  useEffect(() => {
    if (!user || !user.shiftEnd) return;
    const windowKey = `${user.accountId || user.name}:${user.shiftEnd}`;
    if (overtimeLogged.current === windowKey) return;
    if ((user.signedOnAt || 0) >= user.shiftEnd) {
      overtimeLogged.current = windowKey;
      patchSession({ overtimeWindow: windowKey });
      return;
    }
    const announce = () => {
      if (overtimeLogged.current === windowKey) return;
      overtimeLogged.current = windowKey;
      patchSession({ overtimeWindow: windowKey });
      const where = user.role === "team" ? `${user.unitName || "Team"} — ` : "Dispatch — ";
      const seat = user.slot ? ` (${seatLabel(user.slot)})` : "";
      addLog(
        `${where}${user.name}${seat} is now on OVERTIME — still working past the end of ${shiftPhrase(user)}`,
        "shift",
        {
          kind: "overtime",
          role: user.role,
          name: user.name,
          accountId: user.accountId,
          unitName: user.unitName || "",
          seat: user.slot || null,
          shift: user.shift,
          shiftStart: user.shiftStart,
          shiftEnd: user.shiftEnd,
          overtimeMs: 0,
        }
      );
    };
    const delay = user.shiftEnd - Date.now();
    if (delay <= 0) {
      announce();
      return;
    }
    const t = setTimeout(announce, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user && user.accountId, user && user.shiftEnd, user && user.shift]);

  // If someone else takes this seat over — a shift swap where the incoming
  // crew claims a seat the outgoing crew never signed out of, or an admin
  // standing them down — the displaced session drops back to the login screen
  // rather than quietly working a seat it no longer holds. The grace period
  // keeps a poll that was already in flight when the seat was written from
  // bouncing the person who has just signed in.
  useEffect(() => {
    if (!ready || !user || user.role !== "team" || !user.unitId || !user.slot) return;
    // A sign-out of their own is not somebody taking the seat off them.
    //
    // Signing out releases the seat, which made this effect fire in the middle
    // of `handleLogout` — and `setSession(null)` takes the token with it. From
    // that moment every remaining line of the sign-out was sent to the board
    // with no Authorization header and answered 401: the shift's `kind: "off"`
    // entry, and with it the hours, the overtime claim and the crew's UHU for
    // that stay. The screen looked exactly right and the record was never
    // written. It only ever affected crews — a dispatcher's sign-out touches no
    // seat — which is to say it only affected the people whose hours the
    // department is actually measured on.
    if (signingOutRef.current) return;
    if (Date.now() - (user.signedOnAt || 0) < POLL_MS * 4) return;
    const unit = units.find((u) => u.id === user.unitId);
    if (!unit) return;
    const seat = unit[user.slot];
    if (!seat || (user.accountId && seat.accountId !== user.accountId)) setSession(null);
  }, [units, user, ready]);

  // If an admin removes the account you're signed in with, the next poll drops
  // you back to the login screen rather than leaving a deleted user working the
  // board. The seat was already released by whoever removed the account, so
  // this only clears the local session.
  useEffect(() => {
    if (!ready || !user || !user.accountId || accounts.length === 0) return;
    if (!accounts.some((a) => a.id === user.accountId)) {
      setSession(null);
    }
  }, [accounts, user, ready]);

  if (!ready) {
    return (
      <div style={styles.loadingScreen}>
        {!connectFailed ? (
          <div style={styles.loadingMark}>
            <BrandLockup size={132} />
            <div style={styles.loadingText}>CONNECTING TO DISPATCH…</div>
          </div>
        ) : (
          <div style={styles.connectErrorBox}>
            <div style={styles.connectErrorTitle}>Still connecting…</div>
            <div style={styles.connectErrorBody}>
              This is taking much longer than normal. The most common causes:
            </div>
            <ul style={styles.connectErrorList}>
              <li>Firebase Authentication → Anonymous sign-in isn't enabled yet</li>
              <li>No Firestore database has been created for this project</li>
              <li>The Firestore security rules are blocking access</li>
            </ul>
            <button style={styles.connectRetryBtn} onClick={() => window.location.reload()}>
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        units={units}
        onLogin={handleLogin}
        saveUnits={saveUnits}
        addLog={addLog}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
    );
  }

  // The log sheet is a dispatch/admin tool — crews get their team's UHU in
  // that spot instead. Dispatch and admin see both, and since the shareable
  // export is the log sheet in spreadsheet form, that button follows the
  // same rule.
  const seesLogSheet = user.role === "admin" || user.role === "dispatcher";



  // Where each role actually moves between. Not a menu of everything — four
  // places at most, because a bar with seven tabs is a menu wearing a costume.
  const navTabs =
    // Each glyph is the thing itself rather than an abstract shape. The old
    // geometric marks — a filled square, a half circle, a quarter circle — told
    // nobody anything: they had to be learned from the word underneath, which
    // makes the picture decoration rather than a signpost. A crew glancing down
    // with one thumb should recognise the destination before reading it.
    user.role === "dispatcher"
      ? [
          // The board is the ambulances.
          { key: "board", glyph: "🚑", label: "Board" },
          // Where the trucks that are out actually are.
          { key: "map", glyph: "🗺", label: "Map" },
          // What is coming and what has been — a booking that has just gone
          // out, and the call it became.
          { key: "history", glyph: "🗓", label: "Schedule" },
          { key: "teams", glyph: "👥", label: "Teams" },
          // The shelf the answers live on. Messages are not here on purpose:
          // they are a pill above the bar, so reading one never costs the
          // dispatcher the board they were reading it about.
          { key: "policies", glyph: "📖", label: "Policies" },
          // Filing the shift's log.
          { key: "log", glyph: "📤", label: "Submit" },
        ]
      : user.role === "admin"
        ? [
            { key: "board", glyph: "🚑", label: "Board" },
            { key: "stats", glyph: "📊", label: "Statistics" },
            // Badged when somebody cannot sign in. They are standing at a
            // tablet waiting, and an administrator who never opens this tab
            // would otherwise not find out until they were told in person.
            {
              key: "teams",
              glyph: "👥",
              label: "Teams",
              badge: pendingResets(passwordResets).length,
            },
            // What is on the trucks. Its own page rather than a panel inside
            // Teams: a supervisor chasing a missing cylinder is doing a
            // different job from one looking at a roster.
            { key: "stock", glyph: "📦", label: "Inventory" },
            { key: "policies", glyph: "📖", label: "Policies" },
            // Kept, not sent — a different action from the desk's Submit, so a
            // different picture.
            { key: "log", glyph: "🗄", label: "Archive" },
          ]
        : [
            // A crew's own call, their own record, and their own truck.
            { key: "board", glyph: "🚨", label: "My call" },
            // Red while the truck still has to be made up after a call. The
            // crew are back at station by then and this is the only prompt
            // they get.
            {
              key: "history",
              glyph: "🕘",
              label: "History",
              badge: callsAwaitingRestock(
                requests,
                user.unitId,
                crewShiftWindow(user, Date.now()).start,
                restockDone
              ).length,
            },
            { key: "teams", glyph: "🚑", label: "My truck" },
            { key: "policies", glyph: "📖", label: "Policies" },
          ];

  // The two shared pages replace whatever the role would otherwise show, rather
  // than appearing above it — a messages page with the whole board underneath
  // it is not a page.
  const onSharedPage = navTab === "policies";

  return (
    <div style={styles.app}>
      <GlobalFont />
      <Header
        user={user}
        clock={clock}
        onLogout={handleLogout}
        onChangeShift={changeShift}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
      {/* Directly under the header, above everything, for every role. Nobody
          should have to scroll to find out whether the board is reaching the
          server. */}
      <ConnectionBanner />
      <StorageBanner role={user.role} />
      {/* The bar floats over the board, so the last section needs room to clear
          it — otherwise the final call on a long day sits underneath it. */}
      <div style={{ ...styles.body, paddingBottom: 128 }}>
        {navTab === "policies" && (
          <PolicyLibrary
            policies={policies}
            canManage={user.role === "admin"}
            onAdd={addPolicy}
            onRemove={removePolicy}
            busy={policyBusy}
          />
        )}

        <div style={styles.mainCol}>
          {!onSharedPage && user.role === "dispatcher" && (
            <DispatcherView
              page={navTab}
              newCallSignal={newCallSignal}
              coverage={coverage}
              setCoverage={setCoverage}
              user={user}
              units={units}
              requests={requests}
              scheduled={scheduled}
              saveUnits={saveUnits}
              saveRequests={saveRequests}
              saveScheduled={saveScheduled}
              addLog={addLog}
              audioCtxRef={audioCtxRef}
              messages={messages}
              setMessages={setMessages}
              locations={locations}
              archives={archives}
            />
          )}
          {!onSharedPage && user.role === "team" && (
            <TeamView
              onGoToPage={(t) => setNavTab(t)}
              overtimeSent={overtimeSent}
              setOvertimeSent={setOvertimeSent}
              restockDone={restockDone}
              setRestockDone={setRestockDone}
              messages={messages}
              setMessages={setMessages}
              inventory={inventory}
              inventoryMoves={inventoryMoves}
              setInventoryMoves={setInventoryMoves}
              locations={locations}
              setLocations={setLocations}
              trackingConsents={trackingConsents}
              setTrackingConsents={setTrackingConsents}
              page={navTab}
              checklists={checklists}
              checklistRuns={checklistRuns}
              setChecklistRuns={setChecklistRuns}
              user={user}
              units={units}
              requests={requests}
              saveUnits={saveUnits}
              saveRequests={saveRequests}
              addLog={addLog}
              audioCtxRef={audioCtxRef}
            />
          )}
          {!onSharedPage && user.role === "admin" && (
            <AdminView
              page={navTab}
              archives={archives}
              passwordResets={passwordResets}
              setPasswordResets={setPasswordResets}
              user={user}
              units={units}
              requests={requests}
              scheduled={scheduled}
              accounts={accounts}
              saveUnits={saveUnits}
              saveAccounts={saveAccounts}
              refreshAccounts={() => {
                const fn = refreshAccountsRef.current;
                if (fn) return fn();
              }}
              saveRequests={saveRequests}
              saveScheduled={saveScheduled}
              addLog={addLog}
              audioCtxRef={audioCtxRef}
              submissions={submissions}
              coverage={coverage}
              checklists={checklists}
              setChecklists={setChecklists}
              checklistRuns={checklistRuns}
              log={log}
              inventory={inventory}
              setInventory={setInventory}
              inventoryMoves={inventoryMoves}
              setInventoryMoves={setInventoryMoves}
              overtimeDecisions={overtimeDecisions}
              setOvertimeDecisions={setOvertimeDecisions}
              overtimeSent={overtimeSent}
              setOvertimeSent={setOvertimeSent}
              locations={locations}
              trackingConsents={trackingConsents}
              setTrackingConsents={setTrackingConsents}
            />
          )}
        </div>
        {/* Both of these are about the crews, so both live on the Teams page.
            They were rendering beside every page — the board, the schedule, the
            statistics — which put two long panels next to work that had nothing
            to do with them, and made every screen longer than it needed to be. */}
        {navTab === "teams" && (
          <div style={styles.sideCol}>
            {seesLogSheet ? (
              <React.Fragment>
                <UhuPanel
                  units={user.role === "admin" ? units : atStation(units, user.station || DEFAULT_STATION)}
                  requests={user.role === "admin" ? requests : atStation(requests, user.station || DEFAULT_STATION)}
                />
                <div style={{ height: 16 }} />
                <LogSheet
                  log={log}
                  units={user.role === "admin" ? units : atStation(units, user.station || DEFAULT_STATION)}
                  station={user.role === "admin" ? null : user.station || DEFAULT_STATION}
                />
              </React.Fragment>
            ) : (
              // A crew sees their own truck's figure, on their own truck's page.
              <UhuPanel units={units} requests={requests} focusUnitId={user.unitId} />
            )}
          </div>
        )}
      </div>
      {/* The bar. Each role gets the places it actually moves between, and the
          one action it starts things with — the desk raises calls, the crew
          raises an assist, an administrator exports. */}
      <BottomBar
        tabs={navTabs}
        active={navTab}
        onSelect={setNavTab}
        action={
          user.role === "dispatcher"
            ? {
                label: "New call",
                onClick: () => {
                  setNavTab("board");
                  setNewCallSignal((n) => n + 1);
                },
              }
            : user.role === "admin"
              ? {
                  label: "Export",
                  // Today, not everything.
                  //
                  // It was exporting every call the board had ever held, so an
                  // administrator pressing this at the end of a shift got months
                  // of history and had to find today inside it. The operational
                  // day is what somebody wants when they press Export: the day
                  // shift and the night that follows, as they stand, with the
                  // coverage gaps that happened in them.
                  onClick: () => {
                    // The operational day running now: 07:00 today through
                    // 07:00 tomorrow, which is the day shift and the night that
                    // follows it. Before 07:00 that is still yesterday's day.
                    const from = opDayStart(Date.now());
                    const to = opDayEnd(from);
                    exportAndShareLog(
                      (log || []).filter((e) => e && e.ts >= from && e.ts < to),
                      (requests || []).filter((r) => r && r.createdAt >= from && r.createdAt < to),
                      units,
                      (scheduled || []).filter(
                        (x) => x && x.scheduledFor >= from && x.scheduledFor < to
                      ),
                      null,
                      (coverage || []).filter((c) => c && c.startedAt >= from && c.startedAt < to),
                      from,
                      from,
                      // Both shifts, not one: this button exports the whole
                      // operational day, and labelling it DAY or NIGHT would be
                      // a plain untruth on half the rows.
                      `${opDayLabel(from)} · 07:00 → 07:00 · day and night`
                    );
                  },
                }
              : null
        }
      />
    </div>
  );
}