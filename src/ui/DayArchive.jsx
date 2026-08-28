import { PRIORITY, REQ_STATUS, priorityKeyOf } from "../domain/constants.jsx";
import { openCoverageGap } from "../domain/coverage.jsx";
import { queuedReliefFor } from "../domain/crew-relief.jsx";
import { escalationViewer } from "../domain/escalations.jsx";
import { isStaffed } from "../domain/in-service.jsx";
import { STATIONS, atStation, stationLabel, stationOf, stationShort } from "../domain/live-sheet.jsx";
import { clockStr } from "../domain/messages.jsx";
import { logForOpDay, opDayEnd, opDayKey, opDayLabel, opDayStart, requestsForOpDay } from "../domain/op-day.jsx";
import { grantWholeShiftOvertime } from "../domain/overtime.jsx";
import { assistPending } from "../domain/second-ambulance.jsx";
import { hhmm, seatLabel } from "../domain/shift-helpers.jsx";
import { callStartTs } from "../domain/uhu.jsx";
import { exportArchivedDay } from "../export/workbook.jsx";
import { APP_NAME } from "../brand/brand.jsx";
import { gregDateTimeStr } from "../lib/dates.jsx";
import { uid } from "../lib/helpers.jsx";
import { CalendarClock, HandRaised, Plus, Trash, Users } from "../lib/icons.jsx";
import { readKey } from "../lib/offline-queue.jsx";
import { useEffect, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { FoldingSection, ROLE_LABELS, SectionBanner } from "./AdminView.jsx";
import { BackupPanel } from "./BackupPanel.jsx";
import { AssistanceTasks, CallRoute, FleetRow, InfoNote, PendingCallCard } from "./AssistanceTasks.jsx";
import { UnitRosterCard } from "./ChatDock.jsx";
import { ScheduledRequests } from "./CompletedCalls.jsx";
import { CompletedCalls, EscalationChip, EscalationThread } from "./Escalations.jsx";
import { canArea, isDelegatedAdmin } from "../domain/delegation.jsx";
import { DelegatedAuthority } from "./Delegation.jsx";
import { FiledChecklists } from "./FiledChecklists.jsx";
import { PastCallSection } from "./PastCall.jsx";
import { PatientRecords } from "./PatientRecords.jsx";
import { InventoryAdmin } from "./InventoryAdmin.jsx";
import { issueClaimCode } from "../lib/auth.jsx";
import { PasswordResets, TrackingConsentAdmin } from "./LocationConsents.jsx";
import { OvertimePanel } from "./OvertimePanel.jsx";
import { ChecklistAdmin, CoveragePanel, IndicatorBand, IssuesRaised, LiveCoverageBanner, SavedLogs, Statistics } from "./Statistics.jsx";
import { AssistStatusLine, CallTimes, CallTypeTag, LoadedKmTag, NoTransportTag, PcrAuthorTag, StatusBoard } from "./StatusBoard.jsx";

// ---------- the whole day, both stations ----------
//
// The third log. The two shift logs above are each one station's own twelve
// hours; this is the operational day itself — 07:00 to 07:00, both stations,
// both shifts, in one workbook.
//
// Two things live here. The day running now, which an administrator can take a
// copy of at any moment without waiting for anything, and the days already
// kept. The live copy is built from exactly the same code as a kept day, so a
// board exported at 14:00 and the same day downloaded a week later are the same
// document — one of them just says on its front page that the day was still
// running when it was taken.
//
// The boundary is 07:00, not midnight, so at 07:00 the live copy starts again
// from nothing and last night's calls are on last night's day where they
// belong. Nothing carries over.
export function DayArchive({ archives, requests, units, log, scheduled }) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(null);

  const now = Date.now();
  const todayStart = opDayStart(now);
  const today = requestsForOpDay(requests, todayStart);
  const stillRunning = today.filter((r) => r && r.status !== "completed");

  const kept = (archives || [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => (b.dayStart || 0) - (a.dayStart || 0));

  // The day so far, in the shape a kept day has. `reason: "live"` is the only
  // difference, and it is what makes the sheet say so on its front page.
  function liveSnapshot() {
    return {
      id: "live",
      dayKey: opDayKey(todayStart),
      dayStart: todayStart,
      dayEnd: opDayEnd(todayStart),
      closedAt: Date.now(),
      closedBy: "",
      reason: "live",
      requests: today.map((r) => ({ ...r, openAtClose: r.status !== "completed" })),
      log: logForOpDay(log, todayStart),
      scheduled: (scheduled || []).filter(
        (x) => x && x.scheduledFor && opDayStart(x.scheduledFor) === todayStart
      ),
      units: (units || []).map((u) => ({ ...u })),
    };
  }

  async function download(archive, id) {
    setBusy(id);
    try {
      await exportArchivedDay(archive, requests);
    } finally {
      setBusy(null);
    }
  }

  return (
    <FoldingSection
      title="OPERATIONAL DAY — BOTH STATIONS"
      count={kept.length}
      countLabel="days kept"
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div style={styles.liveDayRow}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.savedDay}>
            {opDayLabel(todayStart)}
            <span style={styles.archOpenTag}>running now</span>
          </div>
          <div style={styles.savedMeta}>
            07:00 → 07:00 · {today.length} call{today.length === 1 ? "" : "s"} so far, both stations
            {stillRunning.length
              ? ` · ${stillRunning.length} still running`
              : " · all closed"}
          </div>
        </div>
        <button
          style={styles.primaryBtnSm}
          disabled={busy === "live"}
          onClick={() => download(liveSnapshot(), "live")}
        >
          {busy === "live" ? "…" : "Export the board now"}
        </button>
      </div>

      <InfoNote label="How this works">
        The day runs 07:00 to 07:00, so a night that crosses midnight stays on the day it
        started. At 07:00 this starts again at nothing — last night's calls are on last
        night's day and do not carry over. A call raised before 07:00 and still running
        after it holds its own day open: the day is kept once that call is closed, which
        happens on its own. Nobody has to sign out, and nobody has to press anything.
      </InfoNote>

      {kept.length === 0 ? (
        <div style={styles.emptyState}>
          No day has finished and been kept yet. The first one is kept once every call on it
          is closed.
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {kept.map((a) => {
            const n = (a.requests || []).length;
            return (
              <div key={a.id || a.dayKey} style={styles.savedRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.savedDay}>{opDayLabel(a.dayStart)}</div>
                  <div style={styles.savedMeta}>
                    {n} {n === 1 ? "call" : "calls"} · kept {gregDateTimeStr(a.closedAt)}
                    {a.closedBy ? ` by ${a.closedBy}` : " automatically"}
                    {STATIONS.map(
                      (st) =>
                        ` · ${stationShort(st.key)} ${
                          (a.counts && a.counts[st.key]) != null
                            ? a.counts[st.key]
                            : (a.requests || []).filter((r) => stationOf(r) === st.key).length
                        }`
                    ).join("")}
                  </div>
                </div>
                <button
                  style={styles.primaryBtnSm}
                  disabled={busy === (a.id || a.dayKey)}
                  onClick={() => download(a, a.id || a.dayKey)}
                >
                  {busy === (a.id || a.dayKey) ? "…" : "Excel"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </FoldingSection>
  );
}

// Shared trash control for every roster row. Disabled (with the reason in the
// tooltip) for the account you're signed in with and for the last admin.
//
// Declared here, not inside AdminView. A component defined inside another is a
// brand new component type on every render, which makes React throw the old
// button away and build a fresh one - so a tap landing while the board polls
// can hit a node that is on its way out. Out here its identity is stable and
// React updates the button in place.
// Issues the code for an account that has never been signed into.
//
// Every account created from now on comes with one, but the ones already on the
// board predate that and would otherwise be unclaimable — and the only other
// route to a code is Clear password, which is buried in a panel that only lists
// people who have already asked for help. This sits on the row that already
// says "Pending first login", which is exactly where somebody looks.
export function ClaimCodeBtn({ account, onIssued }) {
  const [busy, setBusy] = useState(false);
  if (account.hasPassword) return null;
  // A code cannot be read back — only its hash is kept — so the roster cannot
  // show the administrator the one they issued yesterday. What it can show is
  // that one is out, which is the difference between "I still have to do this"
  // and "I did it, they lost it". Either way the answer is a new code, and the
  // button says which of the two it is about to be.
  const out = !!account.codeIssued;
  return (
    <button
      style={styles.ghostBtnSm}
      disabled={busy}
      title={
        out
          ? `Replace the sign-in code for ${account.name || account.id} — the old one stops working`
          : `Issue a first sign-in code for ${account.name || account.id}`
      }
      onClick={async () => {
        setBusy(true);
        try {
          const res = await issueClaimCode(account.id);
          if (res && res.code) {
            onIssued([{ id: account.id, name: account.name, role: account.role, code: res.code, expiresAt: res.expiresAt }]);
          }
        } catch (e) {
          window.alert(e.message || "Could not issue a code.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "…" : out ? "New code" : "Sign-in code"}
    </button>
  );
}

// "Code out · 5 days left" on the row, or nothing when there is no code to
// chase. An administrator was otherwise looking at a roster of people marked
// "Pending first login" with no way to tell which of them they had already
// dealt with.
export function ClaimCodeTag({ account }) {
  if (!account || account.hasPassword || !account.codeIssued) return null;
  const left = account.codeExpires ? account.codeExpires - Date.now() : 0;
  const days = Math.ceil(left / 86400000);
  return (
    <span style={styles.accountCodeTag}>
      {left <= 0 ? "CODE EXPIRED" : `CODE OUT · ${days}D`}
    </span>
  );
}

export function RemoveBtn({ account, user, adminAccounts, removingId, onRemove }) {
  const isSelf = user && user.accountId === account.id;
  const lastAdmin = account.role === "admin" && adminAccounts.length <= 1;
  const blocked = isSelf || lastAdmin;
  const title = isSelf
    ? "You can't remove the account you're signed in with"
    : lastAdmin
    ? "The only admin can't be removed"
    : `Remove ${account.name}`;
  return (
    <button
      style={{ ...styles.removeBtn, opacity: blocked ? 0.3 : 1, cursor: blocked ? "not-allowed" : "pointer" }}
      title={title}
      disabled={blocked || removingId === account.id}
      onClick={() => onRemove(account)}
    >
      {removingId === account.id ? "…" : <Trash size={13} />}
    </button>
  );
}

// Removal feedback, shown under whichever roster the admin clicked in.
export function RemoveError({ role, removeError }) {
  if (!removeError || removeError.role !== role) return null;
  return <div style={styles.loginError}>{removeError.message}</div>;
}

// The message that hands a code over, written out and ready to send.
//
// Nothing in this app can deliver a code to the person it belongs to. They have
// not signed in yet — that is the whole reason the code exists — so they have
// no seat, no dock, and nowhere for a message to land. The last step is always a
// human sending it, in Teams or in person, and the complaint was exactly that:
// the code was minted, shown for a moment, and nobody ever received it.
//
// So the app writes the whole message, not just the code. One tap puts it on
// the clipboard and it goes wherever the department already talks.
export function claimCodeMessage(c) {
  const who = c.name ? `${c.name} (${c.id})` : c.id;
  const expires = c.expiresAt ? ` It expires on ${gregDateTimeStr(c.expiresAt)}.` : "";
  return (
    `${APP_NAME} sign-in for ${who}.\n\n` +
    `Your one-time sign-in code is ${c.code}\n\n` +
    `Open ${APP_NAME}, type your employee ID ${c.id}, and when it asks for a sign-in code ` +
    `enter the one above. You then choose your own password — nobody else ever sees it.\n\n` +
    `The code works once.${expires}`
  );
}

// The code an account was just given, shown once.
//
// It is minted by the server, hashed there, and never retrievable again — the
// same treatment a password gets. So it is put in front of the administrator as
// a block they have to deliberately dismiss rather than as a toast that slides
// away while they are reaching for a pen.
function ClaimCodeBanner({ issued, onDone }) {
  const [copied, setCopied] = useState("");
  const n = issued ? issued.length : 0;
  // Codes are minted from two places on this page — the rosters at the top and
  // Password help further down — and the banner sits between them, so from one
  // of the two it appears off screen. Rendering it twice was worse: both copies
  // are live at once and the administrator sees the same code duplicated. One
  // banner that brings itself into view.
  useEffect(() => {
    if (!n) return;
    const el = document.getElementById("claim-code-banner");
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [n]);
  if (!issued || !issued.length) return null;
  const text = issued.map(claimCodeMessage).join("\n\n———\n\n");
  async function copy() {
    // `navigator.clipboard` is the good path and needs a secure context, which
    // the deployed board is. A webview that refuses it still leaves the message
    // selected in the box below, which is enough to copy by hand.
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Copied — paste it to them in Teams");
      return;
    } catch (e) {
      /* falls through */
    }
    try {
      const box = document.getElementById("claim-code-msg");
      if (box) {
        box.focus();
        box.select();
        const ok = document.execCommand && document.execCommand("copy");
        setCopied(ok ? "Copied — paste it to them in Teams" : "Select the message above and copy it");
        return;
      }
    } catch (e) {
      /* falls through */
    }
    setCopied("Select the message above and copy it");
  }
  return (
    <div id="claim-code-banner" style={styles.claimCodeBanner}>
      <div style={styles.claimCodeHead}>
        {issued.length === 1 ? "SIGN-IN CODE — SEND IT NOW" : "SIGN-IN CODES — SEND THEM NOW"}
      </div>
      {issued.map((c) => (
        <div key={c.id} style={styles.claimCodeRow}>
          <span style={styles.claimCodeWho}>
            {c.name || c.id} <span style={styles.claimCodeId}>{c.id}</span>
          </span>
          <span style={styles.claimCodeValue}>{c.code}</span>
        </div>
      ))}
      <div style={styles.claimCodeNote}>
        Nothing sends this for you — they have no account to receive it on yet, which is what the
        code is for. Send them the message below. It works once and lasts seven days, and it is not
        stored anywhere it can be read back: if it is lost, issue another.
      </div>
      <textarea
        id="claim-code-msg"
        readOnly
        rows={Math.min(24, text.split("\n").length + issued.length * 3 + 2)}
        style={styles.claimCodeMsg}
        value={text}
        onFocus={(e) => e.target.select()}
      />
      <div style={styles.claimCodeActions}>
        <button style={styles.primaryBtnSm} onClick={copy}>
          Copy the message
        </button>
        <button style={styles.ghostBtnSm} onClick={onDone}>
          Done — I have sent it
        </button>
      </div>
      {copied && <div style={styles.claimCodeNote}>{copied}</div>}
    </div>
  );
}

export function AdminView({ archives, passwordResets, setPasswordResets, user, units, requests, scheduled, accounts, log, saveUnits, saveAccounts, refreshAccounts, saveRequests, saveScheduled, addLog, audioCtxRef, submissions, coverage, checklists, setChecklists, checklistRuns, page, inventory, setInventory, inventoryMoves, setInventoryMoves, overtimeDecisions, setOvertimeDecisions, overtimeSent, setOvertimeSent, locations, trackingConsents, setTrackingConsents }) {
  // Signing out somebody who went home without doing it. Their hours are closed
  // at the end of the shift they signed on for rather than at this moment —
  // administration pressing a button hours later is not evidence that they
  // worked until now.
  // Counting a whole tour as overtime, from the roster where administration is
  // already looking at the person. The panel on the statistics page can do the
  // same thing; both go through one function so they cannot record it two ways.
  async function grantWholeShift(unit, slot, member) {
    await grantWholeShiftOvertime({
      unit,
      slot,
      member,
      user,
      decisions: overtimeDecisions,
      setDecisions: setOvertimeDecisions,
      addLog,
    });
  }

  async function relieveSeat(unit, slot, member) {
    const endedAt = member.shiftEnd || Date.now();
    const ok = window.confirm(
      `Sign ${member.name} out of ${seatLabel(slot)} on ${unit.name}?\n\n` +
        `Their shift ended at ${clockStr(endedAt)} and the truck is not out. Their hours are ` +
        `recorded to the end of that shift, not to now.\n\nThis is recorded as done by you.`
    );
    if (!ok) return;
    const fresh = await readKey("ems:units", units);
    const u = fresh.find((x) => x.id === unit.id);
    if (!u || !u[slot]) return;
    const waiting = queuedReliefFor(u, slot);
    await saveUnits(
      fresh.map((x) =>
        x.id === unit.id
          ? {
              ...x,
              [slot]: waiting
                ? {
                    accountId: waiting.accountId,
                    name: waiting.name,
                    shift: waiting.shift,
                    shiftStart: waiting.shiftStart,
                    shiftEnd: waiting.shiftEnd,
                    signedOnAt: waiting.queuedAt,
                  }
                : null,
              relief: waiting ? { ...(x.relief || {}), [slot]: null } : x.relief,
              lastCrew: {
                ...(x.lastCrew || {}),
                [slot]: { ...member, signedOffAt: endedAt, relievedByAdmin: true },
              },
            }
          : x
      )
    );
    await addLog(
      `${unit.name} — ${member.name} (${seatLabel(slot)}) signed out by ${user.name || "Admin"} ` +
        `· did not sign out at the end of their shift`,
      "shift",
      {
        kind: "off",
        role: "team",
        name: member.name,
        accountId: member.accountId,
        unitId: unit.id,
        unitName: unit.name,
        station: stationOf(unit),
        seat: slot,
        shift: member.shift || null,
        shiftStart: member.shiftStart || null,
        shiftEnd: member.shiftEnd || null,
        overtimeMs: 0,
        relievedByAdmin: true,
      }
    );
  }

  const [crewName, setCrewName] = useState("");
  const [crewId, setCrewId] = useState("");
  // Codes handed out by the last thing this screen did.
  const [issuedCodes, setIssuedCodes] = useState([]);
  const [crewError, setCrewError] = useState("");
  // Which required boxes are empty, so the form can point at them.
  const [crewMissing, setCrewMissing] = useState({});
  const [crewBusy, setCrewBusy] = useState(false);

  // Adding a truck to a station. One box is shared between the two station
  // sections and remembers which one is being typed into, so a name half-typed
  // under CCC can never be added to the Main Office by accident.
  // The account lists start folded: an administrator opens this screen to look
  // at the board, not to add an ID.
  // Which call the administrator has opened, and one clock for the tiles.
  const [adminOpenId, setAdminOpenId] = useState(null);
  // One period for the whole statistics page — the indicators, the tables and
  // the export. Two selectors would let an administrator export a month while
  // looking at a quarter.
  const [statRange, setStatRange] = useState("month");
  // Which page the bar is showing.
  const onPage = (k) => !page || page === k;
  const [adminTick, setAdminTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAdminTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const [openCrew, setOpenCrew] = useState(false);
  const [openDisp, setOpenDisp] = useState(false);
  const [openAdm, setOpenAdm] = useState(false);

  const [newUnitName, setNewUnitName] = useState("");
  const [newUnitStation, setNewUnitStation] = useState(null);
  const [unitError, setUnitError] = useState("");

  // Renaming a truck.
  //
  // The name is on every call it has ever run, so renaming it here would leave
  // the record saying something the fleet no longer does. The id is what the
  // record actually points at, so the name can change freely and the history
  // stays attached.
  async function renameUnit(unit) {
    const next = window.prompt(`Rename ${unit.name} to:`, unit.name);
    if (next === null) return;
    const name = next.trim();
    if (!name || name === unit.name) return;
    const fresh = await readKey("ems:units", units);
    if (fresh.some((u) => u.id !== unit.id && stationOf(u) === stationOf(unit) &&
        (u.name || "").toLowerCase() === name.toLowerCase())) {
      window.alert(`${stationLabel(stationOf(unit))} already has a ${name}.`);
      return;
    }
    await saveUnits(fresh.map((u) => (u.id === unit.id ? { ...u, name } : u)));
    await addLog(`${unit.name} renamed to ${name} by ${user.name || "Admin"}`, "status");
  }

  // Taking a truck off the fleet.
  //
  // Refused while anybody is on it or it is on a call — a truck cannot be
  // removed out from under a crew. Its calls stay on the record, because they
  // happened; this only stops it being dispatched again. It can be added back
  // under the same name whenever it is needed.
  async function removeUnit(unit) {
    const live = (requests || []).find(
      (r) => r.assignedUnitId === unit.id && r.status !== "completed"
    );
    if (live) {
      window.alert(`${unit.name} is on a call. It can be removed once that is closed.`);
      return;
    }
    if (isStaffed(unit)) {
      window.alert(`${unit.name} has a crew signed on. They have to sign off first.`);
      return;
    }
    const ok = window.confirm(
      `Remove ${unit.name} from ${stationLabel(stationOf(unit))}?\n\n` +
        "Its calls stay on the record. You can add it back under the same name later."
    );
    if (!ok) return;
    const fresh = await readKey("ems:units", units);
    await saveUnits(fresh.filter((u) => u.id !== unit.id));
    await addLog(`${unit.name} removed from the fleet by ${user.name || "Admin"}`, "status");
  }

  async function addUnit(station) {
    const name = newUnitName.trim().toUpperCase();
    setUnitError("");
    if (!name) return;
    const fresh = await readKey("ems:units", units);
    // Only a clash inside the same station matters. Both stations run a MEDIC 1
    // and always will.
    if (fresh.some((u) => stationOf(u) === station && (u.name || "").toUpperCase() === name)) {
      setUnitError(`${stationLabel(station)} already has a ${name}.`);
      return;
    }
    const unit = {
      id: uid("unit"),
      name,
      station,
      status: "oos",
      assignedRequestId: null,
      alpha: null,
      bravo: null,
    };
    await saveUnits([...fresh, unit]);
    setNewUnitName("");
    setNewUnitStation(null);
    await addLog(`${name} added to ${stationLabel(station)} by ${user.name || "Admin"}`, "status");
  }

  const [adminName, setAdminName] = useState("");
  const [adminId, setAdminId] = useState("");
  const [adminError, setAdminError] = useState("");
  const [adminMissing, setAdminMissing] = useState({});
  const [adminBusy, setAdminBusy] = useState(false);

  const [dispName, setDispName] = useState("");
  const [dispId, setDispId] = useState("");
  const [dispError, setDispError] = useState("");
  const [dispMissing, setDispMissing] = useState({});
  const [dispBusy, setDispBusy] = useState(false);

  // { role, message } — scoped so the message renders under the roster the
  // admin actually clicked in, not always under the admin list.
  const [removeError, setRemoveError] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  // Which live call's escalation thread is unfolded on the monitor below.
  const [escFor, setEscFor] = useState(null);

  async function addCrewAccount() {
    const missingCrew = { name: !crewName.trim(), id: !crewId.trim() };
    setCrewMissing(missingCrew);
    if (missingCrew.name || missingCrew.id) {
      setCrewError("Both a name and an employee ID are needed.");
      return;
    }
    setCrewBusy(true);
    setCrewError("");
    setCrewMissing({});
    const accts = accounts || [];
    if (accts.some((a) => a.id.toLowerCase() === crewId.trim().toLowerCase())) {
      setCrewBusy(false);
      setCrewError("That ID already exists.");
      return;
    }
    const next = [
      ...accts,
      {
        id: crewId.trim(),
        name: crewName.trim(),
        role: "crew",
        // Teams aren't fixed: the medic is chosen at every sign-in, so an
        // account is never tied to one.
        team: null,
        createdAt: Date.now(),
      },
    ];
    setIssuedCodes(await saveAccounts(next));
    await addLog(`Admin added crew ID for ${crewName.trim()}`, "status");
    setCrewName("");
    setCrewId("");
    setCrewBusy(false);
  }

  async function addAdminAccount() {
    const missingAdmin = { name: !adminName.trim(), id: !adminId.trim() };
    setAdminMissing(missingAdmin);
    if (missingAdmin.name || missingAdmin.id) {
      setAdminError("Both a name and an employee ID are needed.");
      return;
    }
    setAdminBusy(true);
    setAdminError("");
    setAdminMissing({});
    const accts = accounts || [];
    if (accts.some((a) => a.id.toLowerCase() === adminId.trim().toLowerCase())) {
      setAdminBusy(false);
      setAdminError("That ID already exists.");
      return;
    }
    const next = [
      ...accts,
      { id: adminId.trim(), name: adminName.trim(), role: "admin", team: null, createdAt: Date.now() },
    ];
    setIssuedCodes(await saveAccounts(next));
    await addLog(`Admin added a new admin ID for ${adminName.trim()}`, "status");
    setAdminName("");
    setAdminId("");
    setAdminBusy(false);
  }

  async function addDispatcherAccount() {
    const missingDisp = { name: !dispName.trim(), id: !dispId.trim() };
    setDispMissing(missingDisp);
    if (missingDisp.name || missingDisp.id) {
      setDispError("Both a name and an employee ID are needed.");
      return;
    }
    setDispBusy(true);
    setDispError("");
    setDispMissing({});
    const accts = accounts || [];
    if (accts.some((a) => a.id.toLowerCase() === dispId.trim().toLowerCase())) {
      setDispBusy(false);
      setDispError("That ID already exists.");
      return;
    }
    const next = [
      ...accts,
      { id: dispId.trim(), name: dispName.trim(), role: "dispatcher", team: null, createdAt: Date.now() },
    ];
    setIssuedCodes(await saveAccounts(next));
    await addLog(`Admin added a dispatcher ID for ${dispName.trim()}`, "status");
    setDispName("");
    setDispId("");
    setDispBusy(false);
  }

  // Removing an account is a clean delete: the same ID can be added again
  // later. Anyone sitting in a seat right now is stood down first, and a unit
  // left completely unstaffed (and not on a call) drops back out of service —
  // the same handling as a normal sign-out.
  async function removeAccount(account) {
    const seat = currentSeat(account);
    const isSelf = user && user.accountId === account.id;
    const lastAdmin = account.role === "admin" && accounts.filter((a) => a.role === "admin").length <= 1;

    if (isSelf) {
      setRemoveError({ role: account.role, message: "You can't remove the account you're signed in with." });
      return;
    }
    if (lastAdmin) {
      setRemoveError({
        role: account.role,
        message: "That's the only admin left — add another admin before removing this one.",
      });
      return;
    }
    const warning = seat
      ? `Remove ${account.name} (${account.id})?\n\nThey are on duty right now (${seat}) and will be stood down.\n\nYou can add this ID again later.`
      : `Remove ${account.name} (${account.id})?\n\nYou can add this ID again later.`;
    if (!window.confirm(warning)) return;

    setRemoveError(null);
    setRemovingId(account.id);

    const freshUnits = await readKey("ems:units", units);
    let unitsTouched = false;
    const nextUnits = freshUnits.map((u) => {
      const inAlpha = u.alpha && u.alpha.accountId === account.id;
      const inBravo = u.bravo && u.bravo.accountId === account.id;
      if (!inAlpha && !inBravo) return u;
      unitsTouched = true;
      const cleared = { ...u, alpha: inAlpha ? null : u.alpha, bravo: inBravo ? null : u.bravo };
      if (!cleared.alpha && !cleared.bravo && !cleared.assignedRequestId) cleared.status = "oos";
      return cleared;
    });
    if (unitsTouched) await saveUnits(nextUnits);

    const accts = accounts || [];
    await saveAccounts(accts.filter((a) => a.id !== account.id));
    await addLog(
      `Admin removed ${ROLE_LABELS[account.role] || account.role} ID for ${account.name}${seat ? ` (stood down from ${seat})` : ""}`,
      "status"
    );
    setRemovingId(null);
  }

  // Where (if anywhere) this account is actually seated right now — live,
  // not just what team they're rostered to.
  function currentSeat(account) {
    for (const u of units) {
      if (u.alpha && u.alpha.accountId === account.id) return `${u.name} — Alpha`;
      if (u.bravo && u.bravo.accountId === account.id) return `${u.name} — Bravo`;
    }
    return null;
  }

  const crewAccounts = accounts.filter((a) => a.role === "crew");
  const adminAccounts = accounts.filter((a) => a.role === "admin");
  const dispatcherAccounts = accounts.filter((a) => a.role === "dispatcher");
  const active = requests.filter((r) => r.status !== "completed").sort((a, b) => b.createdAt - a.createdAt);
  // An admin sees every escalation on the board — the inbox below, the banner
  // on each live call, and the same banner on every call in the history.
  const escViewer = escalationViewer(user, null, null);

  return (
    <div>
      {/* One board per station rather than one board for the department. A
          combined count answers a question nobody at either station is asking:
          "three available" means nothing if two of them are at the other end
          of the city. */}
      {/* The teams table is a live picture, so it belongs where the live picture
          is and nowhere else. Repeated on every page it became furniture. */}
      {onPage("board") && STATIONS.map((st) => {
        const gap = openCoverageGap(coverage, st.key);
        return (
          <div key={st.key} style={{ marginBottom: 10 }}>
            <div style={styles.stationBoardLabel}>{st.label}</div>
            <StatusBoard units={atStation(units, st.key)} requests={atStation(requests, st.key)} station={st.key} />
            {/* Directly under this station's own board. An administrator opening
                the app must see that a station cannot answer a call in the same
                glance that tells them who is free — not after scrolling. */}
            {gap && <LiveCoverageBanner gap={gap} />}
          </div>
        );
      })}

      {/* The kept days, near the top: it is the thing an administrator comes
          back to this screen for, and it should not be at the bottom of a long
          scroll. */}
      {/* Archive: what is finished with. The log sheets, and the issues that
          have been dealt with — kept for looking back at, not for acting on.
          Anything still open is on the board, where somebody is expected to do
          something about it. */}
      {onPage("log") && (
        <>
          <DayArchive
            archives={archives}
            requests={requests}
            units={units}
            log={log}
            scheduled={scheduled}
          />
          <SavedLogs submissions={submissions} requests={requests} coverage={coverage} />
          {/* The checks themselves, kept. The statistics page answers whether
              today's have been done; this is where somebody goes back to what a
              truck's check actually said three months ago. */}
          <FiledChecklists checklistRuns={checklistRuns} checklists={checklists} />
          {/* An administrator can write up an outage too — often they are the
              one holding the paper log afterwards. */}
          <PastCallSection
            user={user}
            units={units}
            log={log}
            saveRequests={saveRequests}
            addLog={addLog}
          />

          {/* The same record the desk reads, on the page an administrator goes
              back through. One list, two doors. */}
          <PatientRecords
            requests={requests}
            scheduled={scheduled}
            archives={archives}
            units={units}
          />
          {/* Sits with the archive because it is the same question: what of
              this survives, and where is it kept. */}
          <BackupPanel user={user} />
          <IssuesRaised requests={requests} viewer={escViewer} only="resolved" />
        </>
      )}

      {/* The standing record of what crews have reported — the reasons stay
          readable long after each issue is closed. */}
      {/* The standing record. What is happening right now is shown at the top,
          under each station's own board. */}
      {/* Statistics: everything that measures the department rather than
          showing its live state — coverage history, checklist compliance, the
          per-person figures, and the standing record of issues. All on one
          page, because they are read together when somebody asks how the month
          went. */}
      {onPage("stock") && canArea(user, "inventory") && (
        <InventoryAdmin
          inventory={inventory}
          moves={inventoryMoves}
          setInventory={setInventory}
          user={user}
          addLog={addLog}
        />
      )}

      {onPage("stats") && (
        <>
      {/* Always open, at the head of the page. */}
      {canArea(user, "stats") && (
      <IndicatorBand
        requests={requests}
        units={units}
        log={log}
        checklistRuns={checklistRuns}
        range={statRange}
        setRange={setStatRange}
      />
      )}

      {/* Overtime sits above coverage on the statistics page: it is the thing
          with a deadline on it — a pay period closes — and coverage is a thing
          you read. */}
      {canArea(user, "overtime") && (
      <OvertimePanel
        log={log}
        requests={requests}
        units={units}
        user={user}
        addLog={addLog}
        decisions={overtimeDecisions}
        setDecisions={setOvertimeDecisions}
        sent={overtimeSent}
        setSent={setOvertimeSent}
      />
      )}

      {canArea(user, "stats") && (
        <>
          <TrackingConsentAdmin
            consents={trackingConsents}
            user={user}
            setConsents={setTrackingConsents}
            addLog={addLog}
          />
          <CoveragePanel coverage={coverage} units={units} requests={requests} />
        </>
      )}

      {/* What is on each list, and what came back today. */}
      {canArea(user, "checklists") && (
      <ChecklistAdmin
        checklists={checklists}
        setChecklists={setChecklists}
        checklistRuns={checklistRuns}
        units={units}
        addLog={addLog}
        user={user}
      />
      )}

      {/* Per-person UHU and the month's patient-origin table. */}
      {canArea(user, "stats") && (
      <Statistics
        log={log}
        requests={requests}
        units={units}
        checklistRuns={checklistRuns}
        range={statRange}
        setRange={setStatRange}
      />
      )}

      {/* One place for issues, not two.
          The inbox and the record were the same list twice — what needs
          answering sat above what had been answered, under two different
          headings. The inbox now lives inside the record's Active tab, where
          somebody looking for an issue is already looking. */}
        </>
      )}

      {onPage("teams") && (
        <>
      {/* Above the three roster forms, because it is the one thing on this page
          that changes what somebody can do rather than who exists.
          Lending authority is never itself lendable: a delegate who could
          delegate could widen their own reach, which is not delegation. */}
      {!isDelegatedAdmin(user) && (
        <DelegatedAuthority
          accounts={accounts}
          user={user}
          addLog={addLog}
          refreshAccounts={refreshAccounts}
        />
      )}

      <FoldingSection
        title="ADD TEAM MEMBER ID"
        count={accounts.filter((a) => a.role === "crew").length}
        countLabel="on file"
        open={openCrew}
        onToggle={() => setOpenCrew((v) => !v)}
      >
      <div style={styles.requestForm}>
        <div style={styles.formRow}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>Name</label>
            <input style={{ ...styles.input, ...(crewMissing.name ? styles.inputMissing : null) }} value={crewName} onChange={(e) => setCrewName(e.target.value)} placeholder="e.g. R. Chen" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>ID</label>
            <input style={{ ...styles.input, ...(crewMissing.id ? styles.inputMissing : null) }} value={crewId} onChange={(e) => setCrewId(e.target.value)} placeholder="e.g. F1122334" />
          </div>
        </div>
        <InfoNote label="More about this">
          Team members aren't tied to a medic — they choose the unit they're working, and Alpha or
          Bravo on it, at every sign-in.
        </InfoNote>
        {crewError && <div style={styles.loginError}>{crewError}</div>}
        <button style={styles.primaryBtnSm} disabled={crewBusy} onClick={addCrewAccount}>
          <Plus size={14} /> Add ID
        </button>

        {crewAccounts.length > 0 && (
          <div style={styles.accountList}>
            {crewAccounts.map((a) => {
              const seat = currentSeat(a);
              return (
                <div key={a.id} style={styles.accountRow}>
                  <span style={styles.accountRowName}>{a.name}</span>
                  <span style={styles.accountRowMeta}>{a.id}</span>
                  <span style={seat ? styles.accountActiveTag : styles.accountPendingTag}>
                    {seat ? `Online — ${seat}` : a.hasPassword ? "Offline" : "Pending first login"}
                  </span>
                  <ClaimCodeTag account={a} />
                  <ClaimCodeBtn account={a} onIssued={setIssuedCodes} />
                  <RemoveBtn account={a} user={user} adminAccounts={adminAccounts} removingId={removingId} onRemove={removeAccount} />
                </div>
              );
            })}
          </div>
        )}
        <RemoveError role="crew" removeError={removeError} />
      </div>
      </FoldingSection>

      <FoldingSection
        title="ADD DISPATCHER"
        count={accounts.filter((a) => a.role === "dispatcher").length}
        countLabel="on file"
        open={openDisp}
        onToggle={() => setOpenDisp((v) => !v)}
      >
      <div style={styles.requestForm}>
        <div style={styles.formRow}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>Name</label>
            <input style={{ ...styles.input, ...(dispMissing.name ? styles.inputMissing : null) }} value={dispName} onChange={(e) => setDispName(e.target.value)} placeholder="e.g. J. Alvarez" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>ID</label>
            <input style={{ ...styles.input, ...(dispMissing.id ? styles.inputMissing : null) }} value={dispId} onChange={(e) => setDispId(e.target.value)} placeholder="e.g. D1000002" />
          </div>
        </div>
        <div style={styles.formHint}>Dispatchers can also join a team as crew when a unit is short-staffed.</div>
        {dispError && <div style={styles.loginError}>{dispError}</div>}
        <button style={styles.primaryBtnSm} disabled={dispBusy} onClick={addDispatcherAccount}>
          <Plus size={14} /> Add Dispatcher
        </button>

        {dispatcherAccounts.length > 0 && (
          <div style={styles.accountList}>
            {dispatcherAccounts.map((a) => {
              const seat = currentSeat(a);
              return (
                <div key={a.id} style={styles.accountRow}>
                  <span style={styles.accountRowName}>{a.name}</span>
                  <span style={styles.accountRowMeta}>{a.id}</span>
                  <span style={seat || a.hasPassword ? styles.accountActiveTag : styles.accountPendingTag}>
                    {seat ? `On a team — ${seat}` : a.hasPassword ? "Active" : "Pending first login"}
                  </span>
                  <ClaimCodeTag account={a} />
                  <ClaimCodeBtn account={a} onIssued={setIssuedCodes} />
                  <RemoveBtn account={a} user={user} adminAccounts={adminAccounts} removingId={removingId} onRemove={removeAccount} />
                </div>
              );
            })}
          </div>
        )}
        <RemoveError role="dispatcher" removeError={removeError} />
      </div>
      </FoldingSection>

      <FoldingSection
        title="ADD ADMIN"
        count={accounts.filter((a) => a.role === "admin").length}
        countLabel="on file"
        open={openAdm}
        onToggle={() => setOpenAdm((v) => !v)}
      >
      <div style={styles.requestForm}>
        <div style={styles.formRow}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>Name</label>
            <input style={{ ...styles.input, ...(adminMissing.name ? styles.inputMissing : null) }} value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="e.g. S. Al-Otaibi" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>ID</label>
            <input style={{ ...styles.input, ...(adminMissing.id ? styles.inputMissing : null) }} value={adminId} onChange={(e) => setAdminId(e.target.value)} placeholder="e.g. F9988776" />
          </div>
        </div>
        {adminError && <div style={styles.loginError}>{adminError}</div>}
        <button style={styles.primaryBtnSm} disabled={adminBusy} onClick={addAdminAccount}>
          <Plus size={14} /> Add Admin
        </button>

        {adminAccounts.length > 0 && (
          <div style={styles.accountList}>
            {adminAccounts.map((a) => {
              const seat = currentSeat(a);
              return (
                <div key={a.id} style={styles.accountRow}>
                  <span style={styles.accountRowName}>{a.name}</span>
                  <span style={styles.accountRowMeta}>{a.id}</span>
                  <span style={seat || a.hasPassword ? styles.accountActiveTag : styles.accountPendingTag}>
                    {seat ? `On a team — ${seat}` : a.hasPassword ? "Active" : "Pending first login"}
                  </span>
                  <ClaimCodeTag account={a} />
                  <ClaimCodeBtn account={a} onIssued={setIssuedCodes} />
                  <RemoveBtn account={a} user={user} adminAccounts={adminAccounts} removingId={removingId} onRemove={removeAccount} />
                </div>
              );
            })}
          </div>
        )}
        <RemoveError role="admin" removeError={removeError} />
        <InfoNote label="About removing an ID">
          Removing an ID frees it up — the same ID can be added again whenever you need it.
        </InfoNote>
      </div>
      </FoldingSection>

      <ClaimCodeBanner issued={issuedCodes} onDone={() => setIssuedCodes([])} />

      {/* Somebody who cannot sign in is standing at a tablet right now, so this
          sits with the accounts rather than on the statistics page. */}
      <PasswordResets
        resets={passwordResets}
        setResets={setPasswordResets}
        user={user}
        addLog={addLog}
        onIssued={setIssuedCodes}
      />


      {/* Both stations, one under the other, each with its own roster and its
          own way of adding a truck. Administration is the only place the two
          are visible together — everywhere else they are separate boards. */}
      {STATIONS.map((st) => {
        const unitsHere = atStation(units, st.key);
        const liveHere = atStation(requests, st.key).filter((r) => r.status !== "completed");
        return (
          <div key={st.key} style={{ marginTop: 18 }}>
            <SectionBanner title={`${st.label.toUpperCase()} — TEAM ROSTER`} icon={<Users size={13} />}>
              <span style={styles.stationCount}>
                {unitsHere.length} {unitsHere.length === 1 ? "medic" : "medics"} ·{" "}
                {liveHere.length} live {liveHere.length === 1 ? "call" : "calls"}
              </span>
            </SectionBanner>
            <div style={styles.unitGrid}>
              {unitsHere.map((u) => (
                <UnitRosterCard
                  key={u.id}
                  unit={u}
                  onRelieve={relieveSeat}
                  onGrantOt={grantWholeShift}
                  requests={requests}
                  onRename={() => renameUnit(u)}
                  onRemove={() => removeUnit(u)}
                />
              ))}
            </div>
            <div style={styles.addUnitRow}>
              <input
                style={{ ...styles.input, maxWidth: 220 }}
                value={newUnitStation === st.key ? newUnitName : ""}
                onFocus={() => setNewUnitStation(st.key)}
                onChange={(e) => {
                  setNewUnitStation(st.key);
                  setNewUnitName(e.target.value);
                }}
                placeholder="New medic name, e.g. MEDIC 6"
              />
              <button
                style={styles.primaryBtnSm}
                disabled={newUnitStation !== st.key || !newUnitName.trim()}
                onClick={() => addUnit(st.key)}
              >
                <Plus size={13} /> Add medic
              </button>
            </div>
            {newUnitStation === st.key && unitError && (
              <div style={styles.loginError}>{unitError}</div>
            )}
          </div>
        );
      })}

        </>
      )}

      {/* Board: what is happening right now — including the issues somebody is
          still waiting on an answer to. */}
      {onPage("board") && (
        <>
      <IssuesRaised
        requests={requests}
        viewer={escViewer}
        units={units}
        saveRequests={saveRequests}
        addLog={addLog}
        only="active"
      />

      <SectionBanner title="ACTIVE CALLS" count={active.length} />

      {/* An admin watching the board can send the second ambulance too, rather
          than having to find a dispatcher to do it. */}
      <AssistanceTasks
        user={user}
        units={units}
        requests={requests}
        saveUnits={saveUnits}
        saveRequests={saveRequests}
        addLog={addLog}
        audioCtxRef={audioCtxRef}
      />
      {active.length === 0 && <div style={styles.emptyState}>No active calls. The board is clear.</div>}

      {/* Tiles here too. An administrator watching both stations has the most
          calls on screen of anybody, so this is the view that benefits most. */}
      {!active.some((r) => r.id === adminOpenId) &&
        STATIONS.map((st) => {
          const fleet = atStation(units, st.key);
          if (!fleet.length) return null;
          // Working trucks only, as the desk sees it. A standing ambulance is a
          // name in a line, not a row of its own.
          const busy = fleet
            .map((unit) => ({ unit, req: active.find((r) => r.assignedUnitId === unit.id) }))
            .filter((x) => x.req)
            .sort((a, b) => callStartTs(a.req) - callStartTs(b.req));
          const idle = fleet.filter(
            (u) => isStaffed(u) && !active.some((r) => r.assignedUnitId === u.id)
          );
          // The station's calls with nobody on them. The desk has had its own
          // square for these for a while; an administrator watching both
          // stations is the person most likely to notice one going stale.
          const queued = active.filter(
            (r) => stationOf(r) === st.key && !r.assignedUnitId
          );
          return (
            <div key={`fleet-${st.key}`} style={{ marginTop: 14 }}>
              <div style={styles.uhuStationHead}>{st.label}</div>
              {busy.length > 0 && (
                <div style={styles.boardSquare}>
                  <div style={styles.boardSquareHead}>
                    <span style={styles.boardSquareTitle}>OUT ON A CALL</span>
                    <span style={styles.boardSquareCount}>{busy.length}</span>
                  </div>
                  <div style={styles.callCardGrid}>
                    {busy.map(({ unit, req }) => (
                      <FleetRow
                        key={unit.id}
                        unit={unit}
                        req={req}
                        now={adminTick}
                        onOpen={() => setAdminOpenId(req.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {queued.length > 0 && (
                <div style={styles.boardSquareWaiting}>
                  <div style={styles.boardSquareHead}>
                    <span style={styles.boardSquareTitleWait}>WAITING FOR A TEAM</span>
                    <span style={styles.boardSquareCountWait}>{queued.length}</span>
                  </div>
                  <div style={styles.callCardGrid}>
                    {queued.map((r) => (
                      <PendingCallCard
                        key={r.id}
                        req={r}
                        now={adminTick}
                        onOpen={() => setAdminOpenId(r.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {busy.length === 0 && queued.length === 0 && (
                <div style={styles.calmBoard}>
                  <div style={styles.calmTitle}>Nothing running</div>
                  <div style={styles.calmSub}>
                    {idle.length} {idle.length === 1 ? "team" : "teams"} at station.
                  </div>
                </div>
              )}
              {idle.length > 0 && busy.length > 0 && (
                <div style={styles.standingRow}>
                  {idle.map((u) => (
                    <span key={u.id} style={styles.standingChip}>{u.name}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

      {active.some((r) => r.id === adminOpenId) && (
        <button style={styles.tileBackBtn} onClick={() => setAdminOpenId(null)}>
          ← All {active.length} active {active.length === 1 ? "call" : "calls"}
        </button>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {active.filter((r) => r.id === adminOpenId).map((req) => {
          const unit = units.find((u) => u.id === req.assignedUnitId);
          return (
            <div key={req.id} style={{ ...styles.callCard, borderLeftColor: PRIORITY[priorityKeyOf(req)].color }}>
              <div style={styles.callCardTop}>
                <div style={styles.callCardNature}>{req.nature}</div>
                <div style={styles.callCardTopRight}>
                  <EscalationChip
                    req={req}
                    viewer={escViewer}
                    open={escFor === req.id}
                    onToggle={() => setEscFor(escFor === req.id ? null : req.id)}
                  />
                  <span style={{ ...styles.pill, background: PRIORITY[priorityKeyOf(req)].color }}>{PRIORITY[priorityKeyOf(req)].label}</span>
                </div>
              </div>
              <div style={styles.callCardMeta}>
                <CallRoute req={req} />
                <span style={{ ...styles.pill, background: REQ_STATUS[req.status].color }}>{REQ_STATUS[req.status].label}</span>
                {unit && <span style={styles.assignedTag}>{unit.name}</span>}
                <NoTransportTag req={req} />
                <PcrAuthorTag req={req} />
                <CallTypeTag req={req} />
                <LoadedKmTag req={req} />
                {assistPending(req) && (
                  <span style={styles.assistTagUrgent}>
                    <HandRaised size={11} /> ASSISTANCE REQUESTED
                  </span>
                )}
                {req.scheduledFor && (
                  <span style={styles.scheduledTag}>
                    <CalendarClock size={11} /> booked for {hhmm(req.scheduledFor)}
                  </span>
                )}
                {/* Administration is the only screen where both stations' calls
                    sit in one list, so this is the only screen that has to say
                    which station a call belongs to. */}
                <span style={styles.logStationTag}>{stationShort(stationOf(req))}</span>
              </div>
              <CallTimes times={req.times} req={req} />
              <AssistStatusLine req={req} units={units} />
              {escFor === req.id && (
                <EscalationThread
                  req={req}
                  viewer={escViewer}
                  requests={requests}
                  saveRequests={saveRequests}
                  addLog={addLog}
                  onClose={() => setEscFor(null)}
                />
              )}
            </div>
          );
        })}
      </div>

        </>
      )}

      {/* Bookings sit with the teams they are for. */}
      {onPage("teams") && (
        <ScheduledRequests
          user={user}
          units={units}
          requests={requests}
          scheduled={scheduled}
          saveScheduled={saveScheduled}
          addLog={addLog}
          audioCtxRef={audioCtxRef}
        />
      )}

      {/* An administrator has no History tab of their own — the whole record is
          reached from the Archive and the statistics — so the closed calls stay
          with the board they were run from. */}
      {onPage("board") && (
        <CompletedCalls
          requests={requests}
          units={units}
          saveRequests={saveRequests}
          addLog={addLog}
          viewer={escViewer}
          user={user}
          canCorrect
        />
      )}
    </div>
  );
}