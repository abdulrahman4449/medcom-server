import { uid } from "../lib/helpers.jsx";
import { readKey, writeKey, writeList } from "../lib/offline-queue.jsx";

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

export function pendingResets(list) {
  return (Array.isArray(list) ? list : []).filter((r) => r && r.status === "pending");
}

export function resetAlreadyOpen(list, accountId) {
  const id = String(accountId || "").toUpperCase();
  return pendingResets(list).some((r) => String(r.accountId || "").toUpperCase() === id);
}

export async function requestPasswordReset(account) {
  if (!account || !account.id) return false;
  const existing = (await readKey(PWRESET_KEY, [])) || [];
  // Asking twice is not two requests. A crew member who taps it again because
  // nothing visibly happened should not fill an administrator's page.
  if (resetAlreadyOpen(existing, account.id)) return "already";
  const entry = {
    id: uid("pwr"),
    ts: Date.now(),
    accountId: account.id,
    name: account.name || "",
    role: account.role || "",
    status: "pending",
  };
  const next = [entry, ...existing].slice(0, PWRESET_CAP);
  const ok = await writeList(PWRESET_KEY, next, existing);
  return ok ? next : false;
}

// Clearing it. The account stays; only the password goes, and the next sign-in
// walks them through choosing a new one.
export async function clearPasswordFor(accountId) {
  const accts = (await readKey("ems:accounts", [])) || [];
  const next = accts.map((a) =>
    a && a.id === accountId ? { ...a, passwordHash: null } : a
  );
  return await writeKey("ems:accounts", next);
}

export async function decideReset(row, status, by) {
  const existing = (await readKey(PWRESET_KEY, [])) || [];
  const next = existing.map((r) =>
    r && r.id === row.id
      ? { ...r, status, decidedBy: by || "Administration", decidedAt: Date.now() }
      : r
  );
  await writeList(PWRESET_KEY, next, existing);
  return next;
}