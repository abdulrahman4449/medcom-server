import { API_BASE } from "./board-api.jsx";
import { authHeaders, getToken } from "./auth.jsx";
import { nativeBackgroundStatus, shellReport } from "./dates.jsx";
import { pendingWrites, totalPendingCount } from "./offline-queue.jsx";
import { BUILD_STAMP } from "../brand/build-stamp.jsx";

// ---------- the app reporting its own faults ----------
//
// A JavaScript error on a crew phone used to die on that phone: the screen
// went wrong, the crew shrugged or complained days later, and the one thing
// that would have named the fault — the error itself — was never seen by
// anybody who could fix it. So the app catches its own errors and posts a
// small, scrubbed report to the server, where the owner's System page lists
// them with the build stamp that says whether the device was even running
// the current version.
//
// Three rules keep the reporter from becoming a fault of its own:
// it never throws (every path is wrapped), it never loops (a fault is sent
// once per ten minutes however often it fires), and it never runs signed out
// (before sign-in there is no token, and a 401-loop at the login screen is
// the bug this app has already had once).

let getContext = () => ({});
const recentlySent = new Map(); // message -> ts
const REPORT_ONCE_MS = 10 * 60 * 1000;

// This device's own name for itself, stable across reloads, so the fleet
// table can tell two phones on one account apart. Random, not personal.
export function systemDeviceId() {
  try {
    let id = window.localStorage.getItem("ems:deviceId");
    if (!id) {
      id = "d" + Math.random().toString(36).slice(2, 12);
      window.localStorage.setItem("ems:deviceId", id);
    }
    return id;
  } catch (e) {
    return "d-no-storage";
  }
}

async function post(path, body) {
  try {
    if (!getToken()) return null;
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    return await res.json().catch(() => null);
  } catch (e) {
    // No signal, or the server is the thing that is down. Either way the
    // report is not worth a retry loop; the fleet table's silence says it.
    return null;
  }
}

// The fuller self-check the owner can ask a device for from the System page:
// the crew screen's diagnostic line, readable without holding the phone.
// Everything is read defensively — a diagnostic that throws is a fault, and
// short — it crosses the network and sits in a bounded store.
async function gatherDiagnostics() {
  const d = {};
  try { d.notifications = typeof window.Notification !== "undefined" ? window.Notification.permission : "unsupported (native shell)"; } catch (e) { d.notifications = "unreadable"; }
  try { d.alertsArmed = window.localStorage.getItem("ems:alertsArmed") ? "yes" : "no"; } catch (e) { d.alertsArmed = "storage unreadable"; }
  try {
    window.localStorage.setItem("ems:diagProbe", "1");
    window.localStorage.removeItem("ems:diagProbe");
    d.storage = "working";
  } catch (e) { d.storage = "NOT WRITABLE"; }
  try {
    const plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
    d.alarmPlugin = plugins.PulseOpsAlarm ? "present" : "absent";
    d.pushPlugin = plugins.PulseOpsPush ? "present" : "absent";
  } catch (e) { d.alarmPlugin = "unreadable"; }
  // The shell's own verdict on itself, and the four Android settings that
  // silence an alert — the exact lines the crew screen shows, readable here
  // without holding the phone. A browser has neither and says so.
  try { d.shell = shellReport(); } catch (e) { d.shell = "unreadable"; }
  try {
    const bg = await Promise.race([
      Promise.resolve(nativeBackgroundStatus()),
      new Promise((r) => setTimeout(() => r(null), 3000)),
    ]);
    if (bg) {
      d.appNotifications = bg.notificationsEnabled ? "enabled" : "TURNED OFF for this app";
      d.dispatchChannel = bg.channelSilenced ? "SILENCED by the owner" : "sounding";
      d.alarmVolume = `${bg.alarmVolumePct != null ? bg.alarmVolumePct : "?"}%${(bg.alarmVolumePct || 0) < 30 ? " — LOW" : ""}`;
      d.batteryOptimisation = bg.batteryOptimised ? "ON — Android may freeze the app" : "off";
    }
  } catch (e) {
    /* a shell without the method simply reports the web-side facts */
  }
  try { d.online = window.navigator.onLine ? "yes" : "no"; } catch (e) {}
  try { d.language = window.navigator.language || ""; } catch (e) {}
  try { d.userAgent = String(window.navigator.userAgent || "").slice(0, 110); } catch (e) {}
  return d;
}

