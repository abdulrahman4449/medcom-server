import { ADMIN_AREAS, DELEGATION_AREAS, areaLabel, areaSentence } from "../domain/delegation.jsx";
import { delegateAuthority } from "../lib/auth.jsx";
import { useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { FoldingSection, ROLE_LABELS, SectionBanner } from "./AdminView.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";

// ---------- delegated authority ----------
//
// An administrator is one person and a department runs around the clock. The
// thing people actually did about that was sign in on the administrator's own
// ID, which put the wrong name on every line of the night's log and left no
// record of who had really been standing there.
//
// So authority is lent — but one AREA at a time, not the whole job. "Cover the
// overtime while I am away" should not also hand over the accounts, the policy
// shelf and the ability to put the board back from a backup. The person is
// given exactly the areas they are named for, works under their own name, and
// the shift log records which hat they were wearing.
//
// It stands until it is taken back. There is no clock on it: an expiry that
// runs out in the middle of a night shift takes somebody's authority away at
// the moment they are using it. Taking it back is immediate — every request the
// borrower makes is re-checked against the account — so revocation is the
// control, and it is a real one.

export function delegationOf(account) {
  const d = account && account.delegation;
  if (!d || !Array.isArray(d.scopes) || !d.scopes.length) return null;
  if (d.until && Date.now() > d.until) return null;
  return d;
}

export function DelegatedAuthority({ accounts, user, addLog, refreshAccounts }) {
  const [open, setOpen] = useState(false);
  const [pickFor, setPickFor] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Everybody who could be lent something: not the administrator doing the
  // lending, and not somebody who already holds the whole job.
  const candidates = (accounts || []).filter(
    (a) => a && a.id !== (user && user.accountId) && a.role !== "admin"
  );
  const live = candidates.filter(delegationOf);

  function toggle(key) {
    setChosen((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
    setError("");
  }

  function startFor(account) {
    const held = delegationOf(account);
    setPickFor(account.id);
    setChosen(held ? held.scopes.slice() : []);
    setError("");
  }

  async function grant(account) {
    if (!chosen.length) {
      setError("Tick at least one area, or use Take it back.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await delegateAuthority(account.id, chosen);
      await addLog(
        `${(user && user.name) || "Administration"} delegated ${areaSentence(chosen)} to ` +
          `${account.name || account.id} — until it is taken back`,
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
        `Take back ${areaSentence(d.scopes)} from ${account.name || account.id}?\n\n` +
          `It stops at their very next action — they do not have to sign out for it to end.`
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await delegateAuthority(account.id, []);
      await addLog(
        `${(user && user.name) || "Administration"} took back ${areaSentence(d.scopes)} ` +
          `from ${account.name || account.id}`,
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

  // The tick list, shown against whichever person is being set up.
  function areaPicker(account) {
    return (
      <div style={styles.areaPicker}>
        <div style={styles.areaPickerHead}>
          What may {account.name || account.id} work on?
        </div>
        {DELEGATION_AREAS.map((a) => {
          const on = chosen.includes(a.key);
          // Somebody who already works the desk gains nothing from being lent it.
          const pointless = a.key === "dispatch" && account.role === "dispatcher";
          return (
            <button
              key={a.key}
              style={on ? styles.areaRowOn : styles.areaRow}
              disabled={pointless}
              onClick={() => toggle(a.key)}
            >
              <span style={styles.areaTick}>{on ? "✓" : pointless ? "—" : ""}</span>
              <span style={styles.areaWords}>
                <span style={styles.areaLabel}>{a.label}</span>
                <span style={styles.areaSub}>
                  {pointless ? "They already work the desk" : a.sub}
                </span>
              </span>
            </button>
          );
        })}
        {error && <div style={styles.loginError}>{error}</div>}
        <div style={styles.backupActions}>
          <button style={styles.primaryBtnSm} disabled={busy} onClick={() => grant(account)}>
            {busy ? "Saving…" : chosen.length ? `Delegate ${chosen.length}` : "Tick what they may do"}
          </button>
          {delegationOf(account) && (
            <button style={styles.dangerBtnSm} disabled={busy} onClick={() => revoke(account)}>
              Take it back
            </button>
          )}
          <button style={styles.ghostBtnSm} onClick={() => { setPickFor(null); setError(""); }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <FoldingSection
      title="DELEGATED AUTHORITY"
      count={live.length}
      countLabel={live.length === 1 ? "person holds one" : "people hold one"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <InfoNote label="What this does">
        Lends named parts of an administrator's job — the overtime, the archive, the roster, the
        dispatch desk — to somebody who does not have it. They keep their own job: at sign-in they
        choose between it and the borrowed one, and the shift log records which they took.
        <br />
        <br />
        It stands <strong>until you take it back</strong>, which stops them at their very next
        action rather than when they next sign out. A delegate can never lend it on, and can never
        widen their own.
      </InfoNote>

      {error && !pickFor && <div style={styles.loginError}>{error}</div>}

      {live.length > 0 && (
        <>
          <SectionBanner title="IN FORCE NOW" count={live.length} />
          {live.map((a) => {
            const d = delegationOf(a);
            return (
              <div key={a.id}>
                <div style={styles.accountRow}>
                  <span style={styles.accountRowName}>{a.name || a.id}</span>
                  <span style={styles.accountRowMeta}>
                    {ROLE_LABELS[a.role] || a.role} · {a.id}
                  </span>
                  <span style={styles.delegatedTag}>{areaSentence(d.scopes).toUpperCase()}</span>
                  <button style={styles.ghostBtnSm} disabled={busy} onClick={() => startFor(a)}>
                    Change
                  </button>
                  <button style={styles.ghostBtnSm} disabled={busy} onClick={() => revoke(a)}>
                    Take it back
                  </button>
                </div>
                {pickFor === a.id && areaPicker(a)}
              </div>
            );
          })}
        </>
      )}

      <SectionBanner title="EVERYBODY ELSE" count={candidates.filter((a) => !delegationOf(a)).length} />
      {candidates.filter((a) => !delegationOf(a)).length === 0 ? (
        <div style={styles.emptyState}>
          There is nobody else on the roster to delegate to yet.
        </div>
      ) : (
        candidates
          .filter((a) => !delegationOf(a))
          .map((a) => (
            <div key={a.id}>
              <div style={styles.accountRow}>
                <span style={styles.accountRowName}>{a.name || a.id}</span>
                <span style={styles.accountRowMeta}>
                  {ROLE_LABELS[a.role] || a.role} · {a.id}
                </span>
                <button style={styles.ghostBtnSm} disabled={busy} onClick={() => startFor(a)}>
                  Delegate
                </button>
              </div>
              {pickFor === a.id && areaPicker(a)}
            </div>
          ))
      )}
    </FoldingSection>
  );
}
