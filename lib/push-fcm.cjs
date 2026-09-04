// ---------- sending a push through Firebase Cloud Messaging ----------
//
// The one channel that reaches a locked, dozing, even force-quit Android
// phone. Dependency-free on purpose: the FCM v1 API wants an OAuth2 token
// minted from a service-account key, and Node's own crypto signs the JWT in a
// dozen lines - firebase-admin would add forty megabytes to do the same.
//
// Configured by ONE environment variable on the server:
//   FIREBASE_SERVICE_ACCOUNT       - the service-account JSON, pasted whole
//   FIREBASE_SERVICE_ACCOUNT_PATH  - or a path to that JSON on disk
// Without either, everything here answers "not configured" and the board
// behaves exactly as before - push is an addition, never a dependency.
//
// PRIVACY: nothing patient-shaped ever goes into a push. The message says a
// call landed and no more - it travels through Google's servers and sits on a
// lock screen, and an MRN in either place is a reportable disclosure for a
// health app. The details live on the board, behind the sign-in.

const crypto = require("crypto");
const fs = require("fs");

function serviceAccount() {
  try {
    const raw =
      process.env.FIREBASE_SERVICE_ACCOUNT ||
      (process.env.FIREBASE_SERVICE_ACCOUNT_PATH &&
        fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8")) ||
      "";
    if (!raw) return null;
    const sa = JSON.parse(raw);
    return sa && sa.client_email && sa.private_key && sa.project_id ? sa : null;
  } catch (e) {
    return null;
  }
}

function pushConfigured() {
  return !!serviceAccount();
}

// The OAuth2 access token, cached until shortly before it expires - minting
// one per push would double every send and hammer Google's token endpoint.
let cached = null;

async function accessToken() {
  const sa = serviceAccount();
  if (!sa) return null;
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (s) => Buffer.from(JSON.stringify(s)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const jwt = `${unsigned}.${signer.sign(sa.private_key).toString("base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      "grant_type=" +
      encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") +
      "&assertion=" +
      encodeURIComponent(jwt),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const body = await res.json();
  cached = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(60, (body.expires_in || 3600) - 300) * 1000,
  };
  return cached.token;
}

// One message to one device. HIGH priority is what carries it through Doze;
// the channel id routes it onto the dispatch channel the alarm plugin builds,
// which sounds on the alarm stream, through silent, with the app backgrounded,
// locked or killed. Returns { ok, dead } - dead marks a token Firebase says
// belongs to nobody any more (app uninstalled, token rotated), so the caller
// can drop it instead of failing on it for ever.
// The message itself, built as a pure function so its shape is under npm test.
//
// BOTH PLATFORMS OR NEITHER. The payload used to carry an `android` block and
// nothing else, which on an iPhone is a data-only message: no banner, no
// sound, delivered silently to an app that is not running. Android would have
// been woken and iOS would not, from the same call, with nothing anywhere
// saying so.
//
// `interruption-level: time-sensitive` is the strongest thing available
// without Apple's Critical Alert entitlement: it breaks through Focus modes
// and scheduled summaries. It does NOT beat the silent switch or the volume
// slider — that is what the entitlement is for, and until it is granted the
// honest position is that an iPhone on silent can still miss a call.
// Which of the department's two tones a push should carry.
//
// The same rule as everywhere else: ALS and CCT share the urgent tone —
// both mean somebody getting up and moving now, and a crew woken at three in
// the morning does not act on the difference — and BLS keeps its own, because
// that IS a difference they act on. A push that arrives with the phone's
// ordinary notification chime sounds like a text message; a crew has to be
// able to know what it is before they have looked at the screen.
function pushSound(priority) {
  const p = String(priority || "").toLowerCase();
  return p === "bls" || p === "routine"
    ? "dispatch_alert_bls.wav"
    : "dispatch_alert_cct.wav";
}

function callMessage(token, { title, body, data, channelId, priority }) {
  const heading = String(title || "NEW CALL");
  const line = String(body || "");
  const sound = pushSound(priority || (data && data.priority));
  return {
    message: {
      token,
      android: {
        priority: "HIGH",
        notification: {
          title: heading,
          body: line,
          // On Android the SOUND belongs to the channel, not to the message —
          // the OS ignores a per-message sound once a channel exists, and a
          // channel's sound cannot be changed after it is created. So the
          // tone is chosen by which channel the alarm plugin built, and the
          // id is what selects it.
          channel_id: String(channelId || "pulseops_dispatch_v2"),
          // One tag, so a second push replaces the banner instead of stacking.
          tag: "dispatch-call",
        },
      },
      apns: {
        headers: {
          // 10 is "deliver now"; anything lower may be held back to save
          // battery, which for a dispatch is the whole point missed.
          "apns-priority": "10",
          "apns-push-type": "alert",
          // The iOS twin of the Android tag: a second push replaces the
          // banner rather than stacking a second one behind it.
          "apns-collapse-id": "dispatch-call",
        },
        payload: {
          aps: {
            alert: { title: heading, body: line },
            // The department's own tone, bundled in the app. Falls back to
            // the system sound if the file is not in the build.
            sound: sound,
            "interruption-level": "time-sensitive",
          },
        },
      },
      data: Object.fromEntries(
        Object.entries(data || {}).map(([k, v]) => [String(k), String(v)])
      ),
    },
  };
}

async function sendCallAlert(token, { title, body, data, channelId }) {
  const sa = serviceAccount();
  if (!sa) return { ok: false, dead: false };
  const bearer = await accessToken();
  if (!bearer) return { ok: false, dead: false };
  const message = callMessage(token, { title, body, data, channelId });
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify(message),
    }
  );
  if (res.ok) return { ok: true, dead: false };
  let dead = res.status === 404;
  try {
    const err = await res.json();
    const code = err && err.error && err.error.status;
    const detail = JSON.stringify(err && err.error && err.error.details);
    if (code === "NOT_FOUND" || code === "INVALID_ARGUMENT" || /UNREGISTERED/.test(detail || "")) dead = true;
  } catch (e) {
    /* the status code has already decided */
  }
  return { ok: false, dead };
}

// Is the credential still good? Minting an access token proves the service
// account without sending anything — a revoked Firebase key otherwise fails
// silently until the 03:00 call nobody hears. The nightly self-test asks.
async function pushProbe() {
  if (!pushConfigured()) return { ok: false, reason: "not configured" };
  try {
    const bearer = await accessToken();
    return bearer ? { ok: true } : { ok: false, reason: "no token returned" };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}

// A quiet notice to the OWNER's phone — backups stale, a silent truck, a
// failed self-test. Deliberately NOT the dispatch channel: a disk warning
// must never sound like a call. With no channel_id, Firebase's own fallback
// channel displays it as an ordinary notification.
// A notice, not a dispatch — and it must not sound like one on either
// platform. No channel id on Android, and on iOS the ordinary "active"
// interruption level rather than time-sensitive: a disk warning has no
// business breaking through somebody's Focus at three in the morning.
function ownerMessage(token, { title, body }) {
  const heading = String(title || "PulseOps");
  const line = String(body || "");
  return {
    message: {
      token,
      android: {
        priority: "HIGH",
        notification: { title: heading, body: line, tag: "system-notice" },
      },
      apns: {
        headers: { "apns-priority": "10", "apns-push-type": "alert", "apns-collapse-id": "system-notice" },
        payload: { aps: { alert: { title: heading, body: line }, sound: "default", "interruption-level": "active" } },
      },
      data: { kind: "system-notice" },
    },
  };
}

async function sendOwnerNotice(token, { title, body }) {
  const sa = serviceAccount();
  if (!sa) return { ok: false, dead: false };
  const bearer = await accessToken();
  if (!bearer) return { ok: false, dead: false };
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify(ownerMessage(token, { title, body })),
    }
  );
  if (res.ok) return { ok: true, dead: false };
  return { ok: false, dead: res.status === 404 };
}

module.exports = { pushConfigured, sendCallAlert, pushProbe, sendOwnerNotice,
  callMessage,
  ownerMessage,
  pushSound,
};
