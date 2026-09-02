import { stationLabel } from "../domain/live-sheet.jsx";
import { clockStr, otHoursStr } from "../domain/messages.jsx";
import { OVERTIME_KEY, grantWholeShiftOvertime, overtimeApprovedMs, overtimeClaims, overtimeStatusLabel } from "../domain/overtime.jsx";
import { overtimeMs, seatLabel, shiftLabelWithWindow } from "../domain/shift-helpers.jsx";
import { statsLog, statsRequests } from "../domain/stat-source.jsx";
import { gregDateStr, gregDateTimeStr } from "../lib/dates.jsx";
import { writeKey } from "../lib/offline-queue.jsx";
import { useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { FoldingSection } from "./AdminView.jsx";
import { exportOvertime } from "./overtime-sheet.jsx";

// A fold inside a fold. The outer FoldingSection is the panel; this is one
// block within it, and it is deliberately quieter — a row with a caret and a
// count, not a second banner competing with the first.
function OtBlock({ title, count, open, onToggle, children }) {
  return (
    <div style={styles.otBlock}>
      <button style={styles.otBlockHead} onClick={onToggle}>
        <span style={{ ...styles.otBlockCaret, transform: open ? "rotate(90deg)" : "none" }}>›</span>
        {title}
        <span style={styles.otBlockCount}>{count}</span>
      </button>
      {open && <div style={{ paddingTop: 8 }}>{children}</div>}
    </div>
  );
}

// ---------- overtime, as administration answers it ----------
//
// Retractable, and folded by default: this is a weekly job, not something the
// board is watched for. Open, it answers three things in order — what is
// waiting on a decision, who is standing past their shift right now, and what
// the period comes to.
export function OvertimePanel({ log: liveLog, requests: liveRequests, units, user, addLog, decisions, setDecisions, sent, submissions, archives }) {
  const [open, setOpen] = useState(false);
  // Retractable inside as well as outside. Open, this panel ran to three
  // screens on a phone — a date range, three totals, everybody standing past
  // their shift, and every claim in the period — and the thing an
  // administrator actually came for was four rows down the third block. Each
  // part folds on its own now, and the two that need answering open first.
  const [openLive, setOpenLive] = useState(false);
  const [openClaims, setOpenClaims] = useState(true);
  const now = Date.now();
  // A pay period, not a calendar month. Defaults to the last 30 days and is
  // then whatever the administrator types.
  // Local, for the same reason the filename is: a date input takes a local
  // calendar day, and seeding it from a UTC string starts the picker on the
  // wrong day for anyone east of Greenwich.
  const localYmd = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const [fromStr, setFromStr] = useState(() => localYmd(now - 29 * 86400000));
  const [toStr, setToStr] = useState(() => localYmd(now));
  const [busy, setBusy] = useState(false);

  const from = new Date(`${fromStr}T00:00:00`).getTime();
  // Inclusive of the last day: a period "to 18 September" includes the 18th.
  const to = new Date(`${toStr}T00:00:00`).getTime() + 86400000;
  const validRange = Number.isFinite(from) && Number.isFinite(to) && to > from;

  // A pay period is thirty days by default, and the live log is capped at 400
  // lines and pruned four shifts after a shift is filed — so a claim from three
  // weeks ago had simply stopped existing on this panel, hours and all. The
  // filed shift logs still hold the sign-off line it is built from. Same corpus
  // as the statistics, deduplicated by record id, live copy preferred.
  const otWin = validRange ? { start: from, end: to } : null;
  const log = statsLog(liveLog, submissions, otWin, archives);
  const requests = statsRequests(liveRequests, submissions, otWin, archives);
  const claims = validRange ? overtimeClaims(log, requests, from, to, decisions, sent) : [];
  // Waiting on a decision means waiting on *this* desk. A stay the person has
  // not sent in is not waiting on anybody here, and counting it as pending put
  // a number on this panel that no amount of deciding could ever clear.
  const pending = claims.filter((c) => !c.decision && c.submitted);
  const label = validRange
    ? `${gregDateStr(from)} → ${gregDateStr(to - 1)}`
    : "Pick a period";

  // Two figures, and only one of them is money.
  //
  // It used to carry four: approved, awaiting, declined, and hours nobody had
  // claimed. Two of those are not totals — a refusal is not money owed, and
  // hours the person never sent in are not the department's to count — and an
  // administrator opening this panel had to read past both to reach the figure
  // they came for. `declined` is still summed because the claims list below
  // marks each one, and the sum is what proves the approved figure excludes
  // them.
  const totals = claims.reduce(
    (acc, c) => {
      const ms = overtimeApprovedMs(c);
      const dec = c.decision;
      if (ms === null) {
        // Undecided, and only if it has been put in front of anybody.
        if (c.submitted) acc.undecided += c.claimedMs || 0;
      } else if (dec && dec.status === "declined") acc.declined += c.claimedMs || 0;
      else acc.approved += ms;
      return acc;
    },
    { approved: 0, undecided: 0, declined: 0 }
  );

  // Everybody signed on right now who is already past their shift end. This is
  // the live half — the claim does not exist until they sign off, but the
  // administrator should be able to see it building.
  const standing = [];
  (units || []).forEach((u) => {
    ["alpha", "bravo"].forEach((slot) => {
      const seated = u[slot];
      if (!seated) return;
      const over = overtimeMs(seated, now);
      standing.push({ unit: u, slot, member: seated, over });
    });
  });
  standing.sort((a, b) => b.over - a.over);

  async function decide(claim, status, approvedMs, note) {
    const next = {
      ...(decisions || {}),
      [claim.id]: {
        ...(decisions || {})[claim.id],
        status,
        approvedMs: approvedMs === null || approvedMs === undefined ? null : approvedMs,
        decidedBy: (user && user.name) || "Administration",
        decidedAt: Date.now(),
        note: note || "",
        // Carried so a granted whole shift can be rebuilt without the log.
        name: claim.name,
        accountId: claim.accountId,
        unitId: claim.unitId,
        unitName: claim.unitName,
        seat: claim.seat,
        station: claim.station,
        shift: claim.shift,
        shiftStart: claim.shiftStart,
        shiftEnd: claim.shiftEnd,
        claimedMs: claim.claimedMs,
        granted: !!claim.granted,
      },
    };
    const ok = await writeKey(OVERTIME_KEY, next);
    if (!ok) {
      window.alert("That decision could not be saved — no signal to the server. Nothing has changed; try again.");
      return;
    }
    setDecisions(next);
    await addLog(
      `Overtime ${status} for ${claim.name} (${claim.unitName}) — ` +
        `${otHoursStr(claim.claimedMs)} claimed, ` +
        `${status === "declined" ? "none" : otHoursStr(approvedMs || claim.claimedMs)} approved` +
        (note ? ` · ${note}` : ""),
      "status"
    );
  }

  async function approvePartial(claim) {
    const claimedHours = (claim.claimedMs || 0) / 3600000;
    const asked = window.prompt(
      `Approve part of ${claim.name}'s overtime.\n\n` +
        `Claimed: ${otHoursStr(claim.claimedMs)}\n\n` +
        `How many hours are approved? (e.g. 1.5 for an hour and a half)`,
      (Math.round(claimedHours * 100) / 100).toFixed(2)
    );
    if (asked === null) return;
    // A blank or nonsense answer used to fall through `|| 0` and record a
    // DECLINED claim with no reason — around the check that declining a claim
    // needs one. An unreadable answer is not a decision.
    const parsed = Number(String(asked).trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      window.alert("Give the number of hours to approve, or use Decline.");
      return;
    }
    const hours = Math.min(claimedHours, parsed);
    if (Math.round(hours * 3600000) === 0) {
      window.alert("Approving nought hours is a decline — use Decline, which records the reason.");
      return;
    }
    const note = window.prompt("A note, if this needs explaining. Leave blank for none.", "") || "";
    await decide(claim, "partial", Math.round(hours * 3600000), note.trim());
  }

  async function decline(claim) {
    const note = window.prompt(
      `Decline ${claim.name}'s overtime?\n\nSay why — it goes on the record and into the sheet.`
    );
    if (note === null) return;
    if (!note.trim()) {
      window.alert("A declined claim needs a reason.");
      return;
    }
    await decide(claim, "declined", 0, note.trim());
  }

  // The same grant the Teams roster offers, from the panel that shows who is
  // standing past their shift right now. One function behind both.
  async function grantWholeShift(entry) {
    await grantWholeShiftOvertime({
      unit: entry.unit,
      slot: entry.slot,
      member: entry.member,
      user,
      decisions,
      setDecisions,
      addLog,
    });
  }

  async function download() {
    if (!validRange || busy) return;
    setBusy(true);
    try {
      // The period the administrator picked, and only the claims that are
      // actually claims.
      //
      // Hours somebody worked and never sent in are not the department's to
      // pay and are not on this panel any more; putting them on the sheet that
      // goes to payroll would put them back. A decided claim stays on it even
      // when it was refused — a refusal on the record is the point of having
      // one — in its own column, adding to nothing.
      await exportOvertime(
        claims.filter((c) => c.decision || c.submitted),
        from,
        to,
        label
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <FoldingSection
      title="OVERTIME"
      count={pending.length}
      countLabel={pending.length ? "awaiting approval" : "all decided"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {/* The period. */}
      <div style={styles.otRange}>
        <label style={styles.otRangeField}>
          <span style={styles.otRangeLabel}>FROM</span>
          <input style={styles.otDate} type="date" lang="en-GB" value={fromStr} onChange={(e) => setFromStr(e.target.value)} />
        </label>
        <label style={styles.otRangeField}>
          <span style={styles.otRangeLabel}>TO</span>
          <input style={styles.otDate} type="date" lang="en-GB" value={toStr} onChange={(e) => setToStr(e.target.value)} />
        </label>
        <button style={styles.primaryBtnSm} onClick={download} disabled={!validRange || busy}>
          {busy ? "Building…" : "Excel sheet"}
        </button>
      </div>
      {!validRange && (
        <div style={styles.formHint}>The end of the period has to come after the start.</div>
      )}

      <div style={styles.otTotals}>
        <div style={styles.otTotal}>
          <span style={styles.otTotalFig}>{otHoursStr(totals.approved)}</span>
          <span style={styles.otTotalLabel}>APPROVED — THE PERIOD'S TOTAL</span>
        </div>
        <div style={styles.otTotal}>
          <span style={{ ...styles.otTotalFig, color: totals.undecided ? "var(--hold)" : "var(--ink-4)" }}>
            {otHoursStr(totals.undecided)}
          </span>
          <span style={styles.otTotalLabel}>AWAITING A DECISION</span>
        </div>
        {/* Two figures, not four.
            The panel is here to answer one question — what does this period
            come to, and what is still waiting on a decision. A declined claim
            is a refusal, not a total, and hours nobody has claimed are not the
            department's to count; both were figures an administrator had to
            read past to reach the one they came for. The claims themselves are
            still on the record below. */}
      </div>

      {/* Standing past their shift right now. */}
      {standing.filter((x) => x.over > 0).length > 0 && (
        <OtBlock
          title="PAST THEIR SHIFT RIGHT NOW"
          count={standing.filter((x) => x.over > 0).length}
          open={openLive}
          onToggle={() => setOpenLive((v) => !v)}
        >
        <div style={styles.otLiveWrap}>
          {standing
            .filter((x) => x.over > 0)
            .map((x) => (
              <div key={`${x.unit.id}-${x.slot}`} style={styles.otLiveRow}>
                <span style={styles.otLiveName}>{x.member.name}</span>
                <span style={styles.otLiveUnit}>
                  {x.unit.name} · {seatLabel(x.slot)}
                </span>
                <span style={styles.otLiveMs}>{otHoursStr(x.over)}</span>
                <button style={styles.otGrantBtn} onClick={() => grantWholeShift(x)}>
                  Count whole shift
                </button>
              </div>
            ))}
          <div style={styles.otLiveNote}>
            These become claims when they sign off. The button counts the whole tour as overtime —
            for somebody called in on a rest day — and covers the rostered shift only. If the shift
            runs past its twelve hours, the extra arrives here as its own claim and has to be
            approved again; a granted shift is not a blank cheque on the rest of the day. The same
            button is on each seat on the Teams page.
          </div>
        </div>
        </OtBlock>
      )}

      {/* The claims themselves, undecided first. */}
      <OtBlock
        title="CLAIMS IN THIS PERIOD"
        count={pending.length + claims.filter((c) => c.decision).length}
        open={openClaims}
        onToggle={() => setOpenClaims((v) => !v)}
      >
      <div style={styles.otList}>
        {pending.length + claims.filter((c) => c.decision).length === 0 ? (
          <div style={styles.formHint}>
            No overtime in this period. A stay that ran past its shift end appears here on sign-off.
          </div>
        ) : (
          [...pending, ...claims.filter((c) => c.decision)].map((c) => {
            const approved = overtimeApprovedMs(c);
            return (
              <div key={c.id} style={c.decision ? styles.otCard : styles.otCardPending}>
                <div style={styles.otCardHead}>
                  <span style={styles.otCardName}>{c.name || "Unnamed"}</span>
                  <span style={styles.otCardWho}>
                    {c.unitName}
                    {c.seat ? ` · ${seatLabel(c.seat)}` : ""} · {stationLabel(c.station)}
                  </span>
                  <span
                    style={{
                      ...styles.otCardStatus,
                      color: !c.decision
                        ? "var(--hold)"
                        : c.decision.status === "declined"
                        ? "var(--ink-4)"
                        : "var(--ok)",
                    }}
                  >
                    {overtimeStatusLabel(c)}
                  </span>
                </div>
                <div style={styles.otCardMeta}>
                  {c.shiftStart ? gregDateStr(c.shiftStart) : ""} · {shiftLabelWithWindow(c.shift)}
                  {c.shiftEnd ? ` · ended ${clockStr(c.shiftEnd)}` : ""}
                  {c.signedOffAt ? ` · signed off ${clockStr(c.signedOffAt)}` : ""}
                </div>
                <div style={styles.otCardFigures}>
                  <span style={styles.otClaimed}>{otHoursStr(c.claimedMs)} claimed</span>
                  {approved !== null && (
                    <span style={styles.otApproved}>{otHoursStr(approved)} approved</span>
                  )}
                  {!c.granted && (
                    <span style={c.onCall ? styles.otHeld : styles.otNotHeld}>
                      {c.onCall ? `held by a call${c.onCallNature ? ` — ${c.onCallNature}` : ""}` : "not on a call"}
                    </span>
                  )}
                  {/* How it got here: on its own, or because the person sent
                      it. An administrator deciding should not have to guess. */}
                  {!c.granted && (
                    <span style={styles.otSentTag}>
                      {c.automatic ? "sent automatically" : "sent in by them"}
                    </span>
                  )}
                </div>
                {c.decision && c.decision.note && (
                  <div style={styles.otCardNote}>“{c.decision.note}”</div>
                )}
                {c.decision && c.decision.decidedBy && (
                  <div style={styles.otCardBy}>
                    {c.decision.decidedBy} · {gregDateTimeStr(c.decision.decidedAt)}
                  </div>
                )}
                {!c.decision && (
                  <div style={styles.otCardBtns}>
                    <button
                      style={styles.primaryBtnSm}
                      onClick={() => decide(c, "approved", c.claimedMs, "")}
                    >
                      Approve {otHoursStr(c.claimedMs)}
                    </button>
                    <button style={styles.ghostBtnSm} onClick={() => approvePartial(c)}>
                      Approve part
                    </button>
                    <button style={styles.ghostBtnSm} onClick={() => decline(c)}>
                      Decline
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      </OtBlock>
    </FoldingSection>
  );
}