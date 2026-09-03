
// ---------- storage layer (Netlify DB via the /api/board function) ----------

// The web version of this app is served from this same domain, so a relative
// "/api/board" URL works fine there. Once this page is loaded inside a native
// iOS/Android shell instead (Capacitor), it's no longer running on this
// domain at all — so every call has to point at the full URL of the live
// site instead of a relative path, or it has nothing to resolve against.
//
// This is decided at runtime rather than hardcoded, because the same www/
// folder is both the web build and the payload the native shell bundles. A
// fixed absolute URL meant the web copy also called the live production site,
// so opening this deploy in a browser read and wrote the real dispatch board
// instead of the backend it is served alongside.
//
// Native is detected via the Capacitor bridge, which the webview injects
// before this file runs. Protocol alone is not enough: iOS loads from
// capacitor://localhost but Android loads from http://localhost, which is
// indistinguishable from a plain local web server.
// TESTING CONFIG: this points at your Mac's own local server for Simulator
// testing (see README's "Test in the Simulator first" section). Before this
// app goes to real devices or the App Store, change this back to your real,
// always-on server URL (Render, etc.) — "localhost" only means anything on
// the same Mac the server is running on.
export const LIVE_SITE = "https://pulseops-ems.com";
export const IS_NATIVE_SHELL =
  (typeof window !== "undefined" &&
    !!window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === "function" &&
    window.Capacitor.isNativePlatform()) ||
  (typeof location !== "undefined" && location.protocol === "capacitor:");
export const API_BASE = IS_NATIVE_SHELL ? LIVE_SITE : "";

// Returned by readKeyRaw when the read itself failed, as opposed to the key
// genuinely being empty. The difference matters: an empty board should be
// seeded with defaults, but a failed read must NOT be, or a transient DB
// error would overwrite the real roster with the built-in accounts and
// resurrect every user an admin had removed.
export const READ_FAILED = Symbol("READ_FAILED");

// Where this build is actually talking to, in words. On a phone that is the
// live site; in a browser it is whatever domain served the page.
export function serverAddress() {
  const raw = API_BASE || (typeof location !== "undefined" ? location.origin : "");
  return String(raw).replace(/^https?:\/\//, "") || "this site";
}

// "Failed to fetch" is what a browser throws when a request never completed,
// and it is what a crew — and an administrator setting up a new server — were
// being shown, in red, on the sign-in screen. It names nothing: not the
// address that was tried, not whether the phone has a network at all, not
// whether the server is the thing that is down. Every one of those is a
// different job for a different person.
//
// So a fetch that never completed says what it tried to reach and what to
// check. The three causes, in the order they actually happen: the device has
// no network, the address is wrong or does not resolve from this device (an
// emulator with no DNS, a phone on a hospital wifi that blocks it), or the
// server is not answering — including a TLS certificate the device will not
// trust, which a browser reports as exactly the same failure as being offline.
export function serverUnreachable(cause) {
  const err = new Error(
    `Cannot reach the server at ${serverAddress()}. This device has no route to it — ` +
      `check that the device is online, that the address is right, and that the server is running.`
  );
  // Marked so a caller can tell "the server said no" from "nothing answered".
  // A wrong password and an unreachable server must never read the same.
  err.offline = true;
  if (cause) err.cause = cause;
  return err;
}

// fetch() rejects only when the request never completed; a 401 or a 500 is a
// resolved promise. So anything thrown by the call itself is a network
// failure by definition, and this is the one place that has to say so.
export async function fetchOrExplain(url, init) {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw serverUnreachable(e);
  }
}