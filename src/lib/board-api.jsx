
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
export const LIVE_SITE = "https://medcom-server.onrender.com";
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