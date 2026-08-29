import { callFrom, callRoute, callTo } from "../domain/call-locations.jsx";
import { CHECK_ANSWERS, checkItemAnswered, checklistTree, isWriteItem } from "../domain/checklist.jsx";
import { isInternalEmergency } from "../domain/compliance.jsx";
import { EDITABLE_FIELDS, PRIORITY, REQ_STATUS, callEdits, editFieldLabel, editValueText, pendingCallEdits, priorityKeyOf } from "../domain/constants.jsx";
import { assignableNote, assignableUnits, effectiveStatusMeta, liveRequestFor, statusMeta } from "../domain/in-service.jsx";
import { buzz, clockStr, shortDurationStr } from "../domain/messages.jsx";
import { isReturnLeg, wantsReturn } from "../domain/return-journeys.jsx";
import { assistOf, assistPending, assistTeams, pendingAssistCalls } from "../domain/second-ambulance.jsx";
import { hhmm } from "../domain/shift-helpers.jsx";
import { callStartTs } from "../domain/uhu.jsx";
import { soundCallAlert } from "../lib/dates.jsx";
import { AlertTriangle, ArrowRight, Ban, CheckCircle2, FileSignature, HandRaised, MapPin, PencilLine } from "../lib/icons.jsx";
import { notifyAssistRequest } from "../lib/notify.jsx";
import { readKey } from "../lib/offline-queue.jsx";
import { useEffect, useRef, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { markPreAlerted, readPreAlerted } from "./CompletedCalls.jsx";

// ---------- the desk's assist tasks ----------
//
// A crew asking for a second ambulance is the one alert on this board that
// nobody can act on from a tablet: only the desk can send another team. So it
// arrives as both halves of the thing dispatch needs — a noise and a system
// notification the moment it is asked for, and a task at the top of the desk
// that does not go away until a team has been sent to that call (or the desk
// stands the request down). It is deliberately not dismissable.
export const ASSIST_RENAG_MS = 2 * 60 * 1000;

// Keyed by the ask, and by which two-minute round of it we are in: a request
// still sitting unanswered chimes again, because a crew waiting for help is not
// something a desk should be able to hear once and forget.
export function assistAlertKey(req, now) {
  const a = assistOf(req) || {};
  const at = a.requestedAt || 0;
  const round = at ? Math.floor(Math.max(0, now - at) / ASSIST_RENAG_MS) : 0;
  return `assist:${req.id}@${at}#${round}`;
}

export function useAssistAlerts(user, requests, audioCtxRef) {
  const seesTasks = !!user && (user.role === "dispatcher" || user.role === "admin");
  const now = Date.now();
  const pending = seesTasks ? pendingAssistCalls(requests) : [];
  const keys = pending.map((r) => assistAlertKey(r, now)).join("|");
  const latest = useRef({ pending, now });
  latest.current = { pending, now };

  useEffect(() => {
    const { pending: list, now: at } = latest.current;
    if (list.length === 0) return;
    const fired = readPreAlerted();
    let chime = false;
    list.forEach((req) => {
      const key = assistAlertKey(req, at);
      if (fired[key]) return;
      markPreAlerted(key, at);
      chime = true;
      notifyAssistRequest(req, assistOf(req).requestedByUnitName);
    });
    // Several asks landing together get one noise between them.
    if (chime) {
      soundCallAlert(audioCtxRef, "critical", true);
      buzz([300, 150, 300, 150, 300]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  return pending;
}

export function AssistanceTasks({ user, units, requests, saveUnits, saveRequests, addLog, audioCtxRef }) {
  const pending = useAssistAlerts(user, requests, audioCtxRef);
  const now = Date.now();
  if (!user || (user.role !== "dispatcher" && user.role !== "admin")) return null;
  if (pending.length === 0) return null;

  const free = assignableUnits(units, requests);

  async function sendAssistUnit(reqId, unitId) {
    const freshRequests = await readKey("ems:requests", requests);
    const freshUnits = await readKey("ems:units", units);
    const req = freshRequests.find((r) => r.id === reqId);
    const unit = freshUnits.find((u) => u.id === unitId);
    if (!req || !unit) return;
    if (req.status === "completed") {
      window.alert("That call has been closed. Nothing to send a second team to.");
      return;
    }
    // The same guard the ordinary assignment uses: this dropdown may have been
    // drawn before another desk (or the crew themselves) took this team onto
    // something else.
    const busyOn = liveRequestFor(unit, freshRequests);
    if (busyOn) {
      window.alert(`${unit.name} was just put on "${busyOn.nature}". Pick another team.`);
      return;
    }
    const at = Date.now();
    const a = assistOf(req) || {};
    const nextRequests = freshRequests.map((r) =>
      r.id === reqId
        ? {
            ...r,
            assist: {
              ...a,
              status: "assigned",
              teams: [
                ...assistTeams(r),
                {
                  unitId: unit.id,
                  unitName: unit.name,
                  assignedAt: at,
                  assignedBy: user && user.name ? user.name : "Dispatch",
                  acknowledgedAt: null,
                  clearedAt: null,
                },
              ],
            },
          }
        : r
    );
    const nextUnits = freshUnits.map((u) =>
      u.id === unitId ? { ...u, status: "dispatched", assignedRequestId: reqId } : u
    );
    await saveRequests(nextRequests);
    await saveUnits(nextUnits);
    await addLog(
      `${unit.name} sent as an additional ambulance to ${req.nature} — ${callRoute(req)}${
        a.requestedByUnitName ? ` (requested by ${a.requestedByUnitName})` : ""
      }`,
      "assign"
    );
  }

  async function standDown(reqId) {
    const freshRequests = await readKey("ems:requests", requests);
    const req = freshRequests.find((r) => r.id === reqId);
    if (!req) return;
    // A refusal has to say why.
    //
    // A crew asked for a second ambulance for a reason — a lift, a patient
    // going off — and being told only that none is coming teaches them nothing
    // except not to ask. The desk may have a good answer; the crew should hear it.
    const asked = assistOf(req);
    const why = window.prompt(
      `Stand down the request for a second ambulance on "${req.nature}"?\n\n` +
        (asked && asked.detail ? `They asked for: ${asked.detail}\n\n` : "") +
        "Say why. The crew sees this on their call."
    );
    if (why === null) return;
    if (!why.trim()) {
      window.alert("The crew needs a reason.");
      return;
    }
    const at = Date.now();
    const nextRequests = freshRequests.map((r) =>
      r.id === reqId
        ? {
            ...r,
            assist: {
              ...assistOf(r),
              status: "cancelled",
              cancelledAt: at,
              cancelledBy: user && user.name ? user.name : "Dispatch",
              cancelledReason: why.trim(),
            },
          }
        : r
    );
    await saveRequests(nextRequests);
    await addLog(
      `Assist request stood down by ${user && user.name ? user.name : "Dispatch"} — ${req.nature}: ${why.trim()}`,
      "clear"
    );
  }

  return (
    <div style={styles.assistPanel}>
      <div style={styles.assistPanelHead}>
        <span style={styles.assistPanelTitle}>
          <HandRaised size={13} /> ASSISTANCE NEEDED
        </span>
        <span style={styles.assistPanelCount}>
          {pending.length === 1
            ? "1 team has asked for a second ambulance"
            : `${pending.length} teams have asked for a second ambulance`}{" "}
          — assign another team to the same call
        </span>
      </div>
      {pending.map((req) => {
        const a = assistOf(req);
        const asker = units.find((u) => u.id === a.requestedByUnitId);
        const waiting = Math.max(0, now - (a.requestedAt || now));
        const options = free.filter((u) => u.id !== a.requestedByUnitId);
        return (
          <div key={req.id} style={styles.assistTaskRow}>
            <div style={styles.assistTaskMain}>
              <span style={styles.assistTaskUnit}>
                {a.requestedByUnitName || (asker ? asker.name : "A team")}
              </span>
              {/* The crew wrote down what they need. It was being kept on the
                  call and never shown here, so the desk answered without ever
                  reading it. */}
              {a.detail && <span style={styles.assistTaskDetail}>“{a.detail}”</span>}
              <span style={styles.assistTaskNature}>{req.nature}</span>
              <span style={styles.assistTaskRoute}>{callRoute(req)}</span>
              <span style={{ ...styles.pill, background: REQ_STATUS[req.status] ? REQ_STATUS[req.status].color : "#64748B" }}>
                {REQ_STATUS[req.status] ? REQ_STATUS[req.status].label : req.status}
              </span>
              <span style={styles.assistTaskWaiting}>
                asked {clockStr(a.requestedAt)} · waiting {shortDurationStr(waiting)}
              </span>
            </div>
            <div style={styles.assistTaskActions}>
              {options.length > 0 ? (
                <select
                  style={styles.assignSelect}
                  defaultValue=""
                  onChange={(e) => e.target.value && sendAssistUnit(req.id, e.target.value)}
                >
                  <option value="">Send second team…</option>
                  {options.map((u) => {
                    const note = assignableNote(u);
                    return (
                      <option key={u.id} value={u.id}>
                        {u.name}{note ? ` — ${note}` : ""}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <span style={styles.staffingWarn}>
                  No other team is free — the next one to clear can be sent from here.
                </span>
              )}
              <button style={styles.ghostBtnSm} onClick={() => standDown(req.id)}>
                Stand down
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// The correction form. The same fields for whoever opens it — what differs is
// what happens on save, which the caller decides: the desk's changes land on
// the call, a crew's are proposed and wait. `mode` only changes the wording so
// nobody is in any doubt which of the two they are doing.
// Signing for a refusal. All three answers are required: a refusal recorded
// against nobody is not a record, and "the family" is not a name. The call is
// not stamped until this is filled in, so a crew cannot half-record it.
// Who took the patient at the other end.
//
// A transfer ends with a handover to somebody, and until now the record simply
// stopped at "arrived". Naming the person who received the patient closes the
// chain of custody: the crew stamped the time, and this says who they gave the
// patient to. It is stamped with the crew member who recorded it, so the entry
// itself is accountable.
// An explanation that stays out of the way until it is wanted.
//
// These notes are useful the first week and clutter for ever afterwards, and on
// a phone-sized card they were pushing the timeline off the screen. The dot is
// always there for whoever needs it; the words are not.
export function InfoNote({ children, label }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button style={styles.infoDot} onClick={() => setOpen((v) => !v)} title="What is this?">
        <span style={styles.infoGlyph}>i</span>
        {label || "What is this?"}
      </button>
      {open && <div style={styles.infoBody}>{children}</div>}
    </div>
  );
}

// A call as a tile.
//
// On a busy board the full cards ran to several screens, and finding one meant
// scrolling past nine others. The tile carries what identifies a call at a
// glance — the priority down the edge, the nature, where it is going, its team
// and its clock — and opens into the card it always was when it is tapped.
//
// Deliberately the same size and shape as the unit squares above it, so the
// board reads as one thing rather than two.
// A call as a tile, with the elapsed time as the loudest thing on it.
//
// A dispatch board exists to answer one question — how long has this been
// running — and the old card set that number in the same face and size as the
// words around it. Here the clock is large tabular figures and everything else
// steps back to annotation.
//
// The band across the top is the signature: it fills as the call's clock runs
// and shifts green to amber to red against a twenty-minute reference. A
// supervisor reads the whole board in one pass without reading any words, which
// is the thing a list of text can never do.
export const RIBBON_REFERENCE_MS = 20 * 60 * 1000;

export function ribbonFor(elapsedMs) {
  const pct = Math.max(3, Math.min(100, (elapsedMs / RIBBON_REFERENCE_MS) * 100));
  const color = pct >= 85 ? "var(--crit)" : pct >= 55 ? "var(--hold)" : "var(--ok)";
  return { pct, color };
}

// The bottom bar.
//
// One button in the corner meant everything else on the screen was reached by
// scrolling — on a board with nine calls, the history and the teams were a long
// way down. A floating bar puts the four places a desk actually moves between
// within a thumb's reach, and keeps the one action that starts something new
// raised in the middle where it cannot be missed.
//
// It floats rather than sitting welded to the edge, so it reads as controls
// over the board rather than as a strip of chrome, and it clears the home
// indicator on its own.
export function BottomBar({ tabs, active, onSelect, action }) {
  // The action used to be dealt into the middle of the tab row, which is what
  // made the bar look thrown together: a filled green pill between two tabs
  // reads as a third kind of thing wedged in among places, the row stopped
  // being evenly spaced, and the eye landed on the wrong element first.
  //
  // Navigation is now only navigation — one even row of places — and the one
  // action a role starts things with floats above the bar on the right, where
  // it is reachable by thumb and cannot disturb the rhythm of the row.
  return (
    <>
      {action && (
        <button style={styles.bottomAction} onClick={action.onClick}>
          <span style={styles.bottomActionPlus}>+</span>
          {action.label}
        </button>
      )}
      <nav style={styles.bottomBar}>
        {tabs.map((t) => (
          <button
            key={t.key}
            style={t.key === active ? styles.bottomTabOn : styles.bottomTab}
            onClick={() => onSelect(t.key)}
            title={t.label}
          >
            <span style={styles.bottomGlyph}>{t.glyph}</span>
            <span style={styles.bottomTabLabel}>{t.label}</span>
            {t.badge > 0 && (
              <span style={styles.bottomBadge}>{t.badge > 99 ? "99+" : t.badge}</span>
            )}
          </button>
        ))}
      </nav>
    </>
  );
}

// One row per ambulance.
//
// A dispatcher does not ask what calls are running — they ask who can be sent,
// and the answer is always a truck. So the truck is the row, in the same order
// and the same place every shift, whether it is out or standing. Rows that
// reorder as work starts and finishes make the desk find the truck again each
// time; rows that hold still get learned in a week and read by position alone.
export const CALL_STAGES = [
  { key: "createdAt", label: "Dispatched" },
  { key: "enroute", label: "En route" },
  { key: "arrival", label: "On scene" },
  { key: "departure", label: "Departed" },
  { key: "arrivalDestination", label: "Arrived" },
];

export function stageIndexOf(req) {
  const t = (req && req.times) || {};
  let i = 0;
  if (t.enroute) i = 1;
  if (t.arrival) i = 2;
  if (t.departure) i = 3;
  if (t.arrivalDestination) i = 4;
  return i;
}

export const FLEET_TONES = { crit: "var(--crit)", hold: "var(--hold)", flow: "var(--flow)", ok: "var(--ok)" };

export function fleetToneFor(req) {
  if (!req) return null;
  if (assistPending(req)) return "hold";
  if ((req.priority || "").toLowerCase() === "critical" || isInternalEmergency(req)) return "crit";
  const t = req.times || {};
  if (t.departure && !t.arrivalDestination) return "flow";
  return "ok";
}

// A truck on a call, in the same shape as the roster card on the Teams page: a
// colour bar the full width of the card, the name, the state in a word, and
// then what it is actually doing.
//
// It used to be a full-width row, which made a board of three calls read as a
// list of settings rather than as three ambulances. The department already
// recognises the roster card; this is that card with a call in it, so there is
// one shape to learn rather than two.
export function FleetRow({ unit, req, onOpen, now }) {
  const tone = fleetToneFor(req);
  const colour = tone ? FLEET_TONES[tone] : "var(--hair-2)";
  const stage = req ? stageIndexOf(req) : -1;
  const crew = [unit.alpha && unit.alpha.name, unit.bravo && unit.bravo.name]
    .filter(Boolean)
    .join(" · ");
  const elapsed = req ? Math.max(0, (now || Date.now()) - callStartTs(req)) : null;

  return (
    <button style={styles.callCardTile} onClick={onOpen}>
      <span style={{ ...styles.unitCardBar, background: colour }} />
      <span style={styles.callCardTileBody}>
        <span style={styles.unitCardTop}>
          <span style={styles.unitCardName}>{unit.name}</span>
          <span style={{ ...styles.truckClock, color: req ? colour : "var(--ink-4)" }}>
            {req ? shortDurationStr(elapsed) : "—"}
          </span>
        </span>

        <span style={styles.unitCardStatusRow}>
          <span style={{ ...styles.unitCardDot, background: colour }} />
          <span style={{ ...styles.unitCardStatusText, color: colour }}>
            {/* `req` is this unit's live call, so when there is none the unit is
                by definition not on one - passing no request list says exactly
                that, and keeps a stale "available" off the row. */}
            {req ? (CALL_STAGES[stage] || CALL_STAGES[0]).label.toUpperCase() : effectiveStatusMeta(unit, null).label}
          </span>
        </span>

        <span style={styles.callCardTileCrew}>{crew || "No crew signed on"}</span>

        {req ? (
          <React.Fragment>
            <span style={styles.callCardTileNature}>{req.nature}</span>
            <span style={styles.callCardTileRoute}>{callRoute(req)}</span>

            {/* The five stamps, filled as far as the crew has got. Always in the
                same place, so the fleet reads as a set of shapes rather than a
                column of sentences. */}
            <span style={styles.rail}>
              {CALL_STAGES.map((st, i) => (
                <span
                  key={st.key}
                  style={{
                    ...styles.railSeg,
                    background: i <= stage ? colour : "var(--hair)",
                    opacity: i < stage ? 0.7 : 1,
                  }}
                />
              ))}
            </span>

            {(assistPending(req) || req.handover || wantsReturn(req) || isReturnLeg(req)) && (
              <span style={styles.callCardTileTags}>
                {assistPending(req) && <span style={styles.callTileAssist}>ASSIST</span>}
                {req.handover && <span style={styles.callTileHandover}>HANDED OVER</span>}
                {isReturnLeg(req) && <span style={styles.legReturn}>↩ RETURN</span>}
                {wantsReturn(req) && !isReturnLeg(req) && (
                  <span style={styles.legOut}>OUT · RETURN TO FOLLOW</span>
                )}
              </span>
            )}
          </React.Fragment>
        ) : (
          <span style={styles.callCardTileRoute}>Standing by</span>
        )}
      </span>
    </button>
  );
}

// A call with nobody on it yet. Same card, and deliberately so — the board is
// one fleet of ambulances and one queue of calls, and both are read the same
// way. What separates them is the square they sit in, not the shape they are.
export function PendingCallCard({ req, onOpen, now }) {
  const pri = PRIORITY[priorityKeyOf(req)];
  const waited = Math.max(0, (now || Date.now()) - callStartTs(req));

  return (
    <button style={styles.callCardTile} onClick={onOpen}>
      <span style={{ ...styles.unitCardBar, background: pri.color }} />
      <span style={styles.callCardTileBody}>
        <span style={styles.unitCardTop}>
          <span style={styles.unitCardName}>{req.nature}</span>
          <span style={{ ...styles.truckClock, color: pri.color }}>
            {shortDurationStr(waited)}
          </span>
        </span>

        <span style={styles.unitCardStatusRow}>
          <span
            style={{ ...styles.unitCardDot, background: isReturnLeg(req) ? "var(--move)" : pri.color }}
          />
          <span
            style={{
              ...styles.unitCardStatusText,
              color: isReturnLeg(req) ? "var(--move)" : pri.color,
            }}
          >
            {isReturnLeg(req) ? "RETURN LEG" : pri.label}
          </span>
        </span>

        <span style={styles.callCardTileRoute}>{callRoute(req)}</span>
        {/* The tile is a button, and the one thing the desk has to do about a
            waiting call is put a team on it — but the tile only said what was
            wrong, not that pressing it was the way to fix it. Reported as
            "the call landed and I was unable to assign a team". */}
        <span style={styles.callCardTileWait}>TAP TO ASSIGN A TEAM</span>

        {(req.scheduledFor || req.handover || isReturnLeg(req)) && (
          <span style={styles.callCardTileTags}>
            {isReturnLeg(req) && <span style={styles.legReturn}>↩ RETURN</span>}
            {req.scheduledFor && (
              <span style={styles.callTileHandover}>BOOKED {hhmm(req.scheduledFor)}</span>
            )}
            {req.handover && <span style={styles.callTileHandover}>HANDED OVER</span>}
          </span>
        )}
      </span>
    </button>
  );
}

export function CallTile({ req, unit, onOpen, dim, now }) {
  const p = PRIORITY[priorityKeyOf(req)] || {};
  const started = callStartTs(req);
  const elapsed = Math.max(0, (now || Date.now()) - started);
  const ribbon = ribbonFor(elapsed);
  const status = REQ_STATUS[req.status];
  return (
    <button
      className="tile-in"
      style={{
        ...styles.callTile,
        borderLeftColor: p.color,
        opacity: dim ? 0.75 : 1,
      }}
      onClick={onOpen}
    >
      <div style={styles.ribbonTrack}>
        <div style={{ ...styles.ribbonFill, width: `${ribbon.pct}%`, background: ribbon.color }} />
      </div>

      {status && (
        <span style={{ ...styles.callTilePill, color: status.color, borderColor: `${status.color}55` }}>
          {status.label}
        </span>
      )}

      <div style={styles.callTileNature}>{req.nature}</div>
      <div style={styles.callTileRoute}>{callRoute(req)}</div>

      <div style={styles.callTileFoot}>
        <span style={styles.callTileUnit}>{unit ? unit.name : "Unassigned"}</span>
        <span style={styles.callTileClock}>{shortDurationStr(elapsed)}</span>
      </div>

      {(assistPending(req) || req.handover) && (
        <div style={styles.callTileTags}>
          {assistPending(req) && <span style={styles.callTileAssist}>ASSIST</span>}
          {req.handover && <span style={styles.callTileHandover}>HANDED OVER</span>}
        </div>
      )}
    </button>
  );
}

// The crew's own list. Three answers per item, nothing pre-selected, and it
// cannot be filed until every item has one — a checklist with blanks in it is
// the thing everybody signs and nobody reads.
export function ChecklistCard({ part, items, checklists, onSubmit, onCancel }) {
  const [answers, setAnswers] = useState({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [shut, setShut] = useState({});
  if (!items || items.length === 0) return null;

  // The sections as administration arranged them, filtered to the items this
  // list actually carries — so a section emptied since the crew signed on does
  // not appear as an empty heading.
  const groups = checklistTree(checklists, part.key)
    .map((g) => ({ ...g, items: g.items.filter((it) => items.some((x) => x.id === it.id)) }))
    .filter((g) => g.items.length);
  const known = new Set(groups.flatMap((g) => g.items.map((it) => it.id)));
  const orphans = items.filter((it) => !known.has(it.id));
  if (orphans.length) groups.push({ id: "__rest", name: "Other", items: orphans });

  const answered = items.filter((it) => checkItemAnswered(it, answers)).length;
  const ready = answered === items.length;

  return (
    <div style={styles.checkCard}>
      <div style={styles.checkHead}>
        <span>{part.label}</span>
        <span style={styles.checkCount}>
          {answered}/{items.length}
        </span>
      </div>

      {/* The key, once, at the top. Three letters down the rows instead of
          three words on a line of their own under every item — which is what
          made a twenty-item list four screens long on a phone. */}
      <div style={styles.checkKey}>
        {CHECK_ANSWERS.map((a) => (
          <span key={a.key} style={styles.checkKeyItem}>
            <span style={{ ...styles.checkKeyDot, background: a.color }} />
            {a.label}
          </span>
        ))}
      </div>

      <div style={styles.checkList}>
        {groups.map((g) => {
          const done = g.items.filter((it) => checkItemAnswered(it, answers)).length;
          const folded = shut[g.id];
          return (
            <div key={g.id} style={styles.checkGroup}>
              <button
                style={styles.checkGroupHead}
                onClick={() => setShut((m) => ({ ...m, [g.id]: !m[g.id] }))}
              >
                <span style={styles.checkGroupChev}>{folded ? "▸" : "▾"}</span>
                <span style={styles.checkGroupName}>{g.name}</span>
                <span
                  style={
                    done === g.items.length ? styles.checkGroupTallyOn : styles.checkGroupTally
                  }
                >
                  {done}/{g.items.length}
                </span>
              </button>

              {!folded &&
                g.items.map((it) =>
                  // A line the crew write into rather than judge: a cylinder
                  // pressure, a mileage, a seal number. The words go above the
                  // box because a reading needs the room and there is no
                  // sensible way to fit a text field beside a long label on a
                  // phone.
                  isWriteItem(it) ? (
                    <div key={it.id} style={styles.checkWriteRow}>
                      <span style={styles.checkWriteLabel}>
                        {it.text}
                        <span style={styles.checkWriteTag}>WRITE IN</span>
                      </span>
                      <input
                        style={
                          checkItemAnswered(it, answers)
                            ? styles.checkWriteInputOn
                            : styles.checkWriteInput
                        }
                        value={answers[it.id] || ""}
                        maxLength={120}
                        placeholder="Type the reading"
                        aria-label={it.text}
                        onChange={(e) =>
                          setAnswers((v) => ({ ...v, [it.id]: e.target.value }))
                        }
                      />
                    </div>
                  ) : (
                    <div key={it.id} style={styles.checkRow}>
                      <span style={styles.checkRowText}>{it.text}</span>
                      {/* Three squares on the same line as the item. */}
                      <span style={styles.checkRowBtns}>
                        {CHECK_ANSWERS.map((a) => {
                          const on = answers[it.id] === a.key;
                          return (
                            <button
                              key={a.key}
                              title={a.label}
                              aria-label={`${it.text}: ${a.label}`}
                              style={{
                                ...styles.checkDot,
                                ...(on
                                  ? { background: a.color, color: "var(--ground)", borderColor: a.color }
                                  : { color: "var(--ink-4)", borderColor: "var(--hair-2)" }),
                              }}
                              onClick={() => setAnswers((v) => ({ ...v, [it.id]: a.key }))}
                            >
                              {a.key === "available" ? "✓" : a.key === "incomplete" ? "!" : "✕"}
                            </button>
                          );
                        })}
                      </span>
                    </div>
                  )
                )}
            </div>
          );
        })}
      </div>

      <input
        style={{ ...styles.input, marginTop: 10 }}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
      />

      <div style={styles.checkActions}>
        <button style={styles.ghostBtnSm} onClick={onCancel}>
          Cancel
        </button>
        <button
          style={ready ? styles.checkSubmit : styles.checkSubmitOff}
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit({ answers, note: note.trim() });
            } finally {
              setBusy(false);
            }
          }}
        >
          {ready ? (busy ? "Filing…" : "File checklist") : `${items.length - answered} left`}
        </button>
      </div>
    </div>
  );
}

export function ReceiverBanner({ req, canEdit, onSave }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [rid, setRid] = useState("");
  const [busy, setBusy] = useState(false);
  const rec = req && req.receiver ? req.receiver : null;

  if (rec && !open) {
    return (
      <div style={styles.receiverDone}>
        <CheckCircle2 size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
        Received by <strong>{rec.name}</strong> · ID {rec.receiverId}
        <span style={styles.receiverBy}>
          {" "}recorded by {rec.takenBy} at {clockStr(rec.takenAt)}
        </span>
        {canEdit && (
          <button
            style={styles.receiverEdit}
            onClick={() => {
              setName(rec.name || "");
              setRid(rec.receiverId || "");
              setOpen(true);
            }}
          >
            Change
          </button>
        )}
      </div>
    );
  }

  if (!canEdit) return null;

  if (!open) {
    return (
      <button style={styles.receiverPrompt} onClick={() => setOpen(true)}>
        <FileSignature size={15} /> WHO RECEIVED THE PATIENT?
      </button>
    );
  }

  const ready = name.trim() && rid.trim();
  return (
    <div style={styles.receiverPanel}>
      <div style={styles.receiverHead}>WHO RECEIVED THE PATIENT?</div>
      <div style={{ marginTop: 8 }}>
        <label style={styles.label}>Name</label>
        <input
          style={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nurse, doctor or technician who took over"
        />
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={styles.label}>Receiver ID</label>
        <input
          style={styles.input}
          value={rid}
          onChange={(e) => setRid(e.target.value)}
          placeholder="Their staff or badge ID"
        />
      </div>
      <div style={styles.editPanelActions}>
        <span style={styles.editPanelCount}>
          {ready ? "Ready to record." : "Both are needed."}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.ghostBtnSm} onClick={() => setOpen(false)}>Cancel</button>
          <button
            style={styles.primaryBtnSm}
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave({ name: name.trim(), receiverId: rid.trim() });
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function RefusalForm({ onSubmit, onCancel }) {
  const [name, setName] = React.useState("");
  const [nationalId, setNationalId] = React.useState("");
  const [relation, setRelation] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const ready = name.trim() && nationalId.trim() && relation.trim();

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onSubmit({ name, nationalId, relation });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.refusalPanel}>
      <div style={styles.refusalPanelHead}>
        <Ban size={12} /> WHO IS REFUSING THE TRANSFER?
      </div>
      <InfoNote>
        Taken at the bedside. The call stays yours and you still complete the remaining times as
        normal — it will be stamped AMBULANCE RESPONDED — NO TRANSPORT once this is signed.
      </InfoNote>

      <div style={{ marginTop: 8 }}>
        <label style={styles.label}>Full name</label>
        <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name of the person refusing" />
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={styles.label}>National ID</label>
        <input style={styles.input} value={nationalId} onChange={(e) => setNationalId(e.target.value)} placeholder="National ID number" />
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={styles.label}>Relationship to the patient</label>
        <input style={styles.input} value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="e.g. the patient, son, daughter, spouse, guardian" />
      </div>

      <div style={styles.refusalPanelActions}>
        <span style={styles.editPanelCount}>
          {ready ? "Ready to record." : "All three are needed before this can be recorded."}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.ghostBtnSm} onClick={onCancel}>Cancel</button>
          <button style={styles.refusalConfirmBtn} disabled={!ready || busy} onClick={submit}>
            <Ban size={12} /> Record refusal
          </button>
        </div>
      </div>
    </div>
  );
}

export function CallEditForm({ req, mode, onSubmit, onCancel }) {
  const [vals, setVals] = React.useState(() => {
    const o = {};
    EDITABLE_FIELDS.forEach((f) => {
      o[f.key] = req && req[f.key] !== undefined && req[f.key] !== null ? String(req[f.key]) : "";
    });
    return o;
  });
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Only what actually moved is worth recording — an untouched form should not
  // stamp the call with four "changes" that changed nothing.
  const changes = EDITABLE_FIELDS.map((f) => {
    const before = req && req[f.key] !== undefined && req[f.key] !== null ? String(req[f.key]) : "";
    const after = vals[f.key] || "";
    return { field: f.key, from: before.trim(), to: after.trim() };
  }).filter((c) => c.from !== c.to);

  const proposing = mode === "propose";

  async function submit() {
    if (!changes.length || busy) return;
    setBusy(true);
    try {
      await onSubmit(changes, note.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.editPanel}>
      <div style={styles.editPanelHead}>
        {proposing ? "REPORT WRONG DETAILS ON THIS CALL" : "CORRECT THE CALL DETAILS"}
      </div>
      <div style={styles.editPanelNote}>
        {proposing
          ? "Change whatever is wrong and send it to the desk. Nothing on the call moves until dispatch confirms it — the details below stay as they are until then."
          : "Whatever you change here is corrected on the call straight away, and the change is recorded against your name."}
      </div>

      {EDITABLE_FIELDS.map((f) => {
        const opts = f.options ? f.options() : null;
        return (
          <div key={f.key} style={{ marginTop: 8 }}>
            <label style={styles.label}>{f.label}</label>
            {opts ? (
              <select
                style={styles.input}
                value={vals[f.key]}
                onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
              >
                <option value="">Not stated</option>
                {opts.map((o) => (
                  <option key={o} value={o}>{f.display ? f.display(o) : o}</option>
                ))}
              </select>
            ) : (
              <input
                style={styles.input}
                value={vals[f.key]}
                onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.key === "mrn" ? "Enter the National ID number if no MRN is available" : ""}
              />
            )}
          </div>
        );
      })}

      <div style={{ marginTop: 8 }}>
        <label style={styles.label}>Note (optional)</label>
        <input
          style={styles.input}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={proposing ? "e.g. ward gave us a different MRN at the bedside" : "e.g. MRN confirmed with the ward"}
        />
      </div>

      <div style={styles.editPanelActions}>
        <span style={styles.editPanelCount}>
          {changes.length === 0
            ? "Nothing changed yet."
            : `${changes.length} change${changes.length === 1 ? "" : "s"} ready.`}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.ghostBtnSm} onClick={onCancel}>Cancel</button>
          <button style={styles.primaryBtnSm} disabled={!changes.length || busy} onClick={submit}>
            {proposing ? "Send to dispatch" : "Save correction"}
          </button>
        </div>
      </div>
    </div>
  );
}

// What the desk sees when a crew has reported something wrong. Each proposed
// change is confirmed or turned down on its own — a crew can be right about the
// MRN and wrong about the ward in the same report.
export function PendingEditReview({ req, onVerify, onReject }) {
  const pend = pendingCallEdits(req);
  if (!pend.length) return null;
  return (
    <div style={styles.editReview}>
      <div style={styles.editReviewHead}>
        <AlertTriangle size={13} /> CREW REPORTED WRONG DETAILS — {pend.length} WAITING
      </div>
      {pend.map((e) => (
        <div key={e.id} style={styles.editReviewRow}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={styles.editReviewField}>
              {editFieldLabel(e.field)}
              {/* Dispatch now raises calls with only the pick-up point, so most
                  of what comes back from a crew is information the desk never
                  had rather than a correction to something it got wrong. The two
                  need answering differently, so they are labelled differently. */}
              <span style={(e.from || "").trim() ? styles.reviewChangedTag : styles.reviewNewTag}>
                {(e.from || "").trim() ? "CHANGED" : "NEW"}
              </span>
            </div>
            <div style={styles.editReviewChange}>
              {(e.from || "").trim() ? (
                <>
                  <span style={styles.editReviewFrom}>{editValueText(e.from, e.field)}</span>
                  <ArrowRight size={11} style={{ margin: "0 5px", verticalAlign: -1 }} />
                  <span style={styles.editReviewTo}>{editValueText(e.to, e.field)}</span>
                </>
              ) : (
                <span style={styles.editReviewTo}>{editValueText(e.to, e.field)}</span>
              )}
            </div>
            <div style={styles.editReviewBy}>
              {e.by}{e.unitName ? ` · ${e.unitName}` : ""} · {hhmm(e.at)}
              {e.note ? ` — "${e.note}"` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button style={styles.ghostBtnSm} onClick={() => onReject(e)}>Turn down</button>
            <button style={styles.primaryBtnSm} onClick={() => onVerify(e)}>Confirm</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// The trail of corrections that were actually made, so the call always says who
// changed what and when.
export function EditHistory({ req }) {
  const done = callEdits(req).filter((e) => e.status === "applied");
  if (!done.length) return null;
  return (
    <div style={styles.editHistory}>
      {done.map((e) => (
        <div key={e.id} style={styles.editHistoryRow}>
          <PencilLine size={10} style={{ verticalAlign: -1, marginRight: 4 }} />
          {editFieldLabel(e.field)}: {editValueText(e.from, e.field)} → <strong>{editValueText(e.to, e.field)}</strong>
          {" · "}{e.by}{e.verifiedBy && e.verifiedBy !== e.by ? ` (confirmed by ${e.verifiedBy})` : ""}
          {" · "}{hhmm(e.verifiedAt || e.at)}
        </div>
      ))}
    </div>
  );
}

// The two ends of a call — where the patient is collected and where they are
// taken — as one "from → to" line. A call carrying no destination (an older
// record, or one raised before the destination was known) shows the pick-up
// point on its own rather than a dangling arrow.
export function CallRoute({ req, size }) {
  const from = callFrom(req);
  const to = callTo(req);
  const glyph = size || 12;
  return (
    <span style={styles.callCardMetaItem}>
      <MapPin size={glyph} />
      <span style={styles.routeFrom}>{from || "—"}</span>
      {to && (
        <React.Fragment>
          <ArrowRight size={glyph} style={{ color: "var(--ink-4)" }} />
          <span style={styles.routeTo}>{to}</span>
        </React.Fragment>
      )}
    </span>
  );
}