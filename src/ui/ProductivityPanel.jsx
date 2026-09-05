import { stationLabel } from "../domain/live-sheet.jsx";
import { otHoursStr } from "../domain/messages.jsx";
import { PRODUCTIVITY_KEY, productivityDayLabel, productivityDecision, productivityDeclineProblem, productivityInWindow, productivityRows, productivityStatusLabel } from "../domain/productivity.jsx";
import { gregDateStr, gregDateTimeStr } from "../lib/dates.jsx";
import { writeKey } from "../lib/offline-queue.jsx";
import { useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { FoldingSection } from "./AdminView.jsx";

// ---------- productivity requests, as administration answers them ----------
//
// The Teams page's own section: every request waiting on a decision, whatever
// its date, and then the period's approved ones — the list the department
// keeps of hours counted into UHU that were not calls. Approving is one tap;
// approving part or declining opens the one field it needs INLINE, on the
// card, rather than in a browser dialog that stops the page dead.
function ProdCard({ row, user, onDecide, busy }) {
  // "part" or "decline" — which inline form is open on this card, if any.
  const [mode, setMode] = useState(null);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [said, setSaid] = useState("");
  const dec = row.decision;

  async function confirm() {
    if (mode === "part") {
      const h = Number(hours);
      if (!Number.isFinite(h) || h <= 0) { setSaid("How many hours are approved?"); return; }
      const ms = Math.round(h * 3600000);
      if (ms >= row.ms) { setSaid("That is the whole request — use Approve."); return; }
      await onDecide(row, "approved", ms, note);
    } else {
      const problem = productivityDeclineProblem(note);
      if (problem) { setSaid(problem); return; }
      await onDecide(row, "declined", 0, note);
    }
    setMode(null);
    setSaid("");
  }

  return (
    <div data-prod-card style={dec ? styles.otCard : styles.otCardPending}>
      <div style={styles.otCardHead}>
        <span style={styles.otCardName}>{row.name || "Unnamed"}</span>
        <span style={styles.otCardWho}>
          {row.accountId}
          {row.unitName ? ` · ${row.unitName}` : ""} · {stationLabel(row.station)}
        </span>
        <span
          style={{
            ...styles.otCardStatus,
            color: !dec ? "var(--hold)" : dec.status === "declined" ? "var(--ink-4)" : "var(--ok)",
          }}
        >
          {productivityStatusLabel(row)}
        </span>
      </div>
      <div style={styles.otCardMeta}>
        {productivityDayLabel(row)} · sent {gregDateTimeStr(row.at)}
      </div>
      <div style={styles.otCardFigures}>
        <span style={styles.otClaimed}>{otHoursStr(row.ms)} asked</span>
        {dec && dec.status === "approved" && (
          <span style={styles.otApproved}>{otHoursStr(dec.approvedMs)} approved</span>
        )}
      </div>
      <div style={styles.otCardSaid}>“{row.task}”</div>
      {dec && dec.note && <div style={styles.otCardNote}>“{dec.note}”</div>}
      {dec && dec.decidedBy && (
        <div style={styles.otCardBy}>{dec.decidedBy} · {gregDateTimeStr(dec.decidedAt)}</div>
      )}
      {!dec && !mode && (
        <div style={styles.otCardBtns}>
          <button style={styles.primaryBtnSm} disabled={busy} onClick={() => onDecide(row, "approved", row.ms, "")}>
            Approve {otHoursStr(row.ms)}
          </button>
          <button style={styles.ghostBtnSm} disabled={busy} onClick={() => { setMode("part"); setSaid(""); }}>
            Approve part
          </button>
          <button style={styles.ghostBtnSm} disabled={busy} onClick={() => { setMode("decline"); setSaid(""); }}>
            Decline
          </button>
        </div>
      )}
      {!dec && mode && (
        <div style={styles.prodForm}>
          {mode === "part" && (
            <React.Fragment>
              <label style={styles.otReasonLabel}>HOURS APPROVED</label>
              <input
                style={styles.prodHours}
                type="number"
                inputMode="decimal"
                min="0.25"
                step="0.25"
                value={hours}
                onChange={(e) => { setHours(e.target.value); if (said) setSaid(""); }}
              />
            </React.Fragment>
          )}
          <label style={styles.otReasonLabel}>{mode === "part" ? "NOTE" : "WHY"}</label>
          <textarea
            style={styles.otReasonInput}
            rows={2}
            value={note}
            onChange={(e) => { setNote(e.target.value); if (said) setSaid(""); }}
          />
          {said && <span style={styles.otReasonProblem}>{said}</span>}
          <div style={styles.otCardBtns}>
            <button style={styles.primaryBtnSm} disabled={busy} onClick={confirm}>
              {mode === "part" ? "Approve these hours" : "Decline"}
            </button>
            <button style={styles.ghostBtnSm} disabled={busy} onClick={() => { setMode(null); setSaid(""); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProductivityPanel({ user, asks, decisions, setDecisions, addLog }) {
  const [busy, setBusy] = useState(false);
  const [openDeclined, setOpenDeclined] = useState(false);
  const now = Date.now();
  const localYmd = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const [fromStr, setFromStr] = useState(() => localYmd(now - 29 * 86400000));
  const [toStr, setToStr] = useState(() => localYmd(now));
  const from = new Date(`${fromStr}T00:00:00`).getTime();
  const to = new Date(`${toStr}T00:00:00`).getTime() + 86400000;
  const validRange = Number.isFinite(from) && Number.isFinite(to) && to > from;

  const rows = productivityRows(asks, decisions);
  // Waiting is waiting whatever its date; the decided lists are the period's.
  const pending = rows.filter((r) => !r.decision);
  const inPeriod = validRange ? productivityInWindow(rows, from, to) : [];
  const approved = inPeriod.filter((r) => r.decision && r.decision.status === "approved");
  const declined = inPeriod.filter((r) => r.decision && r.decision.status === "declined");
  const approvedMs = approved.reduce((n, r) => n + (r.decision.approvedMs || 0), 0);

  async function decide(row, status, approvedMs, note) {
    if (busy) return;
    setBusy(true);
    try {
      const d = productivityDecision({ ask: row, status, approvedMs, note, user });
      const next = { ...(decisions || {}), [row.id]: d };
      const ok = await writeKey(PRODUCTIVITY_KEY, next);
      if (!ok) {
        window.alert("That decision could not be saved — no signal to the server. Nothing has changed; try again.");
        return;
      }
      setDecisions(next);
      await addLog(
        `Productivity request ${d.status} for ${row.name} — ${otHoursStr(row.ms)} asked, ` +
          `${d.status === "declined" ? "none" : otHoursStr(d.approvedMs)} approved — ${row.task}` +
          (d.note ? ` · ${d.note}` : ""),
        "status"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <FoldingSection
      title="PRODUCTIVITY REQUESTS"
      count={pending.length}
      countLabel={pending.length ? "awaiting approval" : "all decided"}
      open
      onToggle={() => {}}
    >
      {pending.length > 0 && (
        <div style={styles.otList}>
          {pending.map((r) => (
            <ProdCard key={r.id} row={r} user={user} onDecide={decide} busy={busy} />
          ))}
        </div>
      )}

      <div style={{ ...styles.otRange, marginTop: pending.length ? 14 : 0 }}>
        <label style={styles.otRangeField}>
          <span style={styles.otRangeLabel}>FROM</span>
          <input style={styles.otDate} type="date" lang="en-GB" value={fromStr} onChange={(e) => setFromStr(e.target.value)} />
        </label>
        <label style={styles.otRangeField}>
          <span style={styles.otRangeLabel}>TO</span>
          <input style={styles.otDate} type="date" lang="en-GB" value={toStr} onChange={(e) => setToStr(e.target.value)} />
        </label>
      </div>
      {!validRange && (
        <div style={styles.formHint}>The end of the period has to come after the start.</div>
      )}
      <div style={styles.otTotals}>
        <div style={styles.otTotal}>
          <span style={styles.otTotalFig}>{otHoursStr(approvedMs)}</span>
          <span style={styles.otTotalLabel}>APPROVED — COUNTED INTO UHU</span>
        </div>
        <div style={styles.otTotal}>
          <span style={{ ...styles.otTotalFig, color: pending.length ? "var(--hold)" : "var(--ink-4)" }}>
            {pending.length}
          </span>
          <span style={styles.otTotalLabel}>AWAITING A DECISION</span>
        </div>
      </div>

      <div style={styles.otBlock}>
        <div style={styles.otBlockHead}>
          APPROVED {validRange ? `· ${gregDateStr(from)} → ${gregDateStr(to - 1)}` : ""}
          <span style={styles.otBlockCount}>{approved.length}</span>
        </div>
        <div style={{ ...styles.otList, paddingTop: 8 }}>
          {approved.length === 0 ? (
            <div style={styles.formHint}>No approved requests in this period.</div>
          ) : (
            approved.map((r) => <ProdCard key={r.id} row={r} user={user} onDecide={decide} busy={busy} />)
          )}
        </div>
      </div>

      {declined.length > 0 && (
        <div style={styles.otBlock}>
          <button style={styles.otBlockHead} onClick={() => setOpenDeclined((v) => !v)}>
            <span style={{ ...styles.otBlockCaret, transform: openDeclined ? "rotate(90deg)" : "none" }}>›</span>
            DECLINED
            <span style={styles.otBlockCount}>{declined.length}</span>
          </button>
          {openDeclined && (
            <div style={{ ...styles.otList, paddingTop: 8 }}>
              {declined.map((r) => <ProdCard key={r.id} row={r} user={user} onDecide={decide} busy={busy} />)}
            </div>
          )}
        </div>
      )}
    </FoldingSection>
  );
}
