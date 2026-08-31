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
async function sendCallAlert(token, { title, body, data, channelId }) {
  const sa = serviceAccount();
  if (!sa) return { ok: false, dead: false };
  const bearer = await accessToken();
  if (!bearer) return { ok: false, dead: false };
  const message = {
    message: {
      token,
      android: {
        priority: "HIGH",
        notification: {
          title: String(title || "NEW CALL"),
          body: String(body || ""),
          channel_id: String(channelId || "pulseops_dispatch_v2"),
          // One tag, so a second push replaces the banner instead of stacking.
          tag: "dispatch-call",
        },
      },
      data: Object.fromEntries(
        Object.entries(data || {}).map(([k, v]) => [String(k), String(v)])
      ),
    },
  };
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

module.exports = { pushConfigured, sendCallAlert };
