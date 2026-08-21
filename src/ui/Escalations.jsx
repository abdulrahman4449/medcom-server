import { callFrom, callRoute, callTo } from "../domain/call-locations.jsx";
import { callCloseReason, callWasCancelled } from "../domain/close-reasons.jsx";
import { PRIORITY, REQ_STATUS, TIME_STEPS, applyCallEditsTo, canProposeEditOn, editFieldLabel, editValueText, pendingCallEdits, priorityKeyOf, proposeCallEditsTo, reqLabels, verifyCallEditOn } from "../domain/constants.jsx";
import { ESCALATION_MAX, canRaiseEscalationOn, escalatedCalls, escalationAwaitsAdmin, escalationIsOpen, escalationReplies, escalationStateMeta, escalationsOf, pendingEscalationCount, raiseEscalation, replyToEscalation, setEscalationResolution, visibleEscalations } from "../domain/escalations.jsx";
import { clockStr, msDurationStr, notifyEscalation } from "../domain/messages.jsx";
import { pcrAuthorText } from "../domain/pcr-author.jsx";
import { assistTeamNames, isAssistingUnit, isNoTransport } from "../domain/second-ambulance.jsx";
import { callsNeedingDetail, missingLogFields } from "../domain/sheet-gaps.jsx";
import { applyCallCoding, callTypeOf, loadedKmOf } from "../domain/sheet-vocabulary.jsx";
import { hhmm, scheduledShiftKey, seatLabel, shiftMeta, shiftWindowAt } from "../domain/shift-helpers.jsx";
import { SHIFT_MS } from "../domain/shifts.jsx";
import { callBusyMs } from "../domain/uhu.jsx";
import { MONTH_LABELS, WEEKDAY_LABELS, gregDateStr, gregShortDateTimeStr } from "../lib/dates.jsx";
import { AlertTriangle, Archive, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, CircleSlash, Clock, HandRaised, MessageSquare, PencilLine, Reply, Search, ShieldAlert, Tag } from "../lib/icons.jsx";
import { readKey } from "../lib/offline-queue.jsx";
import { useEffect, useRef, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { CallEditForm, CallRoute, EditHistory, InfoNote, PendingEditReview, ReceiverBanner } from "./AssistanceTasks.jsx";
import { addMonths, monthGrid, startOfMonth } from "./ScheduledRequests.jsx";
import { AssistStatusLine, CallCodingBlock, CallTimes, CallTypeTag, CancelledTag, LoadedKmTag, NoTransportTag, PcrAuthorTag } from "./StatusBoard.jsx";
import { startOfDay } from "./booking-cancel.jsx";

// ---------- completed calls ----------
//
// Closing a call used to take it off the board completely: the card vanished
// from the desk and the crew's screen, and the only trace left was a sentence
// on the log sheet. Nothing was ever deleted — every call raised is still in
// `ems:requests` — so completed calls are kept on the board instead, where
// dispatch and admin can go back over the shift with the full timeline, the
// team that ran the call and how long it tied them up. Crews still only see
// the call they are on now.
// ---------- the escalation banner and its thread ----------
//
// The banner sits in the top-right corner of the call card, beside the priority
// pill — the one part of every card that is the same everywhere, so a crew
// looking for it always look in the same place whether the call is live on
// their tablet or three weeks deep in their history. It is deliberately quiet
// until there is something on it: an escalation is rare, and a loud red button
// on every card would be pressed by accident on a moving ambulance.
export function EscalationChip({ req, viewer, open, onToggle }) {
  if (!viewer) return null;
  const mine = visibleEscalations(req, viewer);
  const canRaise = canRaiseEscalationOn(req, viewer);
  if (mine.length === 0 && !canRaise) return null;

  // What the chip reports is the issue that still wants something doing: the
  // oldest one nobody has closed. Only once they are all resolved does it fall
  // back to the last thing that happened.
  const unresolved = mine.filter(escalationIsOpen);
  const headline = unresolved[0] || mine[mine.length - 1];
  const meta = headline ? escalationStateMeta(headline, viewer.role) : null;
  const extra = mine.length > 1 ? ` ·${mine.length}` : "";

  if (!headline) {
    return (
      <button style={styles.escChipQuiet} onClick={onToggle} title="Report a problem with this call to the admins">
        <ShieldAlert size={11} /> {open ? "CLOSE" : "ESCALATE"}
      </button>
    );
  }
  return (
    <button
      style={{ ...styles.escChip, borderColor: meta.color, color: meta.color, background: `${meta.color}1F` }}
      onClick={onToggle}
      title={`${mine.length} issue${mine.length === 1 ? "" : "s"} escalated on this call`}
    >
      <ShieldAlert size={11} /> ISSUE {meta.label}{extra}
    </button>
  );
}

// The thread itself, opened from the chip and drawn at the foot of the card it
// belongs to. Everything about one call's issues is here: what was raised, who
// raised it, what the admins said back, and — for an admin — the reply box and
// the button that closes it off.
export function EscalationThread({ req, viewer, requests, saveRequests, addLog, onClose }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replyFor, setReplyFor] = useState(null);
  const [replyDraft, setReplyDraft] = useState("");

  if (!viewer) return null;
  const mine = visibleEscalations(req, viewer);
  const canRaise = canRaiseEscalationOn(req, viewer);
  const isAdmin = viewer.role === "admin";

  async function submitNew() {
    const text = draft.trim();
    if (!text) {
      setError("Write what went wrong before sending it.");
      return;
    }
    setBusy(true);
    setError("");
    const ok = await raiseEscalation({ req, message: text, viewer, requests, saveRequests, addLog });
    setBusy(false);
    if (!ok) {
      setError("That didn't send. Try again.");
      return;
    }
    setDraft("");
  }

  async function submitReply(escId) {
    const text = replyDraft.trim();
    if (!text) return;
    setBusy(true);
    await replyToEscalation({ req, escId, message: text, viewer, requests, saveRequests, addLog });
    setBusy(false);
    setReplyDraft("");
    setReplyFor(null);
  }

  async function toggleResolved(esc) {
    setBusy(true);
    await setEscalationResolution({
      req,
      escId: esc.id,
      resolved: escalationIsOpen(esc),
      viewer,
      requests,
      saveRequests,
      addLog,
    });
    setBusy(false);
  }

  return (
    <div style={styles.escPanel}>
      <div style={styles.escPanelHead}>
        <span style={styles.escPanelTitle}>
          <ShieldAlert size={12} /> ESCALATED TO ADMIN
        </span>
        {onClose && (
          <button style={styles.ghostBtnSm} onClick={onClose}>
            Close
          </button>
        )}
      </div>

      {mine.length === 0 && (
        <div style={styles.escEmpty}>
          Nothing has been escalated on this call.
        </div>
      )}

      {mine.map((esc) => {
        const meta = escalationStateMeta(esc, viewer.role);
        const replies = escalationReplies(esc);
        return (
          <div key={esc.id} style={styles.escItem}>
            <div style={styles.escItemHead}>
              <span style={{ ...styles.escStatePill, borderColor: meta.color, color: meta.color }}>{meta.label}</span>
              <span style={styles.escItemWhen}>{gregShortDateTimeStr(esc.raisedAt)}</span>
              <span style={styles.escItemWho}>
                {esc.unitName || "—"}
                {esc.by && esc.by.name ? ` · ${esc.by.name}` : ""}
                {esc.by && esc.by.seat ? ` (${seatLabel(esc.by.seat)})` : ""}
              </span>
              {esc.afterClose && <span style={styles.escAfterTag}>RAISED AFTER THE CALL CLOSED</span>}
            </div>
            <div style={styles.escMessage}>{esc.message}</div>

            {replies.length > 0 && (
              <div style={styles.escReplies}>
                {replies.map((r) => (
                  <div key={r.id} style={r.role === "admin" ? styles.escReplyAdmin : styles.escReplyTeam}>
                    <div style={styles.escReplyHead}>
                      {r.role === "admin" ? "ADMIN" : "TEAM"}
                      {r.byName ? ` · ${r.byName}` : ""} · {gregShortDateTimeStr(r.ts)}
                    </div>
                    <div style={styles.escReplyBody}>{r.message}</div>
                  </div>
                ))}
              </div>
            )}

            {!escalationIsOpen(esc) && (
              <div style={styles.escResolvedNote}>
                Closed off{esc.resolvedBy ? ` by ${esc.resolvedBy}` : ""}
                {esc.resolvedAt ? ` · ${gregShortDateTimeStr(esc.resolvedAt)}` : ""}
              </div>
            )}

            <div style={styles.escItemActions}>
              {replyFor === esc.id ? (
                <React.Fragment>
                  <textarea
                    style={styles.escTextarea}
                    rows={2}
                    maxLength={ESCALATION_MAX}
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value)}
                    placeholder={isAdmin ? "Your reply to the crew…" : "Add to what you reported…"}
                  />
                  <button style={styles.primaryBtnSm} disabled={busy} onClick={() => submitReply(esc.id)}>
                    Send reply
                  </button>
                  <button
                    style={styles.ghostBtnSm}
                    onClick={() => {
                      setReplyFor(null);
                      setReplyDraft("");
                    }}
                  >
                    Cancel
                  </button>
                </React.Fragment>
              ) : (
                <React.Fragment>
                  <button
                    style={styles.ghostBtnSm}
                    onClick={() => {
                      setReplyFor(esc.id);
                      setReplyDraft("");
                    }}
                  >
                    <Reply size={12} /> {isAdmin ? "Reply to the crew" : "Add a note"}
                  </button>
                  {isAdmin && (
                    <button style={styles.ghostBtnSm} disabled={busy} onClick={() => toggleResolved(esc)}>
                      {escalationIsOpen(esc) ? (
                        <React.Fragment>
                          <CheckCircle2 size={12} /> Mark resolved
                        </React.Fragment>
                      ) : (
                        "Reopen"
                      )}
                    </button>
                  )}
                </React.Fragment>
              )}
            </div>
          </div>
        );
      })}

      {canRaise && (
        <div style={styles.escComposer}>
          <div style={styles.escComposerHead}>
            {mine.length > 0 ? "RAISE ANOTHER ISSUE ON THIS CALL" : "WHAT WENT WRONG ON THIS CALL?"}
          </div>
          {mine.length > 0 && (
            <InfoNote label="Is this a new issue?">
              This starts a brand-new issue, separate from the one(s) above. To continue an existing
              conversation instead, use "{isAdmin ? "Reply to the crew" : "Add a note"}" on that issue.
            </InfoNote>
          )}
          <textarea
            style={styles.escTextarea}
            rows={3}
            maxLength={ESCALATION_MAX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Ward would not release the patient for 40 minutes and the lift was out of service."
          />
          {error && <div style={styles.loginError}>{error}</div>}
          <div style={styles.escComposerActions}>
            <span style={{ flex: 1, minWidth: 180 }}>
              <InfoNote label="Who sees this?">
                Goes to the admins only. Dispatch and the other teams never see it. You'll see their
                reply here on this call.
              </InfoNote>
            </span>
            <button style={styles.primaryBtnSm} disabled={busy || !draft.trim()} onClick={submitNew}>
              <ShieldAlert size={13} /> Escalate to admin
            </button>
          </div>
        </div>
      )}

      {!canRaise && isAdmin && mine.length > 0 && (
        <InfoNote label="Who can see this?">
          Only the crew member who raised each issue can read your reply. It is not on the dispatch
          log and it is not on the shared spreadsheet.
        </InfoNote>
      )}
    </div>
  );
}

