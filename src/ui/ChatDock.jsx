import { callRoute } from "../domain/call-locations.jsx";
import { CALL_CLOSE_REASONS, CALL_CLOSE_REASON_MAX } from "../domain/close-reasons.jsx";
import { PRIORITY, PRIORITY_CHOICES, REQUIREMENTS, REQ_STATUS, reqStatusMeta, applyCallEditsTo, priorityKeyOf, reqLabels, verifyCallEditOn } from "../domain/constants.jsx";
import { COVERAGE_KEY, coverageUnits, openCoverageGap, startCoverageGap, stationHasCoverage } from "../domain/coverage.jsx";
import { queuedReliefFor, reliefSituationFor } from "../domain/crew-relief.jsx";
import { answerHandover, clearHandover, handoverIsPending, handoverRequest } from "../domain/seat-handover.jsx";
import { assignableNote, assignableUnits, effectiveStatusMeta, idleStatusFor, isOnCall, isStaffed, liveRequestFor, statusMeta } from "../domain/in-service.jsx";
import { DEFAULT_STATION, atStation, stationLabel, stationOf } from "../domain/live-sheet.jsx";
import { MESSAGE_MAX, buzz, clockStr, markThreadSeen, notifyMessage, otHoursStr, postMessage, shortDurationStr, threadFor, unreadIn } from "../domain/messages.jsx";
import { opDayLabel, opDayStart } from "../domain/op-day.jsx";
import { oosRequestOf } from "../domain/out-of-service.jsx";
import { activeAssistUnitIds, assistOf, assistPending, assistTeams } from "../domain/second-ambulance.jsx";
import { CALL_CATEGORIES, PATIENT_ORIGINS, applyCallCoding, callTypeMeta, callTypeOf, loadedKmMeta, loadedKmOf } from "../domain/sheet-vocabulary.jsx";
import { hhmm, overtimeMs, scheduledShiftKey, seatLabel, shiftMeta, shiftWindowAt } from "../domain/shift-helpers.jsx";
import { SHIFTS, SHIFT_MS } from "../domain/shifts.jsx";
import { callStartTs, uhuWindowStart } from "../domain/uhu.jsx";
import { soundReminderTone } from "../lib/dates.jsx";
import { uid } from "../lib/helpers.jsx";
import { AlertTriangle, Ambulance, ArrowRight, CalendarClock, CheckCircle2, Clock, HandRaised, MessageSquare, PencilLine, Radio, Tag, Users } from "../lib/icons.jsx";
import { readKey } from "../lib/offline-queue.jsx";
import { useEffect, useRef, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { SectionBanner } from "./AdminView.jsx";
import { AlertToneCheck } from "./AlarmOverlay.jsx";
import { AssistanceTasks, CallEditForm, CallRoute, EditHistory, FleetRow, InfoNote, PendingCallCard, PendingEditReview, ReceiverBanner } from "./AssistanceTasks.jsx";
import { ScheduledRequests } from "./CompletedCalls.jsx";
import { PastCallSection } from "./PastCall.jsx";
import { PatientRecords } from "./PatientRecords.jsx";
import { PendingEditsInbox } from "./DispatcherView.jsx";
import { CompletedCalls } from "./Escalations.jsx";
import { FleetMap } from "./FleetMap.jsx";
import { LiveCoverageBanner } from "./Statistics.jsx";
import { AssistStatusLine, CallCodingBlock, CallCodingFields, CallProgress, CallTimes, CallTypeTag, LoadedKmTag, NoTransportTag, PcrAuthorTag, StatusBoard } from "./StatusBoard.jsx";

// ---------- the chat dock ----------
//
// Retractable, and closed by default. A dispatch board is not a messaging app:
// this has to be reachable from every screen and invisible until it is wanted,
// so it lives as a pill in the corner that carries its own unread count and
// opens into a panel over the board rather than pushing it around.
//
// One component for both sides. The desk sees a list of trucks and picks one;
// a crew has exactly one thread and lands straight in it. The difference is two
// props, not two components — which is what keeps the two halves of a
// conversation looking like one conversation.
// Two shapes, one component.
//
// `floating` is the shape this started as and the one the board wants back: a
// pill above the bottom bar that opens a panel over the page. Given a whole tab
// to itself it displaced the board — a dispatcher who wanted to read one line
// lost the calls they were reading it about, on every page, all shift.
//
// Without `floating` it is still a full page, which is what a crew's own truck
// screen uses.
export function ChatDock({ user, units, messages, station, myUnitId, audioCtxRef, onSent, floating }) {
  const [open, setOpen] = useState(!floating);
  const [activeId, setActiveId] = useState(myUnitId || null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Re-read on every message so a badge clears the moment a thread is opened.
  const [seenTick, setSeenTick] = useState(0);
  const endRef = useRef(null);

  // Everything on this page is scoped to the shift running now.
  const shiftFrom = uhuWindowStart(Date.now());
  const isCrew = !!myUnitId;
  const mine = isCrew ? "crew" : "dispatch";
  const threads = isCrew
    ? (units || []).filter((u) => u.id === myUnitId)
    : (units || []).filter((u) => stationOf(u) === station);

  const active = threads.find((u) => u.id === activeId) || (isCrew ? threads[0] : null);
  const thread = active ? threadFor(messages, active.id, shiftFrom) : [];

  const totalUnread = threads.reduce((n, u) => n + unreadIn(messages, u.id, mine, shiftFrom), 0);
  // The trucks with something unread on them. Their names are what the closed
  // pill shows and what the thread strip lights up, so the desk can see who is
  // talking without opening anything.
  const speaking = threads.filter((u) => unreadIn(messages, u.id, mine, shiftFrom) > 0);

  // Opening a thread marks it read on this device, and so does a new message
  // arriving while it is already open — otherwise the badge counts lines the
  // reader is looking at.
  useEffect(() => {
    if (!open || !active) return;
    const last = thread.length ? thread[thread.length - 1].ts : 0;
    if (last) {
      markThreadSeen(active.id, last);
      setSeenTick((n) => n + 1);
    }
  }, [open, active && active.id, thread.length]);

  // Stick to the newest line.
  useEffect(() => {
    if (!open || !endRef.current) return;
    try {
      endRef.current.scrollIntoView({ block: "end" });
    } catch (e) {}
  }, [open, thread.length, active && active.id]);

  async function send() {
    const text = draft.trim();
    // Send stayed enabled before the desk had picked a truck, and swallowed
    // whatever had been typed.
    if (!text || !active || sending) return;
    setSending(true);
    try {
      const next = await postMessage({
        unit: active,
        from: mine,
        byName: (user && user.name) || (mine === "dispatch" ? "Dispatch" : ""),
        byAccountId: (user && user.accountId) || null,
        text,
        station: stationOf(active),
      });
      if (next) {
        setDraft("");
        if (onSent) onSent(next);
      }
    } finally {
      setSending(false);
    }
  }

  if (!threads.length) return null;

  const panel = (
    <div style={floating ? styles.chatPanelFloat : styles.chatPanel}>
      <div style={styles.chatHead}>
        <div style={styles.chatHeadTitle}>
          <MessageSquare size={14} />
          {isCrew ? "Dispatch" : active ? active.name : "Messages"}
        </div>
        <span style={styles.chatShiftNote}>THIS SHIFT ONLY</span>
      </div>

      {/* The desk picks a truck; a crew never sees this row. */}
      {!isCrew && (
        <div style={styles.chatThreads}>
          {threads.map((u) => {
            const n = unreadIn(messages, u.id, mine, shiftFrom);
            const on = active && active.id === u.id;
            // Selected beats unread: the truck being read is the one the strip
            // should show as current. Unread but not selected is the one the
            // desk has not got to yet, and that is the name worth lighting.
            const look = on ? styles.chatThreadOn : n > 0 ? styles.chatThreadHot : styles.chatThread;
            return (
              <button key={u.id} style={look} onClick={() => setActiveId(u.id)}>
                {u.name}
                {n > 0 && <span style={styles.chatThreadBadge}>{n}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div style={styles.chatLog}>
        {thread.length === 0 ? (
          <div style={styles.chatEmpty}>
            Nothing yet. This is for the things the radio is the wrong tool for —
            which entrance, whether the lift is working, what the ward actually said.
          </div>
        ) : (
          thread.map((m) => {
            const isMine = m.from === mine;
            return (
              <div key={m.id} style={isMine ? styles.chatRowMine : styles.chatRowTheirs}>
                <div style={isMine ? styles.chatBubbleMine : styles.chatBubbleTheirs}>
                  {m.text}
                </div>
                <div style={styles.chatMeta}>
                  {m.byName || (m.from === "crew" ? m.unitName : "Dispatch")} · {clockStr(m.ts)}
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div style={styles.chatCompose}>
        <textarea
          style={styles.chatInput}
          value={draft}
          maxLength={MESSAGE_MAX}
          rows={2}
          disabled={!active}
          placeholder={
            isCrew
              ? "Message the desk…"
              : active
              ? `Message ${active.name}…`
              : "Pick a truck above first"
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; shift-enter is a new line. A thumb on a tablet wants
            // one key, and the message that needs two paragraphs is rare.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          style={draft.trim() && active ? styles.chatSend : styles.chatSendOff}
          onClick={send}
          disabled={!draft.trim() || !active || sending}
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );

  if (!floating) return panel;

  // Closed, the pill says who is waiting. Open, it says how to shut it. The
  // count sits above the pill rather than inside it so it is still legible at
  // arm's length on a desk tablet.
  // A crew has one thread and it is the desk's. Naming the trucks that are
  // talking is right for the desk, which has several; on a crew tablet it put
  // the crew's own truck name on the pill, as though MEDIC 1 were messaging
  // itself. They always say "Dispatch".
  const label = open
    ? "Close"
    : isCrew
    ? "Dispatch"
    : speaking.length
    ? speaking.map((u) => u.name).join(" · ")
    : "Messages";

  return (
    <>
      {open && <div style={styles.chatFloatWrap}>{panel}</div>}
      <button
        style={open ? styles.chatLauncherOn : speaking.length ? styles.chatLauncherHot : styles.chatLauncher}
        onClick={() => setOpen((o) => !o)}
      >
        <MessageSquare size={15} />
        <span style={styles.chatLauncherLabel}>{label}</span>
        {!open && totalUnread > 0 && (
          <span style={styles.chatLauncherBadge}>{totalUnread}</span>
        )}
      </button>
    </>
  );
}

// A message that arrives silently is a message nobody reads. Same reasoning as
// the reply tone on the crew screen — this is worth knowing, not worth
// interrupting a patient for, so it is the soft tone rather than the alarm.
export function useMessageAlerts(messages, mine, unitIds, audioCtxRef) {
  const lastSeen = useRef(null);
  useEffect(() => {
    const ids = new Set(unitIds || []);
    const relevant = (messages || []).filter(
      (m) => m && ids.has(m.unitId) && m.from !== mine
    );
    const newest = relevant.reduce((n, m) => Math.max(n, m.ts || 0), 0);
    if (lastSeen.current !== null && newest > lastSeen.current) {
      const fresh = relevant.filter((m) => (m.ts || 0) > lastSeen.current);
      // Forced. A message that arrives under a lowered volume chip is a
      // message the desk finds twenty minutes later.
      soundReminderTone(audioCtxRef, true);
      buzz([180, 90, 180]);
      fresh.slice(-1).forEach(notifyMessage);
    }
    lastSeen.current = newest;
  }, [messages, mine]);
}

export function DispatcherView({ user, units, requests, scheduled, saveUnits, saveRequests, saveScheduled, addLog, audioCtxRef, coverage, setCoverage, newCallSignal, page, messages, setMessages, locations, archives, log }) {
  const [showForm, setShowForm] = useState(false);
  // Which call is open as a full card. Null means the tile board.
  const [openCallId, setOpenCallId] = useState(null);
  // Which page the bar is showing. Everything the desk needs to answer a call
  // stays on the board; the rest lives on its own page.
  const onPage = (k) => !page || page === k;


  // One clock for the whole board. A board where nothing counts reads as
  // broken, and the elapsed time is the question the desk is being asked all
  // shift — so it moves. A single ticker rather than one per tile, because
  // twelve independent intervals is how a phone gets hot.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // The bar asked for a new call. Open the form and put the board back in view.
  useEffect(() => {
    if (!newCallSignal) return;
    setShowForm(true);
    setOpenCallId(null);
  }, [newCallSignal]);
  const [locationFrom, setLocationFrom] = useState("");
  const [locationTo, setLocationTo] = useState("");
  const [nature, setNature] = useState("");
  // Nothing is urgent until somebody says so. The form opened on urgent, so a
  // desk that never touched the field raised every call at a priority it had not
  // chosen — and a board where most things are urgent tells nobody anything.
  const [priority, setPriority] = useState("bls");
  const [mrn, setMrn] = useState("");
  const [requirements, setRequirements] = useState([]);
  // Free text for the "Other" requirement, and which call the desk has the
  // correction form open on.
  const [reqOther, setReqOther] = useState("");
  // The two coded fields the sheet wants against every call.
  const [patientOrigin, setPatientOrigin] = useState("");
  const [callCategory, setCallCategory] = useState("");
  const [callKind, setCallKind] = useState("");
  const [missingFields, setMissingFields] = useState([]);
  const [editingCallId, setEditingCallId] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [callType, setCallType] = useState("");
  const [loadedKm, setLoadedKm] = useState("");
  // Which call's coding picker is open. The desk can have a dozen calls on
  // screen and twelve sets of code buttons would bury the cards they belong to,
  // so the codes read as tags and the picker opens on the one being worked on.
  const [codingFor, setCodingFor] = useState(null);
  // Which call the desk has pressed Close call on, and the answer being typed
  // for it. The press opens this rather than closing anything: the call is not
  // touched until a reason has been given.
  const [closingId, setClosingId] = useState(null);
  const [closeReason, setCloseReason] = useState("");
  const [closeError, setCloseError] = useState("");

  function toggleRequirement(key) {
    setRequirements((r) => (r.includes(key) ? r.filter((x) => x !== key) : [...r, key]));
  }

  // Everything on this desk is its own station's. The full `units`, `requests`
  // and `scheduled` arrays are deliberately left alone — every save in here
  // re-reads the whole board and writes it back, so handing a filtered array to
  // one of those would quietly delete the other station's work. These are the
  // display lists, and nothing else.
  const myStation = user && user.station ? user.station : DEFAULT_STATION;
  const stationUnits = atStation(units, myStation);
  const stationRequests = atStation(requests, myStation);
  const stationScheduled = atStation(scheduled, myStation);

  const active = stationRequests
    .filter((r) => r.status !== "completed")
    .sort((a, b) => b.createdAt - a.createdAt);

  // Three groups, worked out once: trucks on a call, calls with no truck yet,
  // and trucks standing by. The board shows the first two in full and the third
  // as a single line of names.
  const working = stationUnits
    .map((unit) => ({ unit, req: active.find((r) => r.assignedUnitId === unit.id) }))
    .filter((x) => x.req)
    .sort((a, b) => callStartTs(a.req) - callStartTs(b.req));
  const waiting = active.filter((r) => !r.assignedUnitId);
  const standing = stationUnits.filter(
    (u) => isStaffed(u) && !active.some((r) => r.assignedUnitId === u.id)
  );  // Every team that isn't already out on a call, whatever their status board
  // colour says. Dispatch needs the full list to be able to send anyone at all:
  // filtering to "available" only meant a signed-on crew whose status hadn't
  // been reset was invisible from the desk.
  const assignable = assignableUnits(stationUnits, requests);
  const inService = stationUnits.filter((u) => isStaffed(u));
  const unassigned = active.filter((r) => r.status === "pending");

  // The desk's own correction. It lands on the call immediately and carries the
  // name of whoever made it — a call that quietly changes with no name on it is
  // worse than one that was wrong.
  // Both of these now live at module level so the same correction behaves
  // identically whether it is made on a live call here or on a closed one
  // from the history list.
  // Is anything free right now, and is a gap already running?
  // The policy shelf, read once when the desk opens it rather than polled: this
  // is reference material, not live board state.


  // Every truck at this station, so a message from any of them reaches the desk.
  useMessageAlerts(
    messages,
    "dispatch",
    (units || []).filter((u) => stationOf(u) === myStation).map((u) => u.id),
    audioCtxRef
  );

  const coverageAvailable = stationHasCoverage(units, requests, myStation);
  const myGap = openCoverageGap(coverage, myStation);
  async function declareNoCoverage() {
    if (myGap) return;
    const free = coverageUnits(units, myStation).filter((u) => !liveRequestFor(u, requests));
    const ok = window.confirm(
      free.length
        ? `${free.map((u) => u.name).join(", ")} ${free.length === 1 ? "is" : "are"} still showing as free.\n\n` +
          `Declare NO COVERAGE anyway?`
        : `Declare NO COVERAGE at ${stationLabel(myStation)}?\n\n` +
          `Every team is out with a patient. It ends on its own as soon as one is back in service — ` +
          `you do not need to press anything again.\n\nZahrawi is not counted.`
    );
    if (!ok) return;
    const done = await startCoverageGap({
      station: myStation,
      by: user.name || "Dispatch",
      units,
      requests,
      list: coverage,
      addLog,
    });
    if (done) setCoverage((await readKey(COVERAGE_KEY, [])) || []);
  }

  // Confirming a call a crew opened themselves.
  //
  // Confirming leaves it exactly as it is and marks it acknowledged. Declining
  // closes it with a reason — the crew were somewhere doing something, so it
  // does not simply vanish; it ends up on the log as a call that was stood down,
  // which is the honest record of what happened.
  async function confirmCrewRaise(req, confirm) {
    const now = Date.now();
    const fresh = await readKey("ems:requests", requests);
    if (!confirm) {
      const why = window.prompt(
        `Not a call?\n\n${req.nature}\n\nSay why — the crew see this, and it goes on the log.`
      );
      if (why === null) return;
      if (!why.trim()) {
        window.alert("The crew need a reason.");
        return;
      }
      await saveRequests(
        fresh.map((r) =>
          r.id === req.id
            ? {
                ...r,
                status: "completed",
                closedBy: user.name || "Dispatch",
                closeReason: `Not a call — ${why.trim()}`,
                crewRaise: { ...r.crewRaise, status: "declined", answerNote: why.trim() },
                times: { ...(r.times || {}), backInService: now },
              }
            : r
        )
      );
      const freshUnits = await readKey("ems:units", units);
      await saveUnits(
        freshUnits.map((u) =>
          u.id === req.assignedUnitId ? { ...u, status: "available", assignedRequestId: null } : u
        )
      );
      await addLog(`Crew-raised call closed by ${user.name || "Dispatch"} — ${why.trim()}`, "status");
      return;
    }
    await saveRequests(
      fresh.map((r) =>
        r.id === req.id
          ? {
              ...r,
              crewRaise: {
                ...r.crewRaise,
                status: "confirmed",
                answeredAt: now,
                answeredBy: user.name || "Dispatch",
              },
            }
          : r
      )
    );
    await addLog(
      `${req.nature} confirmed onto the board by ${user.name || "Dispatch"} — raised by ${
        req.crewRaise.byName || "the crew"
      }`,
      "assign"
    );
  }

  // Answering a request to stand somebody down. Approving is what actually
  // takes them off the seat — their hours close at that moment, not at the
  // moment they asked, because they were on the truck until it was agreed.
  async function answerStandDown(unit, approve) {
    const rq = unit.standDownRequest;
    if (!rq) return;
    let note = "";
    if (!approve) {
      note = window.prompt(`Refuse? Say why — the crew sees this.\n\nThey asked: ${rq.reason}`);
      if (note === null) return;
      if (!note.trim()) {
        window.alert("A refusal needs a reason.");
        return;
      }
    }
    const now = Date.now();
    const fresh = await readKey("ems:units", units);
    await saveUnits(
      fresh.map((u) => {
        if (u.id !== unit.id) return u;
        if (!approve) {
          return {
            ...u,
            standDownRequest: { ...rq, status: "refused", answeredAt: now, answerNote: note.trim(), answeredBy: user.name || "Dispatch" },
          };
        }
        const member = u[rq.seat];
        return {
          ...u,
          [rq.seat]: null,
          standDownRequest: null,
          lastCrew: {
            ...(u.lastCrew || {}),
            [rq.seat]: member ? { ...member, signedOffAt: now, standDownReason: rq.reason } : null,
          },
        };
      })
    );
    await addLog(
      approve
        ? `${unit.name} — ${rq.name} stood down from ${seatLabel(rq.seat)} by ${user.name || "Dispatch"}: ${rq.reason}`
        : `${unit.name} — stand-down for ${rq.name} refused by ${user.name || "Dispatch"}: ${note.trim()}`,
      "shift",
      approve
        ? {
            kind: "off",
            role: "team",
            name: rq.name,
            accountId: rq.accountId,
            unitId: unit.id,
            unitName: unit.name,
            station: stationOf(unit),
            seat: rq.seat,
          }
        : undefined
    );
  }

  // A seat somebody is waiting for, whose holder has not answered on their
  // phone. The holder decides, normally; a dead phone cannot, so the desk can
  // hand the seat over — the holder is signed off at this moment, with their
  // hours, and the log says the DESK did it, never that the holder agreed.
  async function forceHandover(unit, slot) {
    const r = handoverRequest(unit, slot);
    const holder = unit[slot];
    if (!r || !holder) return;
    if (
      !window.confirm(
        `Hand ${seatLabel(slot)} on ${unit.name} over to ${r.name} now?\n\n` +
          `${holder.name} is signed off at this moment — their hours close now — and the log records that the desk did it.`
      )
    )
      return;
    const now = Date.now();
    const ot = overtimeMs(holder, now);
    const fresh = await readKey("ems:units", units);
    await saveUnits(
      fresh.map((u) => {
        if (u.id !== unit.id) return u;
        const cur = u[slot];
        const ask = handoverRequest(u, slot);
        if (!ask || !cur) return u;
        return {
          ...clearHandover(u, slot),
          [slot]: {
            accountId: ask.accountId, name: ask.name, shift: ask.shift,
            shiftStart: ask.shiftStart, shiftEnd: ask.shiftEnd, signedOnAt: ask.queuedAt,
          },
          lastCrew: {
            ...(u.lastCrew || {}),
            [slot]: { ...cur, signedOffAt: now, overtimeMs: overtimeMs(cur, now), handedOverBy: user.name || "Dispatch" },
          },
        };
      })
    );
    await addLog(
      `${unit.name} — ${holder.name} (${seatLabel(slot)}) signed off · seat handed over to ${r.name} by ${user.name || "Dispatch"} (no answer from ${holder.name})` +
        (ot > 0 ? ` · ${otHoursStr(ot)} overtime` : ""),
      "shift",
      {
        kind: "off", role: "team", name: holder.name, accountId: holder.accountId,
        unitId: unit.id, unitName: unit.name, station: stationOf(unit), seat: slot,
        shift: holder.shift || null, shiftStart: holder.shiftStart || null, shiftEnd: holder.shiftEnd || null,
        overtimeMs: ot, forcedBy: user.name || "Dispatch",
      }
    );
    await addLog(
      `${unit.name} — ${r.name} took over ${seatLabel(slot)} from ${holder.name} · handed over by ${user.name || "Dispatch"}`,
      "shift",
      {
        kind: "on", role: "team", name: r.name, accountId: r.accountId,
        unitId: unit.id, unitName: unit.name, station: stationOf(unit), seat: slot,
        shift: r.shift || null, shiftStart: r.shiftStart || null, shiftEnd: r.shiftEnd || null,
        relievedName: holder.name, forcedBy: user.name || "Dispatch",
      }
    );
  }
  async function withdrawHandover(unit, slot) {
    const r = handoverRequest(unit, slot);
    if (!r) return;
    if (!window.confirm(`Withdraw ${r.name}'s request for ${seatLabel(slot)} on ${unit.name}?\n\nThey are told, and signed off.`)) return;
    const fresh = await readKey("ems:units", units);
    await saveUnits(fresh.map((u) => (u.id === unit.id ? answerHandover(u, slot, "declined", user.name || "Dispatch", Date.now()) : u)));
    await addLog(
      `${unit.name} — ${r.name}'s request to take over ${seatLabel(slot)} withdrawn by ${user.name || "Dispatch"}`,
      "shift",
      { kind: "note", role: "dispatcher", name: user.name, accountId: user.accountId, unitId: unit.id, unitName: unit.name, station: stationOf(unit), seat: slot }
    );
  }

  // Answering a truck that has asked to come off.
  //
  // A refusal has to say why. A crew who asked because the oxygen is low and is
  // told only "no" has learned nothing except not to ask again — and the desk
  // may have refused for a reason the crew would accept, if they were told it.
  async function answerOos(unit, approve) {
    const rq = oosRequestOf(unit);
    if (!rq) return;
    let note = "";
    if (!approve) {
      note = window.prompt(
        `Refuse ${unit.name}'s request?\n\nThey asked because: ${rq.reason}` +
          (rq.note ? ` — ${rq.note}` : "") +
          `\n\nSay why. The crew sees this on their screen.`
      );
      if (note === null) return;
      if (!note.trim()) {
        window.alert("A refusal needs a reason.");
        return;
      }
    }
    const now = Date.now();
    const fresh = await readKey("ems:units", units);
    await saveUnits(
      fresh.map((u) =>
        u.id === unit.id
          ? {
              ...u,
              status: approve ? "oos" : u.status,
              oosRequest: {
                ...rq,
                status: approve ? "approved" : "refused",
                answeredAt: now,
                answeredBy: user.name || "Dispatch",
                answerNote: note.trim(),
              },
            }
          : u
      )
    );
    await addLog(
      approve
        ? `${unit.name} taken out of service by ${user.name || "Dispatch"} — ${rq.reason}` +
          (rq.note ? `: ${rq.note}` : "")
        : `${unit.name} refused out of service by ${user.name || "Dispatch"} — ${note.trim()}` +
          ` (asked: ${rq.reason})`,
      "status"
    );
  }

  // Putting a truck back on the run.
  //
  // The desk could take an ambulance off and then not put it back. Only the
  // crew's own screen carried "Back in service", so a truck stood down for a
  // restock stayed off the board until somebody on it picked up a tablet —
  // and when the desk needs that ambulance NOW, at the moment a call lands and
  // nothing else is free, waiting for the crew to notice is the wrong way
  // round. The decision to take it off was the desk's; so is the decision to
  // end that.
  //
  // Only offered for a truck that has a crew on it. Returning an empty one to
  // service would put a unit dispatch can send on the board with nobody in it.
  async function returnToService(unit) {
    if (!unit) return;
    if (!isStaffed(unit)) {
      window.alert(`${unit.name} has nobody signed on. It comes back on the run when a crew signs on.`);
      return;
    }
    const rq = unit.oosRequest;
    const why = rq && rq.reason ? ` (was off for: ${rq.reason})` : "";
    if (!window.confirm(`Put ${unit.name} back in service?${why}\n\nIt becomes available for dispatch immediately.`)) return;
    const fresh = await readKey("ems:units", units);
    await saveUnits(
      fresh.map((u) =>
        u.id === unit.id
          ? {
              ...u,
              status: idleStatusFor(u),
              // The answered request is cleared with it. Leaving it behind
              // would have the crew's screen still showing an approval for a
              // stand-down that is over.
              oosRequest: null,
            }
          : u
      )
    );
    await addLog(
      `${unit.name} put back in service by ${user.name || "Dispatch"}${why}`,
      "status",
      { event: "backInService", unitName: unit.name }
    );
  }

  // Sending a second ambulance the crew never asked for.
  //
  // Until now an assist could only start with the crew raising it — which is
  // fine when they can reach the board, and useless when they cannot. A team
  // out of signal in a basement, or on a tablet that has died, is exactly the
  // team most likely to need help and least able to ask. The desk can see the
  // call, hears it on the radio, and should be able to act on that.
  //
  // It is recorded as raised by the desk, not attributed to the crew, so the
  // log shows what actually happened.
  async function dispatchRaisesAssist(target) {
    if (!target || target.status === "completed") return;
    if (assistPending(target)) return;
    const unit = units.find((u) => u.id === target.assignedUnitId);
    const ok = window.confirm(
      `Send a second ambulance to "${target.nature}"${unit ? ` with ${unit.name}` : ""}?\n\n` +
        `Use this when the crew cannot ask for it themselves — out of signal, or off the board. ` +
        `It is recorded as raised by the desk.`
    );
    if (!ok) return;
    const now = Date.now();
    const fresh = await readKey("ems:requests", requests);
    await saveRequests(
      fresh.map((r) =>
        r.id === target.id
          ? {
              ...r,
              assist: {
                ...(assistOf(r) || {}),
                status: "pending",
                requestedAt: now,
                requestedByUnitId: target.assignedUnitId || null,
                requestedByUnitName: unit ? unit.name : "",
                requestedBy: user && user.name ? user.name : "Dispatch",
                // Says plainly that the desk started this, not the crew.
                raisedByDesk: true,
                cancelledAt: null,
                cancelledBy: null,
                teams: assistTeams(r),
              },
            }
          : r
      )
    );
    await addLog(
      `${user.name || "Dispatch"} sent a second ambulance to "${target.nature}"` +
        `${unit ? ` (${unit.name})` : ""} — raised by the desk, crew did not request it`,
      "assign"
    );
  }

  // Handing a call to the next shift on purpose, rather than waiting for the
  // submit button to do it. A ward that will not be ready for three hours, or a
  // booking the shift plainly is not going to get to, belongs to the crew coming
  // on — and saying so now is better than leaving it on the board looking like
  // work in progress. It stays on this shift's log either way: the shift that
  // took the call owns the record of it.
  async function handToNextShift(target) {
    if (!target) return;
    const shiftName = SHIFTS[user.shift] ? SHIFTS[user.shift].label : user.shift || "this shift";
    if (target.handover) {
      // Already handed over — let the desk take it back if they can do it after all.
      const undo = window.confirm(
        `"${target.nature}" is marked for the next shift.\n\nTake it back onto this shift?`
      );
      if (!undo) return;
      const fresh = await readKey("ems:requests", requests);
      await saveRequests(
        fresh.map((r) => (r.id === target.id ? { ...r, handover: null } : r))
      );
      await addLog(
        `${user.name || "Dispatch"} took "${target.nature}" back onto the ${shiftName}`,
        "status"
      );
      return;
    }
    const ok = window.confirm(
      `Hand "${target.nature}" to the next shift?\n\n` +
        `It stays on the ${shiftName} log — the shift that took the call keeps the record — ` +
        `but it will be marked on the board so the next desk knows it is theirs to run.`
    );
    if (!ok) return;
    const handover = {
      fromShift: user.shift || scheduledShiftKey(Date.now()),
      fromShiftLabel: shiftName,
      fromDay: opDayLabel(opDayStart(user.shiftStart || Date.now())),
      by: user.name || "Dispatch",
      at: Date.now(),
      deliberate: true,
    };
    const fresh = await readKey("ems:requests", requests);
    await saveRequests(fresh.map((r) => (r.id === target.id ? { ...r, handover } : r)));
    await addLog(
      `${user.name || "Dispatch"} handed "${target.nature}" (${callRoute(target)}) to the next shift`,
      "status"
    );
  }

  async function applyCallEdits(target, changes, note) {
    const ok = await applyCallEditsTo({
      req: target, changes, note,
      who: user && user.name ? user.name : "Dispatch",
      requests, saveRequests, addLog,
    });
    if (ok) setEditingCallId(null);
  }

  async function verifyCallEdit(target, entry, accept) {
    await verifyCallEditOn({
      req: target, entry, accept,
      who: user && user.name ? user.name : "Dispatch",
      requests, saveRequests, addLog,
    });
  }

  async function submitRequest() {
    // Where to collect the patient is the only thing dispatch genuinely has to
    // know to send an ambulance. The nature of the call, the destination and the
    // MRN are all often given later, over the radio or by the ward ringing back,
    // and requiring them up front only meant the desk typed something plausible
    // to get the truck moving — which is worse than an honest blank.
    // The highlight the form already draws had nothing driving it:
    // missingFields was declared, read by the inputs, cleared as somebody
    // typed - and never once set. So pressing Dispatch with the pickup point
    // blank did nothing at all, silently, which is the worst thing a form can
    // do to somebody trying to send an ambulance.
    const missing = [];
    if (!locationFrom.trim()) missing.push("locationFrom");
    setMissingFields(missing);
    if (missing.length) return;
    const createdAt = Date.now();
    // Read fresh before deciding anything, so we never clobber a change another
    // device made in the last few seconds (this is what caused assigned calls
    // to sometimes never reach the crew) and so the team picked when the form
    // was opened is confirmed still free. If it isn't, the call is raised
    // without a team rather than pulling that crew off what they're on — the
    // desk assigns it from the call card as soon as a team clears.
    const freshRequests = await readKey("ems:requests", requests);
    const freshUnits = await readKey("ems:units", units);
    const pickedUnit = selectedTeam ? freshUnits.find((u) => u.id === selectedTeam) : null;
    const assignNow = !!pickedUnit && !isOnCall(pickedUnit, freshRequests);
    const req = {
      id: uid("req"),
      // The station that raised it. A call belongs to the board it came from
      // for the whole of its life — that is what keeps the two stations' calls,
      // and their log sheets, genuinely separate.
      station: user && user.station ? user.station : DEFAULT_STATION,
      // Pickup point and destination. `location` is still written as the pickup
      // point so anything reading the old single field keeps working.
      locationFrom: locationFrom.trim(),
      locationTo: locationTo.trim(),
      location: locationFrom.trim(),
      // A call raised with nothing said about it reads as awaiting detail rather
      // than as blank, so the crew and the desk both know it is still to come.
      nature: nature.trim() || "Awaiting detail",
      // Straight from the sheet's own lists, so the month-end statistics need no
      // interpretation.
      patientOrigin: patientOrigin || "",
      callCategory: callCategory || "",
      // What the desk declared at the moment it was raised, kept apart from the
      // category it was later filed under. The first is what a desk believed
      // under pressure; the second is what it turned out to be.
      callKind: callKind || "",
      priority,
      mrn: mrn.trim(),
      // The typed detail behind an "Other" requirement, kept only when the
      // box is actually ticked so a stray note can't linger on the call.
      reqOther: requirements.includes("other") ? reqOther.trim() : "",
      requirements,
      // The two codes the billing sheet wants. Whatever the desk knows at
      // intake — often the category and nothing else — with the rest left for
      // the crew to fill in from the truck.
      callType: callTypeMeta(callType) ? callType : null,
      callTypeBy: callTypeMeta(callType) && user && user.name ? user.name : "",
      callTypeAt: callTypeMeta(callType) ? createdAt : null,
      loadedKm: loadedKmMeta(loadedKm) ? loadedKm : null,
      loadedKmBy: loadedKmMeta(loadedKm) && user && user.name ? user.name : "",
      loadedKmAt: loadedKmMeta(loadedKm) ? createdAt : null,
      status: assignNow ? "assigned" : "pending",
      assignedUnitId: assignNow ? selectedTeam : null,
      acknowledged: false,
      // The shift the desk was working when the call came in, so the dispatch
      // log can be read a shift at a time. Falls back to the clock if this
      // session somehow has no shift on it.
      shift: user && user.shift ? user.shift : scheduledShiftKey(createdAt),
      // `assigned` is when this team's UHU clock starts running.
      times: assignNow ? { assigned: createdAt } : {},
      createdAt,
    };
    await saveRequests([req, ...freshRequests]);
    const reqTag = requirements.length
      ? ` [${requirements.map((k) => REQUIREMENTS.find((r) => r.key === k).label).join(", ")}]`
      : "";
    const codeTag =
      (req.callType ? ` · type ${req.callType}` : "") + (req.loadedKm ? ` · km ${req.loadedKm}` : "");
    await addLog(`Call received: ${req.nature} — ${callRoute(req)} (${PRIORITY[priority].label})${reqTag}${codeTag}`, "call");

    if (assignNow) {
      const nextUnits = freshUnits.map((u) =>
        u.id === selectedTeam ? { ...u, status: "dispatched", assignedRequestId: req.id } : u
      );
      await saveUnits(nextUnits);
      await addLog(`${pickedUnit.name} assigned to ${req.nature} — ${callRoute(req)}`, "assign");
    } else if (pickedUnit) {
      await addLog(
        `${pickedUnit.name} was already on a call — ${req.nature} (${callRoute(req)}) is waiting for a team`,
        "call"
      );
    }

    setLocationFrom("");
    setLocationTo("");
    setNature("");
    setPriority("urgent");
    setMrn("");
    setRequirements([]);
    setReqOther("");
    setPatientOrigin("");
    setCallCategory("");
    setCallKind("");
    setCallType("");
    setLoadedKm("");
    setSelectedTeam("");
    setShowForm(false);
  }

  // The desk's half of the coding. The crew set the same two fields from their
  // own card, through the same writer, so whichever of them gets there first is
  // what the sheet carries — and either can correct the other.
  async function setCoding(reqId, field, value) {
    await applyCallCoding({ reqId, field, value, requests, saveRequests, addLog, actor: user });
  }

  async function assignUnit(reqId, unitId) {
    // Fresh reads, not the possibly-stale `requests`/`units` props, so this
    // assignment can never be silently overwritten by (or overwrite) a
    // change from another device that landed between polls.
    const freshRequests = await readKey("ems:requests", requests);
    const freshUnits = await readKey("ems:units", units);
    const req = freshRequests.find((r) => r.id === reqId);
    const unit = freshUnits.find((u) => u.id === unitId);
    if (!req || !unit) return;
    // Another dispatcher (or the crew themselves) may have taken this team onto
    // a different call since this dropdown was drawn. Say so rather than
    // quietly pulling them off it.
    const busyOn = liveRequestFor(unit, freshRequests);
    if (busyOn && busyOn.id !== reqId) {
      window.alert(`${unit.name} was just assigned to "${busyOn.nature}". Pick another team.`);
      return;
    }
    const nextRequests = freshRequests.map((r) =>
      r.id === reqId
        ? {
            ...r,
            status: "assigned",
            assignedUnitId: unitId,
            acknowledged: false,
            times: { assigned: Date.now() },
            // The PCR author is one of the seats on the team that ran the call,
            // so a call handed to a different team arrives with the paperwork
            // name cleared rather than pointing at a crew who are no longer on
            // it. The new team name their own author before they close it.
            pcrAuthor: r.pcrAuthor && r.assignedUnitId === unitId ? r.pcrAuthor : null,
          }
        : r
    );
    // The truck that was on it goes back on the board.
    //
    // Reassigning without releasing the first one left it showing as dispatched
    // to a call it was no longer on — the desk would see one fewer ambulance
    // than it had, which is the most expensive kind of wrong on this screen.
    const previousId = req.assignedUnitId && req.assignedUnitId !== unitId ? req.assignedUnitId : null;
    const previous = previousId ? freshUnits.find((u) => u.id === previousId) : null;
    const nextUnits = freshUnits.map((u) => {
      if (u.id === unitId) return { ...u, status: "dispatched", assignedRequestId: reqId };
      if (u.id === previousId) return { ...u, status: "available", assignedRequestId: null };
      return u;
    });
    await saveRequests(nextRequests);
    await saveUnits(nextUnits);
    await addLog(
      previous
        ? `${req.nature} moved from ${previous.name} to ${unit.name} — ${callRoute(req)}`
        : `${unit.name} assigned to ${req.nature} — ${callRoute(req)}`,
      "assign"
    );
  }

  // Closing a call is two presses, not one. The first opens the banner on the
  // card asking what happened to it; nothing is written until a reason has been
  // given. A call that leaves the board with no ending on it is one nobody can
  // account for the next morning — and the ending is exactly what the
  // supervisor reading the exported workbook is looking for — so it is required
  // here rather than left to the comments column.
  function openClose(req) {
    setClosingId(req.id);
    setCloseReason("");
    setCloseError("");
    // The coding picker and this banner are two questions about the same call,
    // and only one of them has to be answered right now, so opening the banner
    // puts it in front of the desk on its own.
    setCodingFor(null);
  }

  function cancelClose() {
    setClosingId(null);
    setCloseReason("");
    setCloseError("");
  }

  async function closeRequest(reqId) {
    const reason = closeReason.trim().slice(0, CALL_CLOSE_REASON_MAX);
    if (!reason) {
      setCloseError(
        "Say why this call is being closed — it stays on the call and goes out on the dispatch log."
      );
      return;
    }
    cancelClose();
    const freshRequests = await readKey("ems:requests", requests);
    const freshUnits = await readKey("ems:units", units);
    const req = freshRequests.find((r) => r.id === reqId);
    if (!req) return;
    const closedAt = Date.now();
    const nextRequests = freshRequests.map((r) =>
      r.id === reqId
        ? {
            ...r,
            status: "completed",
            // Stamped so the completed-calls history can still order and time a
            // call the desk closed before the crew finished the timeline.
            closedAt,
            closedBy: user && user.name ? user.name : "Dispatch",
            // Why it ended, in the desk's own words. Read back on the completed
            // card, written into the event log, and carried out onto the
            // DISPATCH LOG sheet of the shared workbook.
            closeReason: reason,
            // Closing the call also closes anything still open on it: a second
            // ambulance nobody sent is no longer a task, and a team that was
            // assisting has finished with it.
            assist: assistOf(r)
              ? {
                  ...assistOf(r),
                  status: assistOf(r).status === "pending" ? "cancelled" : assistOf(r).status,
                  cancelledAt: assistOf(r).status === "pending" ? closedAt : assistOf(r).cancelledAt,
                  cancelledBy:
                    assistOf(r).status === "pending"
                      ? user && user.name
                        ? user.name
                        : "Dispatch"
                      : assistOf(r).cancelledBy,
                  teams: assistTeams(r).map((t) => (t.clearedAt ? t : { ...t, clearedAt: closedAt })),
                }
              : r.assist,
          }
        : r
    );
    // Freeing the team returns it to in service if a crew is still signed on,
    // and to out of service if the seats are empty — closing a call must not
    // leave a phantom "available" unit with nobody on board for dispatch to
    // send on the next one. Any team that was assisting is freed the same way.
    const freeIds = [req.assignedUnitId, ...activeAssistUnitIds(req)].filter(Boolean);
    const nextUnits = freshUnits.map((u) =>
      freeIds.includes(u.id) ? { ...u, status: idleStatusFor(u), assignedRequestId: null } : u
    );
    await saveRequests(nextRequests);
    await saveUnits(nextUnits);
    await addLog(`Call closed: ${req.nature} — ${callRoute(req)} · reason: ${reason}`, "clear");
  }

  return (
    <div>
      <div style={styles.stationBanner}>
        <Radio size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
        {stationLabel(myStation)} — dispatch desk
      </div>

      <StatusBoard units={stationUnits} requests={stationRequests} station={myStation} />

      {/* At the top, with the status board. Whether there is anything left to
          send is the first thing the desk needs to know when it looks at this
          screen — not something to be found after scrolling past the calls. */}
      <div style={styles.coverageRow}>
        {myGap ? (
          <LiveCoverageBanner gap={myGap} />
        ) : (
          <button
            style={coverageAvailable ? styles.coverageBtnQuiet : styles.coverageBtn}
            onClick={declareNoCoverage}
          >
            <AlertTriangle size={13} /> Declare NO COVERAGE
            {/* It starts on its own the moment the last team goes out. This is
                here for the case the board cannot see — a truck off the road
                with a fault, a crew stood down — where the desk knows something
                the board does not. */}
            <span style={styles.coverageHint}>
              {coverageAvailable ? "a team is still free" : "starts by itself"}
            </span>
          </button>
        )}
      </div>


      {/* Reachable from every dispatcher page, closed until it is wanted. */}
      <ChatDock
        floating
        user={user}
        units={units}
        messages={messages}
        station={myStation}
        audioCtxRef={audioCtxRef}
        onSent={setMessages}
      />


      {onPage("map") && (
        <FleetMap
          units={units}
          locations={locations}
          requests={requests}
          station={myStation}
        />
      )}

      {onPage("board") && (
        <>
      {/* A crew have come across something and started the clock themselves.
          The desk confirms it onto the board — the call is already running, so
          this is an acknowledgement, not a permission. */}
      {stationRequests
        .filter((r) => r.crewRaise && r.crewRaise.status === "pending")
        .map((r) => {
          const u = stationUnits.find((x) => x.id === r.assignedUnitId);
          return (
            <div key={`cr-${r.id}`} style={styles.crewRaiseAsk}>
              <div style={styles.crewRaiseHead}>
                🚨 {u ? u.name : "A team"} found an emergency
              </div>
              <div style={styles.crewRaiseWhat}>
                <strong>{r.nature}</strong>
                {r.locationFrom ? ` · ${r.locationFrom}` : ""}
                <span style={styles.oosAskWho}>
                  {" "}· {r.crewRaise.byName} at {clockStr(r.crewRaise.at)}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button style={styles.primaryBtnSm} onClick={() => confirmCrewRaise(r, true)}>
                  Confirm — put it on the board
                </button>
                <button style={styles.ghostBtnSm} onClick={() => confirmCrewRaise(r, false)}>
                  Not a call
                </button>
              </div>
            </div>
          );
        })}

      {/* Crews asking for a partner to be stood down. Same shape as the
          out-of-service request, because it is the same kind of decision: who
          is crewed, and the desk is answerable for it. */}
      {stationUnits
        .filter((u) => u.standDownRequest && u.standDownRequest.status === "pending")
        .map((u) => {
          const rq = u.standDownRequest;
          return (
            <div key={`sd-${u.id}`} style={styles.oosAsk}>
              <div style={styles.oosAskHead}>
                {u.name} asks to stand {rq.name} down from {seatLabel(rq.seat)}
              </div>
              <div style={styles.oosAskWhy}>
                {rq.reason}
                <span style={styles.oosAskWho}>
                  {" "}· asked by {rq.byName} at {clockStr(rq.askedAt)}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button style={styles.primaryBtnSm} onClick={() => answerStandDown(u, true)}>
                  Approve
                </button>
                <button style={styles.ghostBtnSm} onClick={() => answerStandDown(u, false)}>
                  Refuse
                </button>
              </div>
            </div>
          );
        })}

      {/* Somebody waiting for a seat whose holder has not answered. Asked on
          the holder's own phone first; the desk steps in only when that
          prompt goes unanswered — a dead phone must not hold a seat all day. */}
      {stationUnits
        .flatMap((u) => ["alpha", "bravo"].map((slot) => ({ u, slot, r: handoverRequest(u, slot) })))
        .filter(({ u, slot, r }) => handoverIsPending(r) && u[slot] && u[slot].accountId !== r.accountId)
        .map(({ u, slot, r }) => (
          <div key={`ho-${u.id}-${slot}`} style={styles.oosAsk}>
            <div style={styles.oosAskHead}>
              {r.name} is waiting to take over {u[slot].name}'s seat — {u.name} · {seatLabel(slot)}
              <span style={{ marginLeft: 8, fontWeight: 800, color: liveRequestFor(u, requests) ? "var(--crit)" : "var(--ok)" }}>
                {liveRequestFor(u, requests) ? "● ON A CALL" : "○ not on a call"}
              </span>
            </div>
            <div style={styles.oosAskWhy}>
              Asked at {clockStr(r.queuedAt)} · {u[slot].name} has not answered on their phone.
              <span style={styles.oosAskWho}>
                {" "}Handing over here signs {u[slot].name} off now and is recorded as the desk's decision.
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button style={styles.primaryBtnSm} onClick={() => forceHandover(u, slot)}>
                Hand over now
              </button>
              <button style={styles.ghostBtnSm} onClick={() => withdrawHandover(u, slot)}>
                Withdraw the request
              </button>
            </div>
          </div>
        ))}

      {/* Trucks asking to come off the run. Answered here because taking an
          ambulance off is a decision about the department's cover, and this is
          the screen where that cover is visible. */}
      {stationUnits.filter((u) => oosRequestOf(u)).map((u) => {
        const rq = oosRequestOf(u);
        return (
          <div key={u.id} style={styles.oosAsk}>
            <div style={styles.oosAskHead}>
              {u.name} asks to go out of service
            </div>
            <div style={styles.oosAskWhy}>
              {rq.reason}
              {rq.note ? ` — ${rq.note}` : ""}
              <span style={styles.oosAskWho}>
                {" "}· {rq.byName} at {clockStr(rq.askedAt)}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button style={styles.primaryBtnSm} onClick={() => answerOos(u, true)}>
                Approve — take it off
              </button>
              <button style={styles.ghostBtnSm} onClick={() => answerOos(u, false)}>
                Refuse
              </button>
            </div>
          </div>
        );
      })}

      {/* Trucks the desk has already taken off the run, so putting one back is
          on the same screen as taking it off rather than only on the crew's
          tablet. Empty trucks are not listed: they are off because nobody is
          signed on, and that is not something the desk can undo. */}
      {stationUnits
        .filter((u) => u.status === "oos" && isStaffed(u) && !oosRequestOf(u))
        .map((u) => (
          <div key={u.id} style={styles.oosOffRun}>
            <div style={styles.oosOffRunHead}>
              <span>{u.name} is off the run</span>
              {u.oosRequest && u.oosRequest.reason && (
                <span style={styles.oosAskWho}>
                  {" "}· {u.oosRequest.reason}
                  {u.oosRequest.answeredAt ? ` since ${clockStr(u.oosRequest.answeredAt)}` : ""}
                </span>
              )}
            </div>
            <button style={styles.primaryBtnSm} onClick={() => returnToService(u)}>
              Put back in service
            </button>
          </div>
        ))}

      {/* Anything a crew has reported wrong that is still waiting on the desk —
          including on calls that have already closed. Scoped to this station:
          the other desk answers its own. */}
      <PendingEditsInbox
        requests={stationRequests}
        units={stationUnits}
        user={user}
        saveRequests={saveRequests}
        addLog={addLog}
      />

      {/* A crew on scene asking for a second ambulance goes to the top of the
          desk, above the calls themselves: it is the only alert here that
          nobody but dispatch can act on. */}
      <AssistanceTasks
        user={user}
        units={stationUnits}
        requests={stationRequests}
        saveUnits={saveUnits}
        saveRequests={saveRequests}
        addLog={addLog}
        audioCtxRef={audioCtxRef}
      />

      {/* Staffing, stated separately from the status colours. "Nothing
          available" and "nobody signed on" are different problems and the desk
          needs to be able to tell them apart at a glance. */}
      <div style={styles.staffingLine}>
        {inService.length === 0 ? (
          <span style={styles.staffingWarn}>No crew signed on to any team yet.</span>
        ) : (
          <span>
            <strong style={styles.staffingStrong}>{inService.length}</strong> of {units.length}{" "}
            {units.length === 1 ? "team" : "teams"} staffed ·{" "}
            <strong style={styles.staffingStrong}>{assignable.length}</strong> free to assign
          </span>
        )}
        {unassigned.length > 0 && (
          <span style={styles.staffingWarn}>
            {" "}· {unassigned.length} {unassigned.length === 1 ? "call" : "calls"} still waiting for a
            team
          </span>
        )}
      </div>

      {/* One way to raise a call. The button in the bar is the one that does it
          now; a second control here saying the same thing in different words is
          how a desk ends up unsure which one is real. */}
      <SectionBanner
        title="ACTIVE CALLS"
        action={showForm && (
          <button
            style={styles.bannerBtn}
            onClick={() => {
              // Nothing has been raised yet, so there is nothing to record —
              // but a desk that has typed a location and a nature should not
              // lose it to a mis-tap.
              const typed =
                locationFrom.trim() || locationTo.trim() || nature.trim() || mrn.trim() || callKind;
              if (typed && !window.confirm("Discard this call? Nothing has been raised yet.")) return;
              setShowForm(false);
            }}
          >
            Cancel
          </button>
        )}
      />

      {showForm && (
        <div style={styles.requestForm}>
          {/* The first thing asked, because it decides whether this call is
              measured against the ten-minute standard at all.
              A desk raising an emergency at speed can answer this in one tap and
              fill the rest in later; the response indicator counts what was
              declared here, narrowed to internal once the category is set. */}
          <div style={styles.kindRow}>
            {/* Internal is the one measured against the ten minutes, so it
                carries the emergency red. External is an emergency too, but a
                drive rather than a corridor — amber says urgent without saying
                the same thing. */}
            {[
              { key: "internal", label: "EMERGENCY (INTERNAL)", color: "var(--crit)", cat: "EMERGENCY (INTERNAL)" },
              { key: "external", label: "EMERGENCY (EXTERNAL)", color: "var(--hold)", cat: "EMERGENCY (EXTERNAL)" },
              { key: "scheduled", label: "SCHEDULED CALL", color: "var(--flow)", cat: "ROUTINE" },
            ].map((k) => {
              const on = callKind === k.key;
              return (
                <button
                  key={k.key}
                  style={{
                    ...styles.kindBtn,
                    ...(on
                      ? { background: k.color, color: "var(--ground)", borderColor: k.color, fontWeight: 800 }
                      : { color: k.color, borderColor: `${k.color}55` }),
                  }}
                  onClick={() => {
                    setCallKind(k.key);
                    setCallCategory(k.cat);
                    // An emergency, inside the campus or out, is an ALS run.
                    if (k.key !== "scheduled") setPriority("als");
                  }}
                >
                  {k.label}
                </button>
              );
            })}
          </div>

          {/* Where the patient is, in the department's own words. Typed freely
              this became "ER", "Emergency", "emergency bldg" and three other
              spellings of one building, and the month-end count had to be done
              by eye. Picking from the sheet's own list means the statistics add
              up on their own. */}
          <div style={styles.formRow}>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Where is the patient coming from?</label>
              <select
                style={styles.input}
                value={patientOrigin}
                onChange={(e) => setPatientOrigin(e.target.value)}
              >
                <option value="">Not stated yet</option>
                {PATIENT_ORIGINS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Call category</label>
              <select
                style={styles.input}
                value={callCategory}
                onChange={(e) => setCallCategory(e.target.value)}
              >
                <option value="">Not stated yet</option>
                {CALL_CATEGORIES.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={styles.formRow}>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Location from (pick-up) — required</label>
              <input
                style={{ ...styles.input, ...(missingFields.includes("locationFrom") ? styles.inputMissing : null) }}
                value={locationFrom}
                onChange={(e) => {
                  setLocationFrom(e.target.value);
                  if (e.target.value.trim()) setMissingFields((m) => m.filter((x) => x !== "locationFrom"));
                }}
                placeholder="e.g. Ward 4B, Bed 12"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Location to (destination)</label>
              <input style={styles.input} value={locationTo} onChange={(e) => setLocationTo(e.target.value)} placeholder="Can be added later" />
            </div>
          </div>
          <div style={styles.formRow}>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Nature of call</label>
              <input
                style={{ ...styles.input, ...(missingFields.includes("nature") ? styles.inputMissing : null) }}
                value={nature}
                onChange={(e) => {
                  setNature(e.target.value);
                  if (e.target.value.trim()) setMissingFields((m) => m.filter((x) => x !== "nature"));
                }}
                placeholder="e.g. Chest pain, 54M"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Level of care</label>
              <select style={styles.input} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITY_CHOICES.map((k) => [k, PRIORITY[k]]).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}{v.desc ? ` — ${v.desc}` : ""}
                  </option>
                ))}
              </select>
              {/* The desk sets the priority but the crew's tablet is what has to
                  make the noise, so hearing the tone before the call goes out is
                  the only way to know which of the three is on its way. */}
              <AlertToneCheck
                audioCtxRef={audioCtxRef}
                priority={priority}
                label="Alert tone"
                style={{ marginTop: 7 }}
              />
            </div>
          </div>
          <div style={styles.formRow}>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>MRN</label>
              <input style={styles.input} value={mrn} onChange={(e) => setMrn(e.target.value)} placeholder="Medical record number" />
            </div>
          </div>
          <CallCodingFields
            callType={callType}
            setCallType={setCallType}
            loadedKm={loadedKm}
            setLoadedKm={setLoadedKm}
          />
          <InfoNote label="What can be left for later?">
            Only the pick-up point is needed to send an ambulance. The destination, the nature of the
            call, the MRN and the two codes can all be left blank — the crew set them from the truck,
            or the desk fills them in when the ward rings back, and either can correct the other.
          </InfoNote>

          <div>
            <label style={styles.label}>Requirements</label>
            <div style={styles.checklistRow}>
              {REQUIREMENTS.map((r) => (
                <label key={r.key} style={requirements.includes(r.key) ? styles.checkPillActive : styles.checkPill}>
                  <input
                    type="checkbox"
                    checked={requirements.includes(r.key)}
                    onChange={() => toggleRequirement(r.key)}
                    style={styles.checkboxInput}
                  />
                  {r.label}
                </label>
              ))}
            </div>
            {/* Ticking "Other" on its own tells the crew nothing. The box only
                appears once it is ticked, and what is typed here is what shows
                on the call and on the log sheet instead of the bare word. */}
            {requirements.includes("other") && (
              <input
                style={{ ...styles.input, marginTop: 8 }}
                value={reqOther}
                onChange={(e) => setReqOther(e.target.value)}
                placeholder="What else is needed? e.g. bariatric stretcher, incubator, isolation precautions"
              />
            )}
          </div>

          <div>
            <label style={styles.label}>Select Team (optional — can assign later)</label>
            <select style={styles.input} value={selectedTeam} onChange={(e) => setSelectedTeam(e.target.value)}>
              <option value="">No team selected yet</option>
              {stationUnits.map((u) => {
                const onCall = isOnCall(u, requests);
                const note = onCall
                  ? `on a call — ${effectiveStatusMeta(u, requests).label.toLowerCase()}`
                  : assignableNote(u);
                return (
                  <option key={u.id} value={u.id} disabled={onCall}>
                    {u.name}{note ? ` (${note})` : ""}
                  </option>
                );
              })}
            </select>
            {assignable.length === 0 && (
              <InfoNote label="More about this">
                Every team is out on a call. Raise the call without a team and assign one as soon as a
                team clears.
              </InfoNote>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button style={styles.primaryBtn} onClick={submitRequest}>Dispatch call</button>
            {missingFields.length > 0 && (
              <div style={styles.requiredNote}>
                Where the patient is coming from is needed before a call can go out.
              </div>
            )}
            <button style={styles.ghostBtn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {active.length === 0 && <div style={styles.emptyState}>No active calls. The board is clear.</div>}

      {/* Tiles until one is opened.
          A board with nine calls ran to several screens as full cards, and
          finding the one the phone is about meant scrolling past the other
          eight. Tiles put them all in view at once; tapping one gives back
          exactly the card it always was. */}


      {!active.some((r) => r.id === openCallId) && (
        <React.Fragment>
          {/* Only the trucks that are working. A standing ambulance needs no
              row of its own — it needs one word, once, at the bottom. */}
          {working.length > 0 && (
            <div style={styles.boardSquare}>
              <div style={styles.boardSquareHead}>
                <span style={styles.boardSquareTitle}>OUT ON A CALL</span>
                <span style={styles.boardSquareCount}>{working.length}</span>
              </div>
              <div style={styles.callCardGrid}>
                {working.map(({ unit, req }) => (
                  <FleetRow
                    key={unit.id}
                    unit={unit}
                    req={req}
                    now={nowTick}
                    onOpen={() => setOpenCallId(req.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {working.length === 0 && waiting.length === 0 && (
            <div style={styles.calmBoard}>
              <div style={styles.calmTitle}>Nothing running</div>
              <div style={styles.calmSub}>
                {standing.length} {standing.length === 1 ? "team" : "teams"} at station.
              </div>
            </div>
          )}

          {/* Its own square, and the same card as an ambulance carries.
              These used to be a striped amber strip of one-line rows, which a
              desk read as a warning banner rather than as a queue of calls it
              could pick up and give to somebody. */}
          {!active.some((r) => r.id === openCallId) && waiting.length > 0 && (
            <div style={styles.boardSquareWaiting}>
              <div style={styles.boardSquareHead}>
                <span style={styles.boardSquareTitleWait}>WAITING FOR A TEAM</span>
                <span style={styles.boardSquareCountWait}>{waiting.length}</span>
              </div>
              <div style={styles.callCardGrid}>
                {waiting.map((r) => (
                  <PendingCallCard
                    key={r.id}
                    req={r}
                    now={nowTick}
                    onOpen={() => setOpenCallId(r.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {standing.length > 0 && (
            <div style={styles.standingRow}>
              {standing.map((u) => (
                <span key={u.id} style={styles.standingChip}>
                  {u.name}
                </span>
              ))}
            </div>
          )}
        </React.Fragment>
      )}

      {active.some((r) => r.id === openCallId) && (
        <button style={styles.tileBackBtn} onClick={() => setOpenCallId(null)}>
          ← All {active.length} active {active.length === 1 ? "call" : "calls"}
        </button>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {active.filter((r) => r.id === openCallId).map((req) => {
          const assignedUnit = units.find((u) => u.id === req.assignedUnitId);
          return (
            <div key={req.id} style={{ ...styles.callCard, borderLeftColor: PRIORITY[priorityKeyOf(req)].color }}>
              <div style={styles.callCardTop}>
                <div style={styles.callCardNature}>{req.nature}</div>
                <span style={{ ...styles.pill, background: PRIORITY[priorityKeyOf(req)].color }}>{PRIORITY[priorityKeyOf(req)].label}</span>
              </div>
              <div style={styles.callCardMeta}>
                <CallRoute req={req} />
                <span style={styles.callCardMetaItem}><Clock size={12} /> {hhmm(req.createdAt)}</span>
                <span style={{ ...styles.pill, background: reqStatusMeta(req.status).color }}>{reqStatusMeta(req.status).label}</span>
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
              </div>
              {/* Where this call has got to, as five segments. The status pill
                  above already names the stage; this says how far through the
                  call that is, which is the thing a desk deciding whether to
                  wait for this truck or start looking for another one actually
                  wants. Reading it takes no words. */}
              <CallProgress req={req} />

              {/* Came in from the shift before. The next desk needs to know at a
                  glance that this one is not theirs to file — it stays on the
                  log of the shift that took it. */}
              {req.handover && (
                <div style={styles.handoverTag}>
                  <ArrowRight size={11} style={{ verticalAlign: -1, marginRight: 5 }} />
                  HANDED OVER from the {req.handover.fromShiftLabel} ({req.handover.fromDay})
                  {req.handover.by ? ` by ${req.handover.by}` : ""} · stays on that shift's log
                </div>
              )}

              {/* The MRN line is worth saying out loud when it is missing. A call
                  can go out without one and often has to — this is the reminder
                  that it still needs filling in, and the way in to do it. */}
              {req.mrn ? (
                <div style={styles.mrnRow}>MRN: {req.mrn}</div>
              ) : (
                <div style={styles.mrnMissingRow}>
                  <AlertTriangle size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                  No MRN yet — add it from "Correct call details" once the ward gives it.
                </div>
              )}
              {req.notes && <div style={styles.mrnRow}>{req.notes}</div>}
              {req.requirements && req.requirements.length > 0 && (
                <div style={styles.checklistRow}>
                  {reqLabels(req).map((label, i) => (
                    <span key={i} style={styles.reqBadge}>{label}</span>
                  ))}
                </div>
              )}

              {/* Who took the patient, when the crew has recorded it. Read-only
                  here: the desk was not in the room. */}
              {req.receiver && <ReceiverBanner req={req} canEdit={false} onSave={() => {}} />}

              {/* Anything a crew has reported wrong on this call, waiting on the
                  desk to confirm or turn down. */}
              <PendingEditReview
                req={req}
                onVerify={(e) => verifyCallEdit(req, e, true)}
                onReject={(e) => verifyCallEdit(req, e, false)}
              />
              <EditHistory req={req} />

              {editingCallId === req.id ? (
                <CallEditForm
                  req={req}
                  mode="apply"
                  onSubmit={(changes, note) => applyCallEdits(req, changes, note)}
                  onCancel={() => setEditingCallId(null)}
                />
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button style={styles.editOpenBtn} onClick={() => setEditingCallId(req.id)}>
                    <PencilLine size={12} /> Correct call details
                  </button>
                  {/* Only while nobody is on it.
                      A call a crew has been dispatched to is theirs until they
                      clear it — it cannot be handed to a shift that has not
                      started, and offering to do so invited a desk to try. Once
                      it is already marked over, the option to take it back stays
                      so a change of mind is possible. */}
                  {req.status !== "completed" &&
                    (req.handover || !req.assignedUnitId) && (
                      <button
                        style={req.handover ? styles.handBackBtn : styles.handOverBtn}
                        onClick={() => handToNextShift(req)}
                      >
                        <ArrowRight size={12} />{" "}
                        {req.handover ? "Take back onto this shift" : "Hand to next shift"}
                      </button>
                    )}
                  {req.status !== "completed" && req.assignedUnitId && !assistPending(req) && (
                    <button style={styles.deskAssistBtn} onClick={() => dispatchRaisesAssist(req)}>
                      <Ambulance size={12} /> Send help to this team
                    </button>
                  )}
                </div>
              )}

              <CallTimes times={req.times} req={req} />
              <AssistStatusLine req={req} units={units} />

              {/* Coding, opened on the call being worked rather than laid out on
                  every card at once: a desk with ten calls up needs to read them,
                  not wade through sixty code buttons. What is already coded shows
                  as a tag above; what isn't says so plainly. */}
              {codingFor === req.id ? (
                <CallCodingBlock req={req} onSet={(field, value) => setCoding(req.id, field, value)} />
              ) : (
                <div style={styles.codingClosedRow}>
                  {!callTypeOf(req) && <span style={styles.codeMissingTag}>TYPE NOT SET</span>}
                  {!loadedKmOf(req) && <span style={styles.codeMissingTag}>LOADED KM NOT SET</span>}
                  <button style={styles.ghostBtnSm} onClick={() => setCodingFor(req.id)}>
                    <Tag size={12} />{" "}
                    {callTypeOf(req) || loadedKmOf(req) ? "Change call type / km" : "Set call type & km"}
                  </button>
                </div>
              )}
              {codingFor === req.id && (
                <button style={{ ...styles.ghostBtnSm, marginTop: 8 }} onClick={() => setCodingFor(null)}>
                  Done coding
                </button>
              )}
              <div style={styles.callCardActions}>
                {/* Assignable until the crew rolls.
                    A desk assigns on what it knows at the time, and thirty
                    seconds later a nearer truck clears or the first one turns
                    out to be blocked in. Until somebody is en route nothing has
                    happened yet, so the choice can still be changed; once they
                    are moving it is theirs. */}
                {(req.status === "pending" || req.status === "assigned") && (
                  assignable.length > 0 ? (
                    <select
                      style={styles.assignSelect}
                      defaultValue=""
                      onChange={(e) => e.target.value && assignUnit(req.id, e.target.value)}
                    >
                      <option value="">
                        {req.status === "assigned" ? "Change team…" : "Assign team…"}
                      </option>
                      {assignable.map((u) => {
                        const note = assignableNote(u);
                        return (
                          <option key={u.id} value={u.id}>
                            {u.name}{note ? ` — ${note}` : ""}
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <span style={styles.pendingAckTag}>
                      Every team is out on a call — this one is queued and can be assigned the moment
                      one clears.
                    </span>
                  )
                )}
                {assignedUnit && <span style={styles.assignedTag}>{assignedUnit.name}</span>}
                {/* Whether the alert actually got through. Until the crew press
                    acknowledge, their screen is still sounding — and if this
                    tag stays up, the desk knows to reach them by radio rather
                    than assuming the call has landed. */}
                {req.status !== "pending" && req.assignedUnitId && (
                  req.acknowledged ? (
                    <span style={styles.ackTag}>
                      <CheckCircle2 size={12} /> Crew acknowledged
                    </span>
                  ) : (
                    <span style={styles.pendingAckTag}>
                      Alerting {assignedUnit ? assignedUnit.name : "the team"} — not acknowledged yet
                    </span>
                  )
                )}
                {req.status !== "pending" && closingId !== req.id && (
                  <button style={styles.ghostBtnSm} onClick={() => openClose(req)}>
                    <CheckCircle2 size={13} /> Close call
                  </button>
                )}
              </div>

              {/* The banner the desk answers before a call can be closed. It
                  sits on the card itself rather than in a dialog, so the call
                  being closed — its route, its team, its timeline — stays in
                  front of whoever is saying how it ended. */}
              {closingId === req.id && (
                <div style={styles.cancelReasonBanner}>
                  <div style={styles.cancelReasonHead}>
                    <CheckCircle2 size={12} /> WHY IS THIS CALL BEING CLOSED?
                  </div>
                  <div style={styles.cancelReasonNote}>
                    {assignedUnit
                      ? `${assignedUnit.name} goes back on the board the moment it closes.`
                      : "No team is on this call."}
                  </div>
                  <div style={styles.checklistRow}>
                    {CALL_CLOSE_REASONS.map((r) => (
                      <button
                        key={r}
                        style={closeReason === r ? styles.reasonPillActive : styles.reasonPill}
                        onClick={() => {
                          setCloseReason(r);
                          setCloseError("");
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <input
                    style={{ ...styles.input, marginTop: 8 }}
                    value={closeReason}
                    maxLength={CALL_CLOSE_REASON_MAX}
                    placeholder="Reason for closing — pick one above or type it"
                    onChange={(e) => {
                      setCloseReason(e.target.value);
                      setCloseError("");
                    }}
                  />
                  {closeError && <div style={styles.loginError}>{closeError}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <button style={styles.primaryBtnSm} onClick={() => closeRequest(req.id)}>
                      <CheckCircle2 size={12} /> Close the call
                    </button>
                    <button style={styles.ghostBtnSm} onClick={cancelClose}>
                      Keep the call open
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
        </>
      )}

      {/* Teams: the roster and what is booked for them. */}
      {/* Teams: who is on, and nothing else. Bookings moved off this page —
          they are work waiting to happen, not a fact about the roster. */}
      {onPage("teams") && (
        <>
          <SectionBanner title="UNITS" icon={<Users size={13} />} count={stationUnits.length} countLabel={stationUnits.length === 1 ? "medic" : "medics"} />
          <div style={styles.unitGrid}>
            {stationUnits.map((u) => (
              <UnitRosterCard key={u.id} unit={u} />
            ))}
          </div>
        </>
      )}

      {/* Schedule: what is coming, then what has been.
          Bookings first because they are the only part of this page anybody
          still has to act on; the closed calls underneath are the record of the
          ones that already went out. */}
      {onPage("history") && (
        <>
          <ScheduledRequests
            user={user}
            units={stationUnits}
            requests={stationRequests}
            scheduled={stationScheduled}
            allScheduled={scheduled}
            saveScheduled={saveScheduled}
            addLog={addLog}
            audioCtxRef={audioCtxRef}
          />

          {/* This shift and the one before it.
              A desk was being shown every call the station had run since the
              app was installed. What it needs is its own work and the shift it
              took over from — anything older belongs to the archive, where it
              can be found by date. A search still reaches the whole record. */}
          <CompletedCalls
            requests={stationRequests}
            units={stationUnits}
            saveRequests={saveRequests}
            addLog={addLog}
            user={user}
            shiftWindow={{
              start: (user.shiftStart || shiftWindowAt(Date.now()).start) - SHIFT_MS,
              end: user.shiftEnd || (user.shiftStart || shiftWindowAt(Date.now()).start) + SHIFT_MS,
            }}
            canCorrect
          />

          {/* Calls that ran while the board was not there. It belongs on this
              page because this is where the shift's closed calls are read, and
              a desk writing one up is filling a hole in exactly that list. */}
          <PastCallSection
            user={user}
            units={stationUnits}
            log={log}
            saveRequests={saveRequests}
            addLog={addLog}
          />

          {/* Who the department has moved before.
              A booking phoned through is nine tenths of the time a patient the
              board has already carried, and until this the desk had no way to
              find that out. It sits under the schedule because that is where
              somebody is standing when they take the call. */}
          <PatientRecords
            requests={stationRequests}
            scheduled={stationScheduled}
            archives={archives}
            units={stationUnits}
          />
        </>
      )}
    </div>
  );
}

export function UnitRosterCard({ unit, onRelieve, onGrantOt, requests, onRename, onRemove }) {
  const now = Date.now();
  return (
    <div style={styles.unitCard}>
      {/* Status twice over: a bar the full width of the card, and the word
          beneath it. The bar is what carries across a room and what still works
          for somebody who cannot separate the greens from the reds; the word is
          what makes it unambiguous close up. Neither alone was enough. */}
      <div style={{ ...styles.unitCardBar, background: effectiveStatusMeta(unit, requests).color }} />
      <div style={styles.unitCardBody}>
        <div style={styles.unitCardTop}>
          <span style={styles.unitCardName}>{unit.name}</span>
          {unit.ambulanceNumber && (
            <span style={styles.unitCardAmbulance}>#{unit.ambulanceNumber}</span>
          )}
        </div>
        <div style={styles.unitCardStatusRow}>
          <span
            style={{ ...styles.unitCardDot, background: effectiveStatusMeta(unit, requests).color }}
          />
          <span style={{ ...styles.unitCardStatusText, color: effectiveStatusMeta(unit, requests).color }}>
            {effectiveStatusMeta(unit, requests).label}
          </span>
        </div>
        {!isStaffed(unit) && <span style={styles.unitCardNoCrew}>NO CREW SIGNED ON</span>}
      <SeatLine
        label="Alpha"
        member={unit.alpha}
        unit={unit}
        slot="alpha"
        onRelieve={onRelieve}
        onGrantOt={onGrantOt}
        requests={requests}
        now={now}
      />
      <SeatLine
        label="Bravo"
        member={unit.bravo}
        unit={unit}
        slot="bravo"
        onRelieve={onRelieve}
        onGrantOt={onGrantOt}
        requests={requests}
        now={now}
      />

      {/* Only where an administrator is looking at the fleet, and only quietly:
          these are rarely used and should not compete with the crew. */}
      {(onRename || onRemove) && (
        <div style={styles.unitCardAdmin}>
          {onRename && (
            <button style={styles.unitCardAdminBtn} onClick={onRename}>
              Rename
            </button>
          )}
          {onRemove && (
            <button style={styles.unitCardRemoveBtn} onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

// One crew seat on a roster card: who's in it, which shift they signed on for,
// and — when they're past the end of their 12 hours — how much overtime they're
// into. Seats taken before shifts were tracked simply show no shift tag.
export function SeatLine({ label, member, unit, slot, onRelieve, onGrantOt, requests, now }) {
  const meta = member ? shiftMeta(member.shift) : null;
  const ot = member ? overtimeMs(member, Date.now()) : 0;
  // Somebody queued to take this seat when its crew clear.
  const waiting = unit && slot ? queuedReliefFor(unit, slot) : null;
  // The desk may sign a seat out whenever the truck is NOT out on a call:
  // a shift that ended without a sign-off (forgot-to-sign-out), and now an
  // on-shift seat too — a crew whose phone was signed out (the one-phone rule,
  // a lost handset, going home early) leaves a seat that shows AVAILABLE with
  // no live phone behind it, and until this only shift-end could clear it.
  // "still-out" stays excluded: standing a crew down from the desk must never
  // take a running call off them.
  const situation =
    unit && slot && now ? reliefSituationFor(unit, slot, requests || [], now) : "free";
  const canRelieve = !!onRelieve && !!member && (situation === "forgot-to-sign-out" || situation === "on-shift");
  return (
    <div style={styles.unitMemberRow}>
      <span style={styles.unitMemberLabel}>{label}</span>
      <span style={styles.unitMemberRight}>
        <span style={styles.unitMemberName}>{member ? member.name : "—"}</span>
        {meta && (
          <span style={{ ...styles.shiftTag, color: meta.color, borderColor: meta.color }}>
            {meta.glyph} {meta.short}
          </span>
        )}
        {ot > 0 && <span style={styles.otTag}>OT {shortDurationStr(ot)}</span>}
        {/* Somebody is signed on and waiting for this seat. */}
        {waiting && <span style={styles.reliefTag}>relief: {waiting.name}</span>}
        {/* Their shift ended and the truck is not out — there is nothing to wait
            for, so administration can clear the seat. Deliberately not offered
            while they are on a call: that is overtime, not forgetfulness. */}
        {canRelieve && (
          <button style={styles.relieveBtn} onClick={() => onRelieve(unit, slot, member)}>
            Sign out
          </button>
        )}
        {/* Called in on a rest day, or held over for a whole tour. Only where
            administration is looking, and only against somebody actually in the
            seat — there is no shift to count otherwise. */}
        {onGrantOt && member && (
          <button style={styles.grantOtBtn} onClick={() => onGrantOt(unit, slot, member)}>
            Whole shift as OT
          </button>
        )}
      </span>
    </div>
  );
}