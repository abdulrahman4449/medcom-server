import { clearAccountPassword, requestPasswordHelp } from "../lib/auth.jsx";
import { readKey, writeList } from "../lib/offline-queue.jsx";

// ---------- forgotten passwords ----------
//
// A crew member who cannot remember their password used to be a deleted account
// and a new one with the same ID — which loses the thing the ID exists to hold.
// Their sign-ons, their overtime, their UHU and every call they ran are keyed to
// the account; recreating it starts all of that again at zero and quietly puts a
// hole in the month's figures.
//
// So nothing is deleted. The person asks, an administrator clears the password,
// and the next time they sign in they choose a new one through the same
// first-login screen that already exists. The account, and everything hanging
// off it, is untouched.
//
// The request is only a request. It carries no authority: it cannot clear a
// password by itself, and an administrator has to look at it and decide. That is
// deliberate — anybody standing at the sign-in screen can type an ID, so this
// asks a person, it does not perform an action.
export const PWRESET_KEY = "ems:passwordResets";
export const PWRESET_CAP = 200;

// A request still waiting for an administrator. "open" is the word an older
// server build wrote for the same thing, so it is honoured here — a request
// recorded under the old word must not be able to hide from the panel.
// ONE ROW PER PERSON: the same account asking twice is still one person locked
// out once, so only the newest request per account is returned — however many
// rows a board accumulated before the two writers agreed on a vocabulary.
export function pendingResets(list) {
  const open = (Array.isArray(list) ? list : []).filter(
    (r) => r && (r.status === "pending" || r.status === "open")
  );
  const byAccount = new Map();
  for (const r of open) {
    const key = String(r.accountId || "").toUpperCase();
    const seen = byAccount.get(key);
    if (!seen || (r.ts || r.at || 0) > (seen.ts || seen.at || 0)) byAccount.set(key, r);
  }
  // Normalised so the panel can read `ts` whichever build wrote the row.
  return [...byAccount.values()].map((r) => (r.ts ? r : { ...r, ts: r.at || 0 }));
}

// Asking goes through the SERVER route, never the board. The person asking
// cannot sign in — that is the whole situation — so a board write from the
// sign-in screen was refused with a 401, sat in this device's offline queue,
// and went up later under whoever signed in next; and the duplicate check
// read the board through the same 401 and saw an empty list every time, so
// asking twice recorded twice. The route needs no token and dedupes on the
// server where the list actually lives. It deliberately does NOT say whether
// a request was already waiting — the route answers strangers, and "this ID
// exists and is mid-reset" is not theirs to learn — so asking twice simply
// reads as sent, which is also the truth: one request is waiting.
export async function requestPasswordReset(account) {
  if (!account || !account.id) return false;
  try {
    const res = await requestPasswordHelp(account.id, account.name || "");
    return !!(res && res.ok);
  } catch (e) {
    // The route's own limiter, distinct from "no signal" — retrying is
    // exactly what will not help.
    if (e && e.status === 429) return "slow";
    return false;
  }
}

// Clearing it. The account stays; only the password goes, and the next sign-in
// walks them through choosing a new one.
export async function clearPasswordFor(accountId) {
  // The server owns passwords now. Clearing is the only thing an administrator
  // can do to one - nobody, including them, can set a password on somebody
  // else's behalf, so a cleared account is one the person themselves has to
  // choose a new password for at the next sign-in.
  try {
    const res = await clearAccountPassword(accountId);
    // The server issues the code that replaces the password in the same call.
    // Without handing it on, the administrator would clear an account and leave
    // the person unable to set a new password and with nothing to say why.
    return (res && res.code) ? { code: res.code, expiresAt: res.expiresAt || null } : true;
  } catch (e) {
    window.alert(e.message || "Could not clear that password.");
    return false;
  }
}

export async function decideReset(row, status, by) {
  const existing = (await readKey(PWRESET_KEY, [])) || [];
  // The decision answers the PERSON, not the row: every request still waiting
  // from the same account is settled by the one press, so a board that
  // accumulated duplicates before the vocabulary fix is cleaned by the first
  // administrator who deals with it.
  const acct = String(row.accountId || "").toUpperCase();
  const settles = (r) =>
    r &&
    (r.id === row.id ||
      ((r.status === "pending" || r.status === "open") &&
        String(r.accountId || "").toUpperCase() === acct));
  const next = existing.map((r) =>
    settles(r) ? { ...r, status, decidedBy: by || "Administration", decidedAt: Date.now() } : r
  );
  const sent = await writeList(PWRESET_KEY, next, existing, { prepend: true, cap: PWRESET_CAP });
  return sent.value || next;
}