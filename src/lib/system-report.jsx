import { API_BASE } from "./board-api.jsx";
import { authHeaders, getToken } from "./auth.jsx";
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
    if (!getToken()) return;
    await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
  } catch (e) {
    // No signal, or the server is the thing that is down. Either way the
    // report is not worth a retry loop; the fleet table's silence says it.
  }
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
    post("/api/system/hello", {
      deviceId: systemDeviceId(),
      role: ctx.role || "",
      unit: ctx.unit || "",
      build: BUILD_STAMP,
      platform: ctx.platform || platformOf(),
    });
  } catch (e) {
    /* never at the poll's expense */
  }
}
