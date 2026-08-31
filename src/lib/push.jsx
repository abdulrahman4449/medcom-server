// ---------- telling the server where to wake this phone ----------
//
// The push follows the SEAT: while a crew member is signed on to a truck,
// this phone's FCM token is registered against that truck, and the server
// wakes it the moment a call lands there — locked, dozing, or with the app
// swiped away. The token comes from the shell's PulseOpsPush plugin; a build
// without it (the web, iOS, an Android shell not yet rebuilt) simply has no
// plugin, everything here returns quietly, and the three-second poll stays
// the whole story exactly as before.

import { authHeaders } from "./auth.jsx";
import { API_BASE } from "./board-api.jsx";

function pushPlugin() {
  try {
    const cap = typeof window !== "undefined" && window.Capacitor;
    const p = cap && cap.Plugins && cap.Plugins.PulseOpsPush;
    return p && typeof p.getToken === "function" ? p : null;
  } catch (e) {
    return null;
  }
}

export function pushAvailable() {
  return !!pushPlugin();
}

// What this device last registered, so a render loop cannot hammer the server
// with the same registration — it is re-sent only when the token or the seat
// actually changes, and once per app start regardless (tokens rotate).
const LAST_KEY = "ems:pushReg";
let sentThisRun = false;

export async function registerPushSeat(unitId, station) {
  const p = pushPlugin();
  if (!p) return;
  try {
    const got = await p.getToken();
    const token = got && got.token;
    if (!token) return;
    const want = JSON.stringify({ token, unitId: unitId || "", station: station || "" });
    let last = null;
    try {
      last = window.localStorage.getItem(LAST_KEY);
    } catch (e) {
      /* private mode */
    }
    if (sentThisRun && last === want) return;
    const res = await fetch(`${API_BASE}/api/push/register`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ token, unitId: unitId || "", station: station || "", platform: "android" }),
    });
    if (res.ok) {
      sentThisRun = true;
      try {
        window.localStorage.setItem(LAST_KEY, want);
      } catch (e) {
        /* private mode */
      }
    }
  } catch (e) {
    // An old shell, or no signal. The poll still works; nothing to say here.
  }
}

// Called at sign-out, while the auth token is still held — a phone whose crew
// has gone home must not go on being woken for that truck all night.
export async function unregisterPushSeat() {
  const p = pushPlugin();
  if (!p) return;
  try {
    const got = await p.getToken();
    const token = got && got.token;
    if (!token) return;
    try {
      window.localStorage.removeItem(LAST_KEY);
    } catch (e) {
      /* private mode */
    }
    sentThisRun = false;
    await fetch(`${API_BASE}/api/push/unregister`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch (e) {
    // Two months of silence prunes it server-side either way.
  }
}