// Every open issue on the board, on the admin's screen, without them having to
// find the call it was raised on first. An issue raised on a call that closed
// last month would otherwise be somewhere near the bottom of a list of
// hundreds — which is exactly how a complaint goes unanswered.
export function EscalationInbox({ requests, units, viewer, saveRequests, addLog, embedded }) {
  const [openFor, setOpenFor] = useState(null);
  const [busyFor, setBusyFor] = useState(null);
  const seenRef = useRef(null);

  // What still needs the admin and nothing else. An issue they have already
  // answered, and an issue they have closed off, are both dealt with as far as
  // this screen is concerned, and keeping either here buries the two that still
  // need a reply under a fortnight of ones that don't — an inbox that never
  // empties stops being read. Answering or resolving one takes it off this
  // screen the moment it happens, and nothing is lost by that: the issue stays
  // on the call it was raised on, with its whole thread, and the call list
  // further down finds it again under "Escalated only" — live calls included.
  // If the crew write back after the admin's reply, it returns here — that is
  // the case where something is genuinely waiting again.
  const rows = escalatedCalls(requests, viewer, { pendingOnly: true });
  const pendingCount = pendingEscalationCount(requests, viewer);

  // The one thread the admin has unfolded stays on screen even after it stops
  // waiting on them — a card vanishing out from under the reply that was just
  // sent is disorienting, and they may still want to close it off before they
  // move on. It goes the moment they close the thread.
  const openRow =
    openFor && !rows.some((r) => r.req.id === openFor)
      ? escalatedCalls(requests, viewer).find((r) => r.req.id === openFor)
      : null;
  const shownRows = openRow ? rows.concat([openRow]) : rows;

  // A new issue landing while an admin is looking at something else. The first
  // pass only records what is already there — signing in to a fortnight of
  // history must not set off a fortnight of notifications. It follows the same
  // "waiting on the admin" rule as the list, so a crew coming back on a thread
  // the admin had answered is announced the same way the first message was.
  useEffect(() => {
    if (!viewer || viewer.role !== "admin") return;
    const ids = new Set();
    const fresh = [];
    (requests || []).forEach((req) => {
      escalationsOf(req)
        .filter(escalationAwaitsAdmin)
        .forEach((esc) => {
          ids.add(esc.id);
          if (seenRef.current && !seenRef.current.has(esc.id)) fresh.push({ req, esc });
        });
    });
    if (seenRef.current) fresh.forEach(({ req, esc }) => notifyEscalation(req, esc));
    seenRef.current = ids;
  }, [requests, viewer && viewer.role]);

  if (!viewer || viewer.role !== "admin") return null;

  // Closing an issue off without opening the thread first. Most of them are
  // read on the card and want nothing back, and making an admin unfold a thread
  // to press one button is how an inbox fills up.
  async function resolveAll(req, escalations) {
    setBusyFor(req.id);
    for (const esc of escalations.filter(escalationIsOpen)) {
      await setEscalationResolution({
        req,
        escId: esc.id,
        resolved: true,
        viewer,
        requests,
        saveRequests,
        addLog,
      });
    }
    setBusyFor(null);
  }

  return (
    <div>
      {/* Standing on its own it needs a heading; inside the issues section it
          does not, because the section above it already said what this is. */}
      {!embedded && (
        <div style={styles.sectionHeaderRow}>
          <div style={{ ...styles.sectionHeader, margin: 0 }}>
            <ShieldAlert size={14} style={{ marginRight: 6, verticalAlign: -2 }} /> ESCALATED ISSUES
            {pendingCount > 0 ? ` (${pendingCount} WAITING)` : ""}
          </div>
        </div>
      )}

      {shownRows.length === 0 ? (
        <div style={styles.emptyState}>
          Nothing waiting
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shownRows.map(({ req, escalations }) => {
            const unit = units.find((u) => u.id === req.assignedUnitId);
            const isOpen = openFor === req.id;
            const headline =
              escalations.filter(escalationAwaitsAdmin)[0] ||
              escalations.filter(escalationIsOpen)[0] ||
              escalations[escalations.length - 1];
            const meta = escalationStateMeta(headline, "admin");
            return (
              <div key={req.id} style={{ ...styles.callCard, borderLeftColor: meta.color }}>
                <div style={styles.callCardTop}>
                  <div style={styles.callCardNature}>{req.nature}</div>
                  <div style={styles.callCardTopRight}>
                    <span style={{ ...styles.escStatePill, borderColor: meta.color, color: meta.color }}>
                      {meta.label}
                      {escalations.length > 1 ? ` ·${escalations.length}` : ""}
                    </span>
                  </div>
                </div>
                <div style={styles.callCardMeta}>
                  <CallRoute req={req} />
                  <span style={styles.callCardMetaItem}>
                    <Clock size={12} /> {gregShortDateTimeStr(headline.raisedAt)}
                  </span>
                  <span style={styles.assignedTag}>{headline.unitName || (unit ? unit.name : "—")}</span>
                  {headline.by && headline.by.name && (
                    <span style={styles.escByTag}>{headline.by.name}</span>
                  )}
                  <span style={{ ...styles.pill, background: REQ_STATUS[req.status] ? REQ_STATUS[req.status].color : "#64748B" }}>
                    {REQ_STATUS[req.status] ? REQ_STATUS[req.status].label : "—"}
                  </span>
                </div>
                {!isOpen && <div style={styles.escPreview}>{headline.message}</div>}
                <div style={styles.callCardActions}>
                  <button style={styles.ghostBtnSm} onClick={() => setOpenFor(isOpen ? null : req.id)}>
                    <MessageSquare size={12} /> {isOpen ? "Hide the thread" : "Open and reply"}
                  </button>
                  {!isOpen && (
                    <button
                      style={styles.ghostBtnSm}
                      disabled={busyFor === req.id}
                      onClick={() => resolveAll(req, escalations)}
                      title="Close this off and take it off the inbox"
                    >
                      <CheckCircle2 size={12} />{" "}
                      {escalations.length > 1 ? `Mark all ${escalations.length} resolved` : "Mark resolved"}
                    </button>
                  )}
                </div>
                {isOpen && (
                  <EscalationThread
                    req={req}
                    viewer={viewer}
                    requests={requests}
                    saveRequests={saveRequests}
                    addLog={addLog}
                    onClose={() => setOpenFor(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const HISTORY_PAGE = 15;

// When a call actually finished: the crew's "Back in Service" stamp, or the
// moment the desk closed it, or — for a call abandoned part-way through — the
// last thing that was stamped on it.
export function callClosedTs(req) {
  const t = req.times || {};
  if (t.backInService) return t.backInService;
  if (req.closedAt) return req.closedAt;
  const stamps = TIME_STEPS.map((s) => t[s.timeKey]).filter(Boolean);
  return stamps.length > 0 ? Math.max(...stamps) : req.createdAt || 0;
}

// A closed call is still an unfinished row on the sheet if nobody put a call
// type or a distance on it. `saveRequests`/`addLog`/`user` are optional: hand
// them in from a desk that is allowed to correct the record (dispatch, admin)
// and each closed card grows the same coding picker the live cards have; leave
// them out and the history stays exactly as read-only as it was.
//
// `unitId` narrows the list to the calls one medic ran or assisted on. Crews
// used to lose a call the moment it closed, which left them with no way to
// check back on a timeline they had just stamped — a crew asked about a
// transfer an hour later had to phone the desk. With it set they get their own
// closed calls, read-only: the record is theirs to look at, not to rewrite.
//
// `shiftWindow` narrows it further, to calls that closed inside one 12-hour
// window. A medic number is not a crew: the same MEDIC 3 is worked by two or
// three different pairs across a day, so the unfiltered history of a truck is
// mostly other people's work. A crew reading back what they ran wants this
// shift and nothing else, so their tablet passes their own window in and the
// list starts open — it is short enough to read without unfolding anything.
// The desk passes nothing and keeps the whole history, which is the record.
// "2026-08-01" for whatever day this timestamp fell on locally — the key the
// history filter compares against, and the key the day picker below hands back.
export function localDayKey(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// And back again, to local midnight. Parsed by hand rather than handed to
// `new Date("2026-08-01")`, which the language reads as UTC — a desk on +03
// would get the evening before.
export function dayKeyToTs(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
  if (!m) return 0;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
}

// Picking the day to search the history on.
//
// This was an <input type="date">, and the browser draws that one in whatever
// calendar the device is set to: on a Mac or a tablet set to an Arabic locale
// the admin and the crews got a Hijri picker reading "19 Safar 1448", while the
// dispatcher booking a transfer two panels away was picking "2 August 2026" out
// of a Gregorian grid. One board, one day, two calendars, and no way to line
// them up. So this is the dispatcher's own month grid — the same helpers, the
// same Gregorian month labels and Latin digits — cut down to a date on its own
// and used by every side of the board.
export function DayPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const selectedTs = dayKeyToTs(value);
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(selectedTs || Date.now()));
  const wrapRef = useRef(null);

  // Follow the value when it is set from somewhere else — "Clear filters" up in
  // the toolbar, or a day chosen while the grid was showing another month.
  useEffect(() => {
    if (selectedTs) setMonthAnchor(startOfMonth(selectedTs));
  }, [selectedTs]);

  // Anywhere else on the page closes it. A popover over a list of calls that
  // stays up until you press it again is in the way of the thing you opened it
  // to look at.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const today = startOfDay(Date.now());

  function pick(dayTs) {
    onChange(localDayKey(dayTs));
    setOpen(false);
  }

  return (
    <div style={styles.dayPickerWrap} ref={wrapRef}>
      <button
        type="button"
        style={value ? styles.dayPickerBtnOn : styles.dayPickerBtn}
        onClick={() => setOpen((o) => !o)}
        title="Calls that closed on this date"
      >
        <CalendarClock size={11} /> {value ? gregDateStr(selectedTs) : "Any date"}
      </button>

      {open && (
        <div style={styles.dayPickerPop}>
          <div style={styles.calHeader}>
            <button
              type="button"
              style={styles.calNavBtn}
              onClick={() => setMonthAnchor((m) => addMonths(m, -1))}
              aria-label="Previous month"
            >
              ‹
            </button>
            <div style={styles.calMonthLabel}>
              {MONTH_LABELS[new Date(monthAnchor).getMonth()]} {new Date(monthAnchor).getFullYear()}
            </div>
            <button
              type="button"
              style={styles.calNavBtn}
              onClick={() => setMonthAnchor((m) => addMonths(m, 1))}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
          <div style={styles.calWeekRow}>
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} style={styles.calWeekday}>{d.slice(0, 2)}</div>
            ))}
          </div>
          {monthGrid(monthAnchor).map((week, i) => (
            <div key={i} style={styles.calWeekRow}>
              {week.map((dayTs) => {
                const inMonth = new Date(dayTs).getMonth() === new Date(monthAnchor).getMonth();
                // Nothing has closed tomorrow, so tomorrow is not a search.
                const ahead = dayTs > today;
                return (
                  <button
                    type="button"
                    key={dayTs}
                    disabled={ahead}
                    onClick={() => pick(dayTs)}
                    style={{
                      ...styles.calDay,
                      ...(inMonth ? null : styles.calDayOutside),
                      ...(ahead ? styles.calDayPast : null),
                      ...(dayTs === today ? styles.calDayToday : null),
                      ...(selectedTs === dayTs ? styles.calDaySelected : null),
                    }}
                  >
                    {new Date(dayTs).getDate()}
                  </button>
                );
              })}
            </div>
          ))}
          <div style={styles.quickPickRow}>
            <button type="button" style={styles.quickPickBtn} onClick={() => pick(today)}>
              Today
            </button>
            <button type="button" style={styles.quickPickBtn} onClick={() => pick(today - 86400000)}>
              Yesterday
            </button>
            <button
              type="button"
              style={styles.quickPickBtn}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Any date
            </button>
            <span style={styles.whenCalTag}>Gregorian</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Everything about a call that somebody might type into the history search.
// Names are the point of it: "who was on it" is how a call is remembered a week
// later, and the names this board actually holds against a call are the one on
// the patient care report, whoever closed it, whoever recorded a refusal, and
// whoever escalated an issue on it. The medic and the ambulance number are in
// here too, so a search for "MEDIC 3" or an amb number works the same way.
export function callSearchText(req, units, escalations) {
  const unit = (units || []).find((u) => u.id === req.assignedUnitId);
  const parts = [
    req.nature,
    callFrom(req),
    callTo(req),
    req.mrn,
    req.notes,
    unit ? unit.name : "",
    unit && unit.ambulanceNumber ? `amb ${unit.ambulanceNumber}` : "",
    pcrAuthorText(req),
    req.closedBy,
    req.refusedBy,
    callCloseReason(req),
    assistTeamNames(req, units),
    gregDateStr(callClosedTs(req)),
  ];
  (escalations || []).forEach((e) => {
    parts.push(e.message, e.unitName, e.by && e.by.name, e.resolvedBy);
    escalationReplies(e).forEach((r) => parts.push(r.message, r.byName));
  });
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function CompletedCalls({ requests, units, saveRequests, addLog, user, unitId, shiftWindow, viewer, canCorrect }) {
  const [open, setOpen] = useState(!!shiftWindow);
  // Folded, with the count still on the header. The number is the part that
  // needs to be seen; the list of which calls is what you open it for.
  const [bulbOpen, setBulbOpen] = useState(false);
  const [shown, setShown] = useState(HISTORY_PAGE);
  const [codingFor, setCodingFor] = useState(null);
  // Which call has the correction form open, keyed by id for the same reason
  // the coding picker is: this list is a map over calls.
  const [editFor, setEditFor] = useState(null);

  async function applyEdits(req, changes, note) {
    const ok = await applyCallEditsTo({
      req, changes, note,
      who: user && user.name ? user.name : "Dispatch",
      requests, saveRequests, addLog,
    });
    if (ok) setEditFor(null);
  }

  async function proposeEdits(req, changes, note) {
    const ok = await proposeCallEditsTo({
      req, changes, note, viewer,
      requests, saveRequests, addLog,
    });
    if (ok) setEditFor(null);
  }

  // The handover, recorded on a call that has already closed. Unlike the coded
  // fields this is not a correction to something the desk decided — it is the
  // crew stating who they handed the patient to, which only they can know. It is
  // stamped with whoever entered it either way.
  // Which of these calls the sheet still wants something from.
  //
  // A desk is answerable for its own twelve hours and no more. Showing them
  // every gap the department has ever left turns the banner into wallpaper —
  // and the gaps from Tuesday night belong to the desk that worked Tuesday
  // night, who are the only people who can still remember the call.
  //
  // Administration is the exception: they are looking at the department rather
  // than a shift, and the point of their view is to see what is outstanding
  // across all of it.
  const incomplete = React.useMemo(() => {
    if (!canCorrect) return [];
    const all = callsNeedingDetail(requests);
    if (!user || user.role !== "dispatcher") return all;
    const from = user.shiftStart || shiftWindowAt(Date.now()).start;
    const to = user.shiftEnd || from + SHIFT_MS;
    return all.filter((r) => r.createdAt >= from && r.createdAt < to);
  }, [requests, canCorrect, user && user.shiftStart, user && user.shiftEnd, user && user.role]);

  async function saveReceiverOn(req, { name, receiverId }) {
    const who = user && user.name ? user.name : "Crew";
    const fresh = await readKey("ems:requests", requests);
    await saveRequests(
      fresh.map((r) =>
        r.id === req.id
          ? {
              ...r,
              receiver: {
                name,
                receiverId,
                takenBy: who,
                takenAt: Date.now(),
                unitName: viewer ? viewer.unitName || "" : "",
                afterClose: true,
              },
            }
          : r
      )
    );
    await addLog(
      `${who} recorded the receiver for "${req.nature}" after the call closed — ${name} (ID ${receiverId})`,
      "status"
    );
  }

  async function verifyEdit(req, entry, accept) {
    await verifyCallEditOn({
      req, entry, accept,
      who: user && user.name ? user.name : "Dispatch",
      requests, saveRequests, addLog,
    });
  }

  // The escalation thread is opened one call at a time, keyed by call id — the
  // same shape the coding picker uses, and for the same reason: this list is a
  // map over calls, so the state that belongs to a row has to live up here.
  const [escFor, setEscFor] = useState(null);
  const [openCards, setOpenCards] = useState([]);

  // The four ways of finding a call again: a word (a name, a medic, a ward, a
  // nature), the day it closed on, whether an issue was ever raised on it, and
  // whether it was called off rather than run.
  const [query, setQuery] = useState("");
  const [day, setDay] = useState("");
  const [escOnly, setEscOnly] = useState(false);
  const [cancelledOnly, setCancelledOnly] = useState(false);
  // A crew's list is their current shift by default, because that is what they
  // want nine times in ten. This is the door out of it.
  const [allHistory, setAllHistory] = useState(false);

  const q = query.trim().toLowerCase();
  const filtering = !!q || !!day || escOnly || cancelledOnly;
  // Searching is pointless inside a twelve-hour window, so any search opens the
  // whole record this crew is allowed to see.
  const windowed = !!shiftWindow && !allHistory && !filtering;

  // Correcting a closed call stays a desk job. The crew's list is handed the
  // same two writers now — they need them to escalate an issue on a call they
  // have already closed — so the coding picker is gated on the role rather than
  // on whether a writer happened to be passed in.
  const canCode =
    typeof saveRequests === "function" &&
    typeof addLog === "function" &&
    !!user &&
    (user.role === "admin" || user.role === "dispatcher");
  const canThread = typeof saveRequests === "function" && typeof addLog === "function" && !!viewer;

  useEffect(() => {
    setShown(HISTORY_PAGE);
  }, [query, day, escOnly, cancelledOnly, allHistory]);

  async function setCoding(reqId, field, value) {
    if (!canCode) return;
    await applyCallCoding({ reqId, field, value, requests, saveRequests, addLog, actor: user });
  }

  const completed = requests
    .filter((r) => !!r)
    .map((r) => ({
      req: r,
      live: r.status !== "completed",
      closedAt: callClosedTs(r),
      escalations: visibleEscalations(r, viewer),
    }))
    // A call that is still running is not history and stays off this list — with
    // one exception, and it is the whole reason the filter beside it exists. An
    // issue is usually raised while the call is still going: it is answered from
    // the inbox above, drops off it the moment it is answered or resolved, and
    // if this list only ever held closed calls then pressing "Escalated only"
    // straight afterwards said there was nothing there — while the crew were
    // still on the job and the thread was sitting on a live call nobody could
    // filter to. So the escalated filter reaches into the live board as well,
    // and those cards say what the call is actually doing instead of pretending
    // it is closed.
    .filter(({ live, escalations }) => !live || (escOnly && escalations.length > 0))
    // A crew's list is the calls their medic ran or helped on — plus any call
    // carrying an issue they raised themselves, which may well have been run
    // from a different truck on a different day.
    .filter(
      ({ req, escalations }) =>
        !unitId || req.assignedUnitId === unitId || isAssistingUnit(req, unitId) || escalations.length > 0
    )
    // Scoped by when the call closed rather than when it was raised: a transfer
    // that came in at 06:50 and finished at 07:40 was worked by the crew who
    // are on now, and it is their list it belongs on. A live call has no closing
    // time to scope by, and it only ever reaches this list through a filter,
    // which opens the whole record anyway.
    .filter(({ live, closedAt }) => !windowed || live || (closedAt >= shiftWindow.start && closedAt <= shiftWindow.end))
    // "Escalated only" is every call carrying an issue a team raised, and that
    // is the only test it applies. How the call ended is a separate question:
    // a job that was stood down and then complained about is still a complaint,
    // and hiding it here left the one filter meant to find issues as the one
    // place the issue could not be found. Cancelled calls that carry one show up
    // under both filters, with the CANCELLED tag on the card saying which it is.
    .filter(({ escalations }) => !escOnly || escalations.length > 0)
    .filter(({ req, live }) => !cancelledOnly || (!live && callWasCancelled(req)))
    .filter(({ closedAt }) => !day || localDayKey(closedAt) === day)
    .filter(({ req, escalations }) => !q || callSearchText(req, units, escalations).includes(q))
    // Anything still running goes to the top: it is the one thing on this list
    // that can still be acted on.
    .sort((a, b) => (a.live === b.live ? b.closedAt - a.closedAt : a.live ? -1 : 1));

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const todayCount = completed.filter((c) => !c.live && c.closedAt >= midnight.getTime()).length;
  // Coding is a closed-call job — a call still running is coded from the live
  // card above, so it is not counted as an unfinished row on the sheet here.
  const uncoded = completed.filter(({ req, live }) => !live && (!callTypeOf(req) || !loadedKmOf(req))).length;
  const escalatedCount = completed.filter(({ escalations }) => escalations.length > 0).length;
  const cancelledCount = completed.filter(({ req, live }) => !live && callWasCancelled(req)).length;
  // How many of the rows on screen are calls that have not finished yet, which
  // only ever happens under "Escalated only".
  const liveCount = completed.filter((c) => c.live).length;
  // A crew reads this list as their own work; a desk reads it as the board's.
  const shiftLabel = shiftWindow && shiftWindow.meta ? shiftWindow.meta.label : "";
  const shiftHours = shiftWindow ? shiftWindow.windowStr || "" : "";
  const myUnitName = unitId ? (units.find((u) => u.id === unitId) || {}).name || "" : "";
  const isOpen = open || filtering || allHistory;

  function clearFilters() {
    setQuery("");
    setDay("");
    setEscOnly(false);
    setCancelledOnly(false);
    setAllHistory(false);
  }

  return (
    <div>
      <div style={styles.sectionHeaderRow}>
        <div style={{ ...styles.sectionHeader, margin: 0 }}>
          <Archive size={14} style={{ marginRight: 6, verticalAlign: -2 }} />{" "}
          {escOnly
            ? "ESCALATED CALLS"
            : filtering || allHistory
              ? unitId
                ? "YOUR CALL HISTORY"
                : "CALL HISTORY"
              : shiftWindow
                ? `${myUnitName || "YOUR MEDIC"} — CLOSED THIS SHIFT`
                : unitId
                  ? "YOUR CLOSED CALLS"
                  : "COMPLETED CALLS"}
          {completed.length > 0 ? ` (${completed.length})` : ""}
        </div>
        {(completed.length > 0 || filtering) && (
          <button style={styles.ghostBtnSm} onClick={() => setOpen((o) => !o)}>
            {isOpen ? "Hide" : "Show"} {windowed ? "calls" : "history"} <ChevronDown size={12} />
          </button>
        )}
      </div>

      {/* The sheet's outstanding questions, said once at the top rather than
          left to be discovered at the end of the month by somebody reading four
          hundred rows looking for blanks. Only the desk sees it — filling these
          in is their job, and a crew's proposal still has to come back here to
          be confirmed. */}
      {incomplete.length > 0 && (
        <div style={styles.needsDetail}>
          <button
            style={styles.needsDetailHeadBtn}
            onClick={() => setBulbOpen((v) => !v)}
          >
            <span style={styles.needsDetailBulb}>💡</span>
            {incomplete.length} completed call{incomplete.length === 1 ? "" : "s"}{" "}
            {user && user.role === "dispatcher" ? "on your shift" : "on the board"} still
            {incomplete.length === 1 ? " needs" : " need"} information before the log is finished
            <ChevronRight
              size={13}
              style={{
                marginLeft: "auto",
                flex: "none",
                transform: bulbOpen ? "rotate(90deg)" : "none",
                transition: "transform .15s ease",
              }}
            />
          </button>
          {bulbOpen && (
          <div style={styles.needsDetailBody}>
            Open the call below and use <strong>Correct call details</strong>. Until then these
            columns go out blank on the dispatch log.
          </div>
          )}
          {bulbOpen && (
          <div style={styles.needsDetailList}>
            {incomplete.slice(0, 6).map((r) => (
              <div key={r.id} style={styles.needsDetailItem}>
                <span style={styles.needsDetailNature}>{r.nature}</span>
                <span style={styles.needsDetailWhat}>
                  missing: {missingLogFields(r).map((f) => f.label).join(", ")}
                </span>
              </div>
            ))}
            {incomplete.length > 6 && (
              <div style={styles.needsDetailWhat}>and {incomplete.length - 6} more below.</div>
            )}
          </div>
          )}
        </div>
      )}

      {/* Finding a call again. The desk searches hundreds of them; a crew
          searching at all is usually looking for the one they raised an issue
          on, which is why that filter is a button of its own rather than a word
          somebody has to think of. */}
      <div style={styles.historyFilters}>
        <div style={styles.historyFilterInputWrap}>
          <Search size={12} style={{ color: "var(--ink-4)" }} />
          <input
            style={styles.historyFilterInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a name, a medic, a ward, a call…"
          />
        </div>
        {/* Gregorian on every device — see DayPicker. */}
        <DayPicker value={day} onChange={setDay} />
        {/* Dispatch never sees an escalation, so the desk is never offered a
            filter for one. */}
        {viewer && (
          <button
            style={escOnly ? styles.filterChipOn : styles.filterChip}
            onClick={() => {
              setEscOnly((v) => !v);
              setCancelledOnly(false);
            }}
          >
            <ShieldAlert size={11} /> Escalated only
          </button>
        )}
        {/* Its opposite number, and the reason the two sit side by side: the
            question "what have the teams raised with me" and the question "what
            never ran" are asked one at a time, so pressing either drops the
            other rather than quietly intersecting them into nothing. Unlike
            escalations, a cancellation is no secret — the desk gets this one
            too. */}
        <button
          style={cancelledOnly ? styles.filterChipOn : styles.filterChip}
          onClick={() => {
            setCancelledOnly((v) => !v);
            setEscOnly(false);
          }}
        >
          <CircleSlash size={11} /> Cancelled requests
        </button>
        {shiftWindow && !filtering && (
          <button style={allHistory ? styles.filterChipOn : styles.filterChip} onClick={() => setAllHistory((v) => !v)}>
            {allHistory ? "All history" : "This shift"}
          </button>
        )}
        {(filtering || allHistory) && (
          <button style={styles.ghostBtnSm} onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>

      <div style={styles.historyNote}>
        {filtering
          ? completed.length === 0
            ? escOnly
              ? "Nothing escalated"
              : cancelledOnly
                ? "No cancelled call matches"
                : "No call matches"
            : `${completed.length} match${completed.length === 1 ? "" : "es"}` +
              `${day ? ` on ${gregDateStr(new Date(`${day}T12:00:00`).getTime())}` : ""}` +
              `${liveCount > 0 ? ` · ${liveCount} still running` : ""}` +
              `${!escOnly && escalatedCount > 0 ? ` · ${escalatedCount} escalated` : ""}`
          : completed.length === 0
            ? "Nothing closed on this shift"
            : windowed
              ? `${completed.length} closed this shift`
              : unitId
                ? `${completed.length} closed`
                : `${todayCount} completed today. Closed calls stay here with their full timeline for dispatch and admin.` +
                  (cancelledCount > 0
                    ? ` ${cancelledCount} of them ${cancelledCount === 1 ? "was" : "were"} cancelled rather than run — "Cancelled requests" has ${cancelledCount === 1 ? "it" : "those"} on ${cancelledCount === 1 ? "its" : "their"} own.`
                    : "") +
                  (canCode && uncoded > 0
                    ? ` ${uncoded} still ${uncoded === 1 ? "has" : "have"} no call type or loaded kilometers — open the history to finish ${uncoded === 1 ? "it" : "them"} off before the sheet goes out.`
                    : "")}
      </div>

      {isOpen && (
        <React.Fragment>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {completed.slice(0, shown).map(({ req, live, closedAt, escalations }) => {
              const unit = units.find((u) => u.id === req.assignedUnitId);
              const shift = shiftMeta(req.shift || scheduledShiftKey(req.createdAt));
              // A call that is still running has no end to measure to, so its
              // time on call is read up to now rather than up to its last stamp.
              const busy = callBusyMs(req, live ? Date.now() : closedAt);
              const statusMeta = REQ_STATUS[req.status] || { label: String(req.status || "").toUpperCase() || "OPEN", color: "#64748B" };
              // Closed calls open on demand.
              //
              // A shift closes twenty calls and each card runs to a screen of
              // times, codes, corrections and receipts. As a list of folded
              // lines the whole shift is visible at once and any one of them is
              // a tap away; a running call stays open, because that one is being
              // worked.
              const isOpen = live || openCards.includes(req.id);
              return (
                <div
                  key={req.id}
                  style={{
                    ...styles.callCard,
                    borderLeftColor: live ? statusMeta.color : REQ_STATUS.completed.color,
                    opacity: live ? 1 : 0.92,
                    ...(isOpen ? null : styles.callCardFolded),
                  }}
                >
                  {!isOpen && (
                    <button
                      style={styles.foldedRow}
                      onClick={() => setOpenCards((v) => [...v, req.id])}
                    >
                      <span style={styles.foldedNature}>{req.nature}</span>
                      <span style={styles.foldedRoute}>{callRoute(req)}</span>
                      <span style={styles.foldedTime}>{clockStr(req.createdAt)}</span>
                      {missingLogFields(req).length > 0 && <span style={styles.foldedFlag}>💡</span>}
                    </button>
                  )}

                  {isOpen && !live && (
                    <button
                      style={styles.foldBack}
                      onClick={() => setOpenCards((v) => v.filter((x) => x !== req.id))}
                    >
                      Close
                    </button>
                  )}

                  {isOpen && (
                  <>
                  <div style={styles.callCardTop}>
                    <div style={styles.callCardNature}>{req.nature}</div>
                    <div style={styles.callCardTopRight}>
                      {/* A call that is over is exactly when most problems with
                          it get written down, so the banner is on the closed
                          card too. */}
                      {canThread && (
                        <EscalationChip
                          req={req}
                          viewer={viewer}
                          open={escFor === req.id}
                          onToggle={() => setEscFor(escFor === req.id ? null : req.id)}
                        />
                      )}
                      <span style={{ ...styles.pill, background: PRIORITY[priorityKeyOf(req)] ? PRIORITY[priorityKeyOf(req)].color : "#64748B" }}>
                        {PRIORITY[priorityKeyOf(req)] ? PRIORITY[priorityKeyOf(req)].label : "—"}
                      </span>
                    </div>
                  </div>
                  <div style={styles.callCardMeta}>
                    <CallRoute req={req} />
                    <span style={styles.callCardMetaItem}>
                      <Clock size={12} /> {gregShortDateTimeStr(req.createdAt)}
                    </span>
                    <span style={{ ...styles.pill, background: live ? statusMeta.color : REQ_STATUS.completed.color }}>
                      {live ? `${statusMeta.label} · STILL RUNNING` : `CLOSED ${hhmm(closedAt)}`}
                    </span>
                    <CancelledTag req={req} />
                    <NoTransportTag req={req} />
                    <PcrAuthorTag req={req} />
                    <CallTypeTag req={req} />
                    <LoadedKmTag req={req} />
                    {shift && (
                      <span style={{ ...styles.shiftTag, color: shift.color, borderColor: shift.color }}>
                        {shift.glyph} {shift.short}
                      </span>
                    )}
                    {/* On a crew's own list, a call they only helped on reads
                        differently from one that was theirs to run. */}
                    {unitId && req.assignedUnitId !== unitId && (
                      <span style={styles.assistTag}>
                        <HandRaised size={11} /> ASSISTED
                      </span>
                    )}
                    {unit && (
                      <span style={styles.assignedTag}>
                        {unit.name}{unit.ambulanceNumber ? ` · Amb #${unit.ambulanceNumber}` : ""}
                      </span>
                    )}
                    {busy > 0 && <span style={styles.historyDuration}>{msDurationStr(busy)} on call</span>}
                    {req.scheduledFor && (
                      <span style={styles.scheduledTag}>
                        <CalendarClock size={11} /> booked for {hhmm(req.scheduledFor)}
                      </span>
                    )}
                  </div>
                  {req.mrn ? (
                    <div style={styles.mrnRow}>MRN: {req.mrn}</div>
                  ) : (
                    <div style={styles.mrnMissingRow}>
                      <AlertTriangle size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                      No MRN on this call
                    </div>
                  )}
                  {req.requirements && req.requirements.length > 0 && (
                    <div style={styles.checklistRow}>
                      {reqLabels(req).map((label, i) => (
                        <span key={i} style={styles.reqBadge}>{label}</span>
                      ))}
                    </div>
                  )}

                  {/* The same flag on the card, so a call is identifiable once
                      the list runs past the six named above. */}
                  {canCorrect && missingLogFields(req).length > 0 && (
                    <div style={styles.needsDetailTag}>
                      💡 needs: {missingLogFields(req).map((f) => f.label).join(", ")}
                    </div>
                  )}

                  {/* Who took the patient, recorded after the fact.
                      A crew clearing at 03:00 goes back in service before they
                      have written anything down, and the handover is the part
                      that gets lost. It can be added here afterwards, by the
                      crew who ran the call or by the desk — and changed, if the
                      wrong name went in. */}
                  {!isNoTransport(req) && (req.times || {}).arrivalDestination && (
                    <ReceiverBanner
                      req={req}
                      canEdit={canCorrect || canProposeEditOn(req, viewer)}
                      onSave={(v) => saveReceiverOn(req, v)}
                    />
                  )}

                  {/* Corrections on a call that has already closed. This is the
                      answer to the crew who only find out the MRN was wrong
                      after they are back in service: the call has left the
                      active board, but it is still here, and it can still be
                      put right. */}
                  {canCorrect && (
                    <>
                      <PendingEditReview
                        req={req}
                        onVerify={(e) => verifyEdit(req, e, true)}
                        onReject={(e) => verifyEdit(req, e, false)}
                      />
                      <EditHistory req={req} />
                      {editFor === req.id ? (
                        <CallEditForm
                          req={req}
                          mode="apply"
                          onSubmit={(changes, note) => applyEdits(req, changes, note)}
                          onCancel={() => setEditFor(null)}
                        />
                      ) : (
                        <button style={styles.editOpenBtn} onClick={() => setEditFor(req.id)}>
                          <PencilLine size={12} /> Correct call details
                        </button>
                      )}
                    </>
                  )}
                  {!canCorrect && canProposeEditOn(req, viewer) && (
                    <>
                      {pendingCallEdits(req).length > 0 && (
                        <div style={styles.editPendingNote}>
                          <Clock size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                          Sent to dispatch — waiting for them to confirm:{" "}
                          {pendingCallEdits(req)
                            .map((e) => `${editFieldLabel(e.field)} → ${editValueText(e.to, e.field)}`)
                            .join(", ")}
                        </div>
                      )}
                      <EditHistory req={req} />
                      {editFor === req.id ? (
                        <CallEditForm
                          req={req}
                          mode="propose"
                          onSubmit={(changes, note) => proposeEdits(req, changes, note)}
                          onCancel={() => setEditFor(null)}
                        />
                      ) : (
                        <button style={styles.editOpenBtn} onClick={() => setEditFor(req.id)}>
                          <PencilLine size={12} /> These details are wrong
                        </button>
                      )}
                    </>
                  )}

                  <CallTimes times={req.times} />
                  <AssistStatusLine req={req} units={units} />
                  {/* Coding a call is a closed-call job — a call still running
                      is coded from the live board above, where the crew are
                      still stamping times on it. */}
                  {canCode &&
                    !live &&
                    (codingFor === req.id ? (
                      <React.Fragment>
                        <CallCodingBlock
                          req={req}
                          onSet={(field, value) => setCoding(req.id, field, value)}
                          title="CODE THIS CLOSED CALL"
                          hint="The call is finished, but the sheet is not. Whatever you set here is what goes in the CAT. OF CALL and KILO METER columns of the export."
                        />
                        <div style={styles.codingClosedRow}>
                          <button style={styles.ghostBtnSm} onClick={() => setCodingFor(null)}>
                            Done coding
                          </button>
                        </div>
                      </React.Fragment>
                    ) : (
                      <div style={styles.codingClosedRow}>
                        {!callTypeOf(req) && <span style={styles.codeMissingTag}>TYPE NOT SET</span>}
                        {!loadedKmOf(req) && <span style={styles.codeMissingTag}>LOADED KM NOT SET</span>}
                        <button style={styles.ghostBtnSm} onClick={() => setCodingFor(req.id)}>
                          <Tag size={12} />{" "}
                          {callTypeOf(req) && loadedKmOf(req) ? "Change call type / km" : "Code this call"}
                        </button>
                      </div>
                    ))}
                  {/* Who ended the call and what they said it ended as. A call
                      closed before the desk was asked for a reason keeps its
                      line and says nothing more, rather than reading as an
                      unanswered question. */}
                  {(req.closedBy || callCloseReason(req)) && (
                    <div style={styles.historyClosedBy}>
                      {req.closedBy ? `Closed by ${req.closedBy}` : "Closed"}
                      {callCloseReason(req) && (
                        <span style={styles.cancelReasonSaid}> — {callCloseReason(req)}</span>
                      )}
                    </div>
                  )}
                  {canThread && escFor === req.id && (
                    <EscalationThread
                      req={req}
                      viewer={viewer}
                      requests={requests}
                      saveRequests={saveRequests}
                      addLog={addLog}
                      onClose={() => setEscFor(null)}
                    />
                  )}
                  </>
                  )}
                </div>
              );
            })}
          </div>
          {shown < completed.length && (
            <button style={{ ...styles.ghostBtnSm, marginTop: 10 }} onClick={() => setShown((s) => s + HISTORY_PAGE)}>
              Show {Math.min(HISTORY_PAGE, completed.length - shown)} older
            </button>
          )}
        </React.Fragment>
      )}
    </div>
  );
}