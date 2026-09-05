import { otHoursStr } from "../domain/messages.jsx";
import { PRODUCTIVITY_MAX_HOURS, myProductivityRows, productivityDayLabel, productivityProblem, productivityRows, productivityStatusLabel, sendProductivityAsk, withdrawProductivityAsk } from "../domain/productivity.jsx";
import { statRangeWindow } from "../domain/stat-range.jsx";
import { statsLog, statsRequests } from "../domain/stat-source.jsx";
import { useMemo, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { staffStatsFor } from "./Statistics.jsx";

// ---------- the crew's productivity request ----------
//
// The department's "Administrative task form", on the person's own screen,
// beside their UHU square: what the task was, how many hours, sent. The ID is
// the signed-in account and the day is today — the form's own rule is that it
// is filed the same day, so there is nothing to type for either. Administration
// approves it on the Teams page, and an approved request is in the UHU figure
// printed at the top of this banner from the next slow poll.
//
// Quiet, like the SYSTEM chip: the figure, one button, and the person's own
// requests this month with what was decided about each. No explanation — the
// title and the two fields are the explanation.
export function ProductivityBanner({ user, units, requests, log, submissions, archives, productivityAsks, setProductivityAsks, productivity, addLog }) {
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState("");
  const [hours, setHours] = useState("");
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  // The person's own UHU this month, counted exactly as the statistics count
  // it — board plus archive, approved requests included — so the figure here
  // and the figure on the administrator's page can never disagree. Memoised
  // on its inputs: the board changes every three seconds and this is a
  // month's log walked once.
  const win = useMemo(() => statRangeWindow("month", now), [Math.floor(now / 60000)]);
  const me = useMemo(() => {
    const l = statsLog(log, submissions, win, archives);
    const r = statsRequests(requests, submissions, win, archives);
    const people = staffStatsFor(l, r, units, win, Date.now(), [], productivity);
    const k = String(user.accountId || user.name || "").toUpperCase();
    return people.find((p) => String(p.id || p.name || "").toUpperCase() === k) || null;
  }, [log, requests, submissions, archives, units, productivity, win, user.accountId, user.name]);

  const rows = useMemo(
    () => myProductivityRows(productivityRows(productivityAsks, productivity), user.accountId, user.name)
      .filter((r) => r.at >= win.start && r.at < win.end),
    [productivityAsks, productivity, user.accountId, user.name, win]
  );
  const pending = rows.filter((r) => !r.decision).length;

  async function send() {
    if (busy) return;
    const problem = productivityProblem({ task, hours });
    if (problem) {
      setSaid(problem);
      return;
    }
    setSaid("");
    setBusy(true);
    try {
      const ask = await sendProductivityAsk({
        user, task, hours, asks: productivityAsks, setAsks: setProductivityAsks, addLog,
      });
      if (!ask) {
        setSaid("That could not be sent — no signal to the server. Nothing has changed; try again.");
        return;
      }
      setTask("");
      setHours("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(row) {
    if (busy) return;
    setBusy(true);
    try {
      await withdrawProductivityAsk({ ask: row, asks: productivityAsks, setAsks: setProductivityAsks, decisions: productivity });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-productivity style={styles.prodBanner}>
      <div style={styles.prodBannerHead}>
        <span>PRODUCTIVITY REQUEST</span>
        {pending > 0 && <span style={styles.prodBannerCount}>{pending} waiting</span>}
      </div>
      {/* The number, and the working beside it — calls plus approved tasks
          over the shifts worked — because a percentage that moved without a
          call being run has to be explainable from the screen it is on. */}
      <div style={styles.prodUhuLine}>
        <span style={styles.prodUhuFig}>{me ? `${me.uhu.toFixed(1)}%` : "—"}</span>
        <span style={styles.prodUhuCaption}>
          UHU this month
          {me
            ? ` · ${otHoursStr(me.onCallMs)} on calls${me.productivityMs > 0 ? ` + ${otHoursStr(me.productivityMs)} approved tasks` : ""} over ${me.shiftsWorked} ${me.shiftsWorked === 1 ? "shift" : "shifts"}`
            : " · no shift worked yet"}
        </span>
      </div>

      {!open ? (
        <button type="button" style={styles.primaryBtnSm} onClick={() => setOpen(true)}>
          New request
        </button>
      ) : (
        <div style={styles.prodForm}>
          <label style={styles.otReasonLabel}>TASK APPROVED BY THE SUPERVISOR</label>
          <textarea
            style={styles.otReasonInput}
            rows={2}
            value={task}
            onChange={(e) => { setTask(e.target.value); if (said) setSaid(""); }}
          />
          <label style={styles.otReasonLabel}>HOURS</label>
          <input
            style={styles.prodHours}
            type="number"
            inputMode="decimal"
            min="0.25"
            max={PRODUCTIVITY_MAX_HOURS}
            step="0.25"
            value={hours}
            onChange={(e) => { setHours(e.target.value); if (said) setSaid(""); }}
          />
          {said && <span style={styles.otReasonProblem}>{said}</span>}
          <div style={styles.otCardBtns}>
            <button type="button" style={styles.primaryBtnSm} onClick={send} disabled={busy}>
              {busy ? "Sending…" : "Send to administration"}
            </button>
            <button type="button" style={styles.ghostBtnSm} onClick={() => { setOpen(false); setSaid(""); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div style={styles.prodList}>
          {rows.map((r) => (
            <div key={r.id} style={styles.prodRow}>
              <div style={styles.prodRowTop}>
                <span style={styles.prodRowDay}>{productivityDayLabel(r)}</span>
                <span style={styles.prodRowHours}>
                  {r.decision && r.decision.status === "approved" && r.decision.approvedMs < r.ms
                    ? `${otHoursStr(r.decision.approvedMs)} of ${otHoursStr(r.ms)}`
                    : otHoursStr(r.ms)}
                </span>
                <span
                  style={{
                    ...styles.prodRowStatus,
                    color: !r.decision ? "var(--hold-2)" : r.decision.status === "declined" ? "var(--ink-4)" : "var(--ok)",
                  }}
                >
                  {productivityStatusLabel(r)}
                </span>
              </div>
              <div style={styles.prodRowTask}>{r.task}</div>
              {r.decision && r.decision.note && <div style={styles.otCardNote}>“{r.decision.note}”</div>}
              {r.decision && r.decision.decidedBy && (
                <div style={styles.otCardBy}>{r.decision.decidedBy}</div>
              )}
              {!r.decision && (
                <button type="button" style={{ ...styles.ghostBtnSm, alignSelf: "flex-start" }} onClick={() => withdraw(r)} disabled={busy}>
                  Withdraw
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