export function reportFault(message, stack, screen) {
  try {
    const msg = String(message || "").slice(0, 300);
    if (!msg) return;
    const last = recentlySent.get(msg);
    const now = Date.now();
    if (last && now - last < REPORT_ONCE_MS) return;
    recentlySent.set(msg, now);
    if (recentlySent.size > 40) recentlySent.delete(recentlySent.keys().next().value);
    const ctx = safeContext();
    post("/api/system/report", {
      message: msg,
      stack: String(stack || "").slice(0, 900),
      screen: String(screen || ctx.screen || "").slice(0, 80),
      build: BUILD_STAMP,
      role: ctx.role || "",
      unit: ctx.unit || "",
      platform: ctx.platform || platformOf(),
    });
  } catch (e) {
    // The reporter must never be the second fault.
  }
}

function safeContext() {
  try {
    return getContext() || {};
  } catch (e) {
    return {};
  }
}

function platformOf() {
  try {
    return window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : "web";
  } catch (e) {
    return "web";
  }
}

let installed = false;
export function installSystemReporting(contextFn) {
  if (contextFn) getContext = contextFn;
  // Once. The effect that calls this re-runs when its poll callbacks are
  // rebuilt, and window listeners added twice report every fault twice.
  if (installed) return;
  installed = true;
  try {
    window.addEventListener("error", (e) => {
      reportFault(e && e.message, e && e.error && e.error.stack);
    });
    window.addEventListener("unhandledrejection", (e) => {
      const r = e && e.reason;
      reportFault((r && r.message) || String(r || "unhandled rejection"), r && r.stack);
    });
  } catch (e) {
    /* a browser without these still runs the app */
  }
}

// "This device is alive, on this build, riding this truck." Sent on the cold
// poll but throttled to once every five minutes — the fleet table needs a
// heartbeat, not another poll.
let lastHello = 0;
export function systemHello() {
  try {
    const now = Date.now();
    if (now - lastHello < 5 * 60 * 1000) return;
    lastHello = now;
    const ctx = safeContext();
    // What this device is still holding unsent — the offline queue is where
    // the ghost-reset bug lived, and a record held for hours is a device
    // fighting the board. The fleet table shows it from the server's side.
    let heldWrites = 0;
    let heldOldestMs = 0;
    try {
      heldWrites = totalPendingCount();
      if (heldWrites) {
        let oldest = Infinity;
        for (const key of Object.keys(pendingWrites)) {
          for (const rec of Object.values(pendingWrites[key] || {})) {
            if (rec && rec.__queuedAt && rec.__queuedAt < oldest) oldest = rec.__queuedAt;
          }
        }
        if (Number.isFinite(oldest)) heldOldestMs = now - oldest;
      }
    } catch (e) {
      /* the heartbeat goes out with or without the queue detail */
    }
    const hello = {
      deviceId: systemDeviceId(),
      role: ctx.role || "",
      unit: ctx.unit || "",
      build: BUILD_STAMP,
      platform: ctx.platform || platformOf(),
      heldWrites,
      heldOldestMs,
    };
    post("/api/system/hello", hello).then(async (answer) => {
      // The owner asked this device for its diagnostics: answer once, now,
      // outside the throttle — they are sitting at the page waiting.
      if (answer && answer.sendDiagnostics) {
        post("/api/system/hello", { ...hello, diagnostics: await gatherDiagnostics() });
      }
    });
  } catch (e) {
    /* never at the poll's expense */
  }
}
