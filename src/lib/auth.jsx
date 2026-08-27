import { API_BASE } from "./board-api.jsx";

// ---------- the token this device is signed in with ----------
//
// The password is checked on the server now, not here. What the app holds
// afterwards is a signed token saying who this device is and what role it
// holds, and every board request carries it. Nothing on the device can forge
// one: it is signed with a key only the server has.
//
// It sits beside the session, in localStorage, so a tablet that reloads itself
// after being locked does not drop the crew back to the sign-in screen.
export const TOKEN_KEY = "ems:token";

let token = null;
try {
  token = window.localStorage.getItem(TOKEN_KEY) || null;
} catch (e) {
  token = null; // private browsing: the token lives for this page only
}

export function getToken() {
  return token;
}

export function setToken(next) {
  token = next || null;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    // held in memory only
  }
}

export function clearToken() {
  setToken(null);
}

export function authHeaders(extra) {
  return token ? { ...(extra || {}), Authorization: `Bearer ${token}` } : { ...(extra || {}) };
}

// Anything that notices the server no longer accepts this token says so here,
// and the app signs the device out rather than sitting on a board that quietly
// stopped updating.
export const authListeners = new Set();
export function onAuthLost(fn) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}
export function noteAuthLost() {
  // Nothing was lost if this device was never signed in. Before anyone signs
  // in the board answers 401 to every poll, and treating that as "you have
  // been signed out" would fire on a loop at the sign-in screen.
  if (!token) return;
  clearToken();
  authListeners.forEach((fn) => {
    try { fn(); } catch (e) { /* a listener that throws must not stop the rest */ }
  });
}

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* an empty or non-JSON body */ }
  if (!res.ok) {
    const err = new Error(data.error || `The server answered ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Does this employee ID exist, and has a password been chosen for it? Asked
// before the password is, because signing in has always been two steps and
// somebody signing in for the first time is offered "choose a password".
export function lookupAccount(id) {
  return post("/api/auth/lookup", { id });
}

export async function signIn(id, password) {
  const data = await post("/api/auth/login", { id, password });
  setToken(data.token);
  return data.account;
}

// Claiming an account for the first time. The one-time code an administrator
// issued goes up with the password: an employee ID on its own is printed on a
// badge, and on its own it used to be enough to become that person.
export async function choosePassword(id, password, code) {
  const data = await post("/api/auth/set-password", { id, password, code });
  setToken(data.token);
  return data.account;
}

// Stepping into a role an administrator lent them.
//
// The token is issued when the password is checked, before anybody has been
// asked which hat they are wearing, so choosing one re-issues it. The server
// re-checks the delegation both here and on every request afterwards — this
// call cannot grant anything the account does not already hold.
export async function actAsRole(role) {
  const data = await post("/api/auth/act", { role });
  setToken(data.token);
  // The areas come back with the token, so the app draws the part of the job
  // they were actually given rather than the whole of it with everything
  // refused underneath.
  return { account: data.account, scopes: data.scopes || [] };
}

// Lending named areas of an administrator's job to somebody who does not have
// it. It stands until it is taken back — an empty list is taking it back.
export function delegateAuthority(id, scopes) {
  return post(`/api/accounts/${encodeURIComponent(id)}/delegate`, { scopes: scopes || [] });
}

// An administrator hands one out. The plain code comes back once, here, and is
// never retrievable again — only its hash is kept, exactly like a password.
export function issueClaimCode(id) {
  return post(`/api/accounts/${encodeURIComponent(id)}/claim-code`, {});
}

// Signs in without keeping the token - used to check a second crew member's
// password on a shared device, where the seat is theirs but the device stays
// signed in as whoever holds it.
export async function verifyPassword(id, password) {
  const keep = getToken();
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password }),
    });
    if (!res.ok) return false;
    await res.json();
    return true;
  } catch (e) {
    return false;
  } finally {
    setToken(keep);
  }
}

export function requestPasswordHelp(id, name) {
  return post("/api/auth/forgot", { id, name });
}

// ---------- the roster, for an administrator ----------

export async function listAccounts() {
  const res = await fetch(`${API_BASE}/api/accounts`, { headers: authHeaders() });
  if (res.status === 401) { noteAuthLost(); return []; }
  if (!res.ok) return [];
  const data = await res.json();
  return data.accounts || [];
}

export function saveAccount(account) {
  return post("/api/accounts", account);
}

export async function removeAccount(id) {
  const res = await fetch(`${API_BASE}/api/accounts/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch (e) {}
    throw new Error(data.error || "Could not remove that account.");
  }
  return true;
}

// How a forgotten password is dealt with: the password is cleared and the
// person chooses a new one at their next sign-in. Nobody, not even an
// administrator, can set one on somebody else's behalf.
export function clearAccountPassword(id) {
  return post(`/api/accounts/${encodeURIComponent(id)}/clear-password`, {});
}
