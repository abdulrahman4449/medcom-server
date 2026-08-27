import { delegateAuthority } from "../lib/auth.jsx";
import { gregDateStr } from "../lib/dates.jsx";
import { useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { FoldingSection, ROLE_LABELS } from "./AdminView.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";

// ---------- delegated authority ----------
//
// An administrator is one person and a department runs around the clock. The
// thing people actually did about that was sign in on the administrator's own
// ID, which put the wrong name on every line of the night's log and left no
// record of who had really been standing there.
//
// So authority is lent instead: a named person, a named role, a number of days,
// under their own name. They are offered the choice at sign-in — their own job
// or the borrowed one — and the shift log records which they took.
//
// The permission itself is the server's. This screen only asks for it; every
// request the borrower then makes is re-checked against the account, so taking
// a delegation back takes effect on the next request rather than whenever their
// token happens to expire.

const DELEGABLE = [
  { key: "admin", label: "Administrator", sub: "Statistics, accounts, policies, checklists, inventory" },
  { key: "dispatcher", label: "Dispatcher", sub: "The dispatch desk — raising and assigning calls" },
];

export function delegationOf(account) {
  const d = account && account.delegation;
  if (!d || !d.role) return null;
  if (d.until && Date.now() > d.until) return null;
  return d;
}

export function DelegatedAuthority({ accounts, user, addLog, refreshAccounts }) {
  const [open, setOpen] = useState(false);
  const [pickFor, setPickFor] = useState(null);
  const [role, setRole] = useState("dispatcher");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Everybody who could be lent something: not the administrator doing the
  // lending, and not somebody who already holds the role being lent.
  const candidates = (accounts || []).filter((a) => a && a.id !== (user && user.accountId));
  const live = candidates.filter(delegationOf);

  async function grant(account) {
    const n = Number(days);
    if (!Number.isFinite(n) || n < 1 || n > 90) {
      setError("Give a number of days between 1 and 90.");
      return;
    }
    if (role === account.role) {
      setError(`${account.name || account.id} already works as a ${ROLE_LABELS[account.role] || account.role}.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await delegateAuthority(account.id, role, Math.round(n));
      await addLog(
        `${(user && user.name) || "Administration"} delegated ${ROLE_LABELS[role] || role} authority to ` +
          `${account.name || account.id} for ${Math.round(n)} day${Math.round(n) === 1 ? "" : "s"}`,
        "status"
      );
      setPickFor(null);
      if (refreshAccounts) await refreshAccounts();
    } catch (e) {
      setError((e && e.message) || "That could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(account) {
    const d = delegationOf(account);
    if (!d) return;
    if (
      !window.confirm(
        `Take back ${ROLE_LABELS[d.role] || d.role} authority from ${account.name || account.id}?\n\n` +
          `It stops at their very next action — they do not have to sign out for it to end.`
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await delegateAuthority(account.id, null);
      await addLog(
        `${(user && user.name) || "Administration"} took back ${ROLE_LABELS[d.role] || d.role} ` +
          `authority from ${account.name || account.id}`,
        "status"
      );
      if (refreshAccounts) await refreshAccounts();
    } catch (e) {
      setError((e && e.message) || "That could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FoldingSection
      title="DELEGATED AUTHORITY"
      count={live.length}
      countLabel={live.length === 1 ? "person holds one" : "in force"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <InfoNote label="What this does">
        Lends part of an administrator's standing to somebody who does not have it, for a set
        number of days. They keep their own job: at sign-in they choose between it and the
        borrowed one, and the shift log records which they took. Take it back at any time — it
        stops at their next action, not when they next sign out.
      </InfoNote>

      {error && <div style={styles.loginError}>{error}</div>}

      {live.length > 0 && (
        <div style={styles.accountList}>
          {live.map((a) => {
            const d = delegationOf(a);
            return (
              <div key={a.id} style={styles.accountRow}>
                <span style={styles.accountRowName}>{a.name || a.id}</span>
                <span style={styles.accountRowMeta}>
                  {ROLE_LABELS[a.role] || a.role} · {a.id}
                </span>
                <span style={styles.delegatedTag}>
                  {ROLE_LABELS[d.role] || d.role} until {gregDateStr(d.until)}
                </span>
                <button style={styles.ghostBtnSm} disabled={busy} onClick={() => revoke(a)}>
                  Take it back
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={styles.accountList}>
        {candidates
          .filter((a) => !delegationOf(a))
          .map((a) => (
            <div key={a.id} style={styles.accountRow}>
              <span style={styles.accountRowName}>{a.name || a.id}</span>
              <span style={styles.accountRowMeta}>
                {ROLE_LABELS[a.role] || a.role} · {a.id}
              </span>
              {pickFor === a.id ? (
                <span style={styles.delegateForm}>
                  <select style={styles.assignSelect} value={role} onChange={(e) => setRole(e.target.value)}>
                    {DELEGABLE.filter((r) => r.key !== a.role).map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <input
                    style={styles.delegateDays}
                    value={days}
                    inputMode="numeric"
                    onChange={(e) => setDays(e.target.value)}
                    placeholder="days"
                  />
                  <button style={styles.primaryBtnSm} disabled={busy} onClick={() => grant(a)}>
                    {busy ? "Saving…" : "Delegate"}
                  </button>
                  <button style={styles.ghostBtnSm} onClick={() => { setPickFor(null); setError(""); }}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  style={styles.ghostBtnSm}
                  onClick={() => {
                    setPickFor(a.id);
                    setRole(a.role === "dispatcher" ? "admin" : "dispatcher");
                    setDays("7");
                    setError("");
                  }}
                >
                  Delegate
                </button>
              )}
            </div>
          ))}
      </div>

      {candidates.length === 0 && (
        <div style={styles.emptyState}>
          There is nobody else on the roster to delegate to yet.
        </div>
      )}
    </FoldingSection>
  );
}
