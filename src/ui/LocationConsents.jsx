import { TRACKING_CONSENT_KEY } from "../domain/truck-locations.jsx";
import { gregDateTimeStr } from "../lib/dates.jsx";
import { mergeWrite, writeKey } from "../lib/offline-queue.jsx";
import { useEffect, useRef, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { FoldingSection } from "./AdminView.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";
import { clearPasswordFor, decideReset, pendingResets } from "./PasswordResets.jsx";

// ---------- who has said what about being located ----------
//
// The department asked that a refusal carry a reason and that an administrator
// see it. This is where they see it. Acknowledging is a record that somebody
// read it — it does not switch tracking on, and there is deliberately no
// control here that would: a refusal that a supervisor can overrule is not a
// refusal, and an app that keeps locating somebody who said no is the thing
// this whole feature must never turn into.
// ---------- people who cannot get in ----------
//
// Somebody is standing at a tablet at handover unable to sign on. That is the
// urgency this panel has, so it opens itself when there is anything in it and
// the action is one button.
//
// Clearing a password does not delete anything. The account keeps its ID, its
// name, its shifts, its overtime and every call on its record; only the
// password goes, and the next sign-in walks them through choosing a new one.
export function PasswordResets({ resets, setResets, user, addLog, onIssued }) {
  const pending = pendingResets(resets);
  // Open when somebody is locked out, folded away when nobody is.
  //
  // It used to open always, which put the whole history of cleared passwords on
  // the page permanently — a list nobody needs at a glance sitting above the
  // things they do. Now the section carries it: nothing waiting, nothing on
  // screen; open it and the requests and what was recently handled are both
  // inside.
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  // The list arrives on the slow poll, so "open it if there is anything in it"
  // cannot be decided on the first render — at that point there is nothing.
  // Opening on the transition instead means a request that lands while an
  // administrator is looking at the page opens the section under them.
  const seenPending = useRef(0);
  useEffect(() => {
    if (pending.length > seenPending.current) setOpen(true);
    seenPending.current = pending.length;
  }, [pending.length]);
  const recent = (() => {
    const done = (Array.isArray(resets) ? resets : [])
      // "open" is an older build's word for pending — still waiting, not handled.
      .filter((r) => r && r.status !== "pending" && r.status !== "open");
    // One row per person here too. Deciding a request settles every duplicate
    // row the old vocabulary split left behind — all stamped in the same
    // second — and eight copies of one person would crowd everyone else out
    // of an eight-row list.
    const byAccount = new Map();
    for (const r of done) {
      const k = String(r.accountId || "").toUpperCase();
      const seen = byAccount.get(k);
      if (!seen || (r.decidedAt || 0) > (seen.decidedAt || 0)) byAccount.set(k, r);
    }
    return [...byAccount.values()]
      .sort((a, b) => (b.decidedAt || 0) - (a.decidedAt || 0))
      .slice(0, 8);
  })();

  async function clearIt(row) {
    if (
      !window.confirm(
        `Clear the password for ${row.name || row.accountId} (${row.accountId})?\n\n` +
          `Nothing else changes: their account, their shifts, their overtime and every call on ` +
          `their record stay exactly as they are. The next time they sign in with this ID they ` +
          `will be asked to choose a new password.\n\n` +
          `Only do this if you know who is asking.`
      )
    )
      return;
    setBusy(row.id);
    try {
      const ok = await clearPasswordFor(row.accountId);
      // A false answer has already told the administrator why, in the
      // server's own words — a refusal (the owner's account, say) and a lost
      // signal need different sentences, and clearPasswordFor said the right
      // one. A second alert here claimed "no signal" over a 403.
      if (!ok) return;
      if (ok && ok.code) {
        // Through the same banner the roster uses, not an alert.
        //
        // It was an alert, on the reasoning that the administrator is standing
        // next to the person who needs it. Often they are not — the request
        // came in from another station — and there is no copying anything out
        // of an alert on a phone, so the code was read once and lost. The
        // banner carries a message ready to send.
        onIssued([{
          id: row.accountId,
          name: row.name,
          role: row.role,
          code: ok.code,
          expiresAt: ok.expiresAt || null,
        }]);
      }
      setResets(await decideReset(row, "cleared", user && user.name));
      await addLog(
        `Password cleared for ${row.name || row.accountId} (${row.accountId}) — they choose a new ` +
          `one at their next sign-in. Account and record untouched.`,
        "admin"
      );
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(row) {
    if (!window.confirm(`Dismiss the request from ${row.name || row.accountId}?\n\nTheir password is not changed.`))
      return;
    setBusy(row.id);
    try {
      setResets(await decideReset(row, "declined", user && user.name));
      await addLog(
        `Password reset request from ${row.name || row.accountId} (${row.accountId}) dismissed.`,
        "admin"
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <FoldingSection
      title="PASSWORD HELP"
      count={pending.length}
      countLabel={pending.length ? "waiting on you" : "nothing waiting"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <InfoNote label="What this does">
        Clearing a password deletes nothing. The account keeps its ID, its name and every shift,
        hour and call on its record — only the password goes, and the person chooses a new one the
        next time they sign in. Check who is asking before you clear it.
      </InfoNote>

      {pending.length === 0 ? (
        <div style={styles.formHint}>Nobody is locked out.</div>
      ) : (
        <div style={styles.resetList}>
          {pending.map((r) => (
            <div key={r.id} style={styles.resetRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.resetName}>
                  {r.name || "—"} <span style={styles.resetId}>{r.accountId}</span>
                </div>
                <div style={styles.resetWhen}>
                  {(r.role || "crew").toUpperCase()} · asked {gregDateTimeStr(r.ts)}
                </div>
              </div>
              <button
                style={styles.primaryBtnSm}
                disabled={busy === r.id}
                onClick={() => clearIt(r)}
              >
                {busy === r.id ? "…" : "Clear password"}
              </button>
              <button style={styles.ghostBtnSm} disabled={busy === r.id} onClick={() => dismiss(r)}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div style={styles.invMovesWrap}>
          <div style={styles.invShortHead}>RECENTLY HANDLED</div>
          {recent.map((r) => (
            <div key={r.id} style={styles.invMoveRow}>
              <span style={styles.invMoveItem}>{r.name || r.accountId}</span>
              <span style={styles.invMoveWho}>
                {r.status === "cleared" ? "password cleared" : "dismissed"}
                {r.decidedBy ? ` by ${r.decidedBy}` : ""}
              </span>
              <span style={styles.invMoveWhen}>
                {r.decidedAt ? gregDateTimeStr(r.decidedAt) : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </FoldingSection>
  );
}

export function TrackingConsentAdmin({ consents, user, setConsents, addLog }) {
  const [open, setOpen] = useState(false);
  const rows = Object.values(consents || {}).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const refused = rows.filter((r) => r.status === "refused");
  const unread = refused.filter((r) => !r.ackedAt);

  async function acknowledge(row) {
    const key = String(row.accountId || "").toUpperCase();
    if (!key) return;
    const next = {
      ...(consents || {}),
      [key]: {
        ...row,
        ackedBy: (user && user.name) || "Administration",
        ackedAt: Date.now(),
      },
    };
    const ok = await mergeWrite(TRACKING_CONSENT_KEY, next, consents || {});
    if (!ok) {
      window.alert("That could not be saved — no signal to the server. Try again.");
      return;
    }
    setConsents(next);
    await addLog(
      `Location refusal from ${row.name || row.accountId} acknowledged by ${(user && user.name) || "Administration"}`,
      "status"
    );
  }

  return (
    <FoldingSection
      title="LOCATION CONSENT"
      count={unread.length}
      countLabel={unread.length ? "refusals to read" : "nothing waiting"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <InfoNote label="What this is">
        Everyone who has been asked to share their truck's position while on a call, and what they
        answered. A refusal takes effect immediately — acknowledging it records that it was read,
        and nothing here turns tracking back on. Anyone who declined is asked again on their next
        call.
      </InfoNote>

      {rows.length === 0 ? (
        <div style={styles.formHint}>Nobody has been asked yet.</div>
      ) : (
        <div style={styles.consentList}>
          {rows.map((r) => (
            <div key={r.accountId} style={styles.consentRow}>
              <div style={styles.consentRowHead}>
                <span style={styles.consentRowName}>{r.name || "Unnamed"}</span>
                <span style={styles.consentRowId}>{r.accountId}</span>
                <span
                  style={{
                    ...styles.consentRowStatus,
                    color: r.status === "granted" ? "var(--ok)" : "var(--hold)",
                  }}
                >
                  {r.status === "granted" ? "SHARING" : "DECLINED"}
                </span>
              </div>
              <div style={styles.consentRowWhen}>{gregDateTimeStr(r.ts)}</div>
              {r.status === "refused" && r.reason && (
                <div style={styles.consentRowReason}>“{r.reason}”</div>
              )}
              {r.status === "refused" &&
                (r.ackedAt ? (
                  <div style={styles.consentRowAcked}>
                    Read by {r.ackedBy} · {gregDateTimeStr(r.ackedAt)}
                  </div>
                ) : (
                  <button style={styles.ghostBtnSm} onClick={() => acknowledge(r)}>
                    Acknowledge
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </FoldingSection>
  );
}