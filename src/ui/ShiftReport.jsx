import { isBoardLogEntry, stationOf, stationShort } from "../domain/live-sheet.jsx";
import { shortDurationStr } from "../domain/messages.jsx";
import { crewOnDuty, hhmm, overtimeMs, scheduledShiftKey, seatLabel, shiftMeta, shiftWindowAt } from "../domain/shift-helpers.jsx";
import { SHIFT_EVENTS } from "../domain/shifts.jsx";
import { actorPost, actorStampText } from "../export/name-stamps.jsx";
import { gregShortDateTimeStr } from "../lib/dates.jsx";
import { ChevronRight } from "../lib/icons.jsx";
import { useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";

// ---------- log sheet ----------

export const LOG_COLORS = {
  call: "var(--hold)",
  assign: "var(--flow)",
  status: "var(--ink-3)",
  clear: "var(--ok)",
  shift: "#818CF8",
};

// The two lines the log sheet still carries, colour-coded so a desk can tell
// them apart down the edge of the panel without reading the sentence.
export const BOARD_EVENTS = {
  ack: { label: "ACKNOWLEDGED", color: "var(--ok)" },
  enroute: { label: "EN ROUTE", color: "var(--flow)" },
};

// The log sheet doubles as the shift record: every sign-on, sign-off, swap and
// overtime crossing lands here as a "shift" entry carrying a structured detail
// record, and the Shift Swaps tab shows nothing else — who came on, which of
// the two 12-hour shifts they're working, who they relieved, and how much
// overtime came with it.
//
// The activity tab is deliberately narrow. Dispatch and admin used to get every
// line the app wrote, which on a busy shift buried the two answers a desk
// actually watches for — did the crew hear the call, and are they rolling —
// under codings, bookings, status flips and closures. Those are all still
// written and still exported; this panel shows the acknowledgement and the
// en-route stamp, and points at the spreadsheet for the rest.
export function LogSheet({ log, units, station }) {
  const [tab, setTab] = useState("all");
  // Folded on arrival. The feed is reference — a desk reads it when something
  // needs checking, not while it is answering a call — and open by default it
  // pushed the board off the screen.
  const [feedOpen, setFeedOpen] = useState(false);
  const now = Date.now();
  // A desk reads its own station's log and nothing else. An administrator has
  // no station on their session, so they read both — which is the one place
  // the two are meant to be visible together.
  const scoped = station ? log.filter((e) => stationOf(e) === station) : log;
  const shiftEntries = scoped.filter((e) => e.type === "shift");
  const boardEntries = scoped.filter(isBoardLogEntry);
  // One feed rather than two tabs. "Acknowledged & en route" and "shift swaps"
  // were the same thing split in half — the log of what happened on this board —
  // and splitting it meant neither list told the whole story. Newest first,
  // everything together.
  const shown = [...shiftEntries, ...boardEntries].sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const scheduled = shiftMeta(scheduledShiftKey(now));
  const liveWindow = shiftWindowAt(now);
  const onDuty = crewOnDuty(units);
  const overtimeCount = onDuty.filter((row) => overtimeMs(row.member, now) > 0).length;

  return (
    <div style={styles.logPanel}>
      {/* Foldable: on a desk that is watching calls, the feed is reference
          rather than something to be stared at. */}
      <button style={styles.logHeaderBtn} onClick={() => setFeedOpen((v) => !v)}>
        <ChevronRight
          size={13}
          style={{
            transform: feedOpen ? "rotate(90deg)" : "none",
            transition: "transform .15s ease",
            marginRight: 7,
          }}
        />
        <span>EVENT LOG</span>
        <span style={styles.logHeaderCount}>{shown.length}</span>
      </button>

      <div style={styles.shiftBanner}>
        <span style={{ ...styles.shiftTag, color: scheduled.color, borderColor: scheduled.color }}>
          {scheduled.glyph} {scheduled.label}
        </span>
        <span style={styles.shiftBannerWindow}>{scheduled.window}</span>
        <span style={styles.shiftBannerCrew}>{onDuty.length} on duty</span>
        {overtimeCount > 0 && <span style={styles.otTag}>{overtimeCount} on overtime</span>}
      </div>
      <div style={styles.shiftBannerDate}>
        Running since {gregShortDateTimeStr(liveWindow.start)} · ends {gregShortDateTimeStr(liveWindow.end)}
      </div>

      <InfoNote label="What is in this log?">
        Acknowledgements, en-route stamps and shift changes. Everything else — assignments, status
        changes, codings, bookings and closures — is still recorded and goes out on the Event Log
        sheet of the spreadsheet, filed under the shift it happened on.
      </InfoNote>

      {feedOpen && (
        <div style={styles.logList}>
          {shown.length === 0 && (
            <div style={styles.logEmpty}>Nothing recorded on this board yet.</div>
          )}
          {shown.map((entry) => (
            <LogEntryRow key={entry.id} entry={entry} showStation={!station} />
          ))}
        </div>
      )}
    </div>
  );
}

// A log line carries the name of whoever put it there, because neither the
// medics nor the desk keep the same people for long — the unit name alone
// doesn't say who was on it. A shift entry also shows the swap broken out as
// chips, so the handover can be read at a glance. Entries from before either
// record existed fall back to the sentence alone.
export function LogEntryRow({ entry, showStation }) {
  const detail = entry.type === "shift" ? entry.detail : null;
  const event = detail && SHIFT_EVENTS[detail.kind];
  // An acknowledgement or an en-route stamp. Anything else in the feed never
  // reaches this row any more, but a line written before events were tagged
  // still renders as the plain sentence it always did.
  const boardEvent =
    entry.type !== "shift" && entry.detail && BOARD_EVENTS[entry.detail.event]
      ? BOARD_EVENTS[entry.detail.event]
      : null;
  const meta = detail ? shiftMeta(detail.shift) : null;
  const from = detail ? shiftMeta(detail.fromShift) : null;
  const relieved = detail ? shiftMeta(detail.relievedShift) : null;
  const actor = entry.actor && entry.actor.name ? entry.actor : null;
  const post = actorPost(actor);

  return (
    <div
      style={{
        ...styles.logEntry,
        borderLeftColor:
          (event ? event.color : boardEvent ? boardEvent.color : LOG_COLORS[entry.type]) || "var(--hair-3)",
      }}
    >
      <div style={styles.logTopRow}>
        <span style={styles.logTime}>{entry.time}</span>
        {/* Only worth saying when both stations are in the same feed. On a
            desk's own log every line is its own station and the tag would be
            noise on every row. */}
        {showStation && (
          <span style={styles.logStationTag}>{stationShort(stationOf(entry))}</span>
        )}
        {boardEvent && (
          <span
            style={{ ...styles.shiftEventTag, color: boardEvent.color, borderColor: boardEvent.color }}
          >
            {boardEvent.label}
          </span>
        )}
        {actor && (
          <span style={styles.logStamp} title={`Logged by ${actorStampText(actor)}`}>
            <span style={styles.logStampName}>{actor.name}</span>
            {post && <span style={styles.logStampPost}>{post}</span>}
          </span>
        )}
      </div>
      <div style={styles.logMessage}>{entry.message}</div>
      {detail && (
        <div style={styles.shiftDetailRow}>
          {event && (
            <span style={{ ...styles.shiftEventTag, color: event.color, borderColor: event.color }}>
              {event.label}
            </span>
          )}
          {detail.unitName && (
            <span style={styles.shiftDetailChip}>
              {detail.unitName}
              {detail.seat ? ` · ${seatLabel(detail.seat)}` : ""}
            </span>
          )}
          {from && <span style={styles.shiftDetailChip}>{from.short} →</span>}
          {meta && (
            <span style={{ ...styles.shiftTag, color: meta.color, borderColor: meta.color }}>
              {meta.glyph} {meta.short}
            </span>
          )}
          {detail.shiftStart && (
            <span style={styles.shiftDetailChip}>
              {hhmm(detail.shiftStart)}–{hhmm(detail.shiftEnd)}
            </span>
          )}
          {detail.overtimeMs > 0 && <span style={styles.otTag}>OT {shortDurationStr(detail.overtimeMs)}</span>}
          {detail.relievedName && (
            <span style={styles.shiftDetailChip}>
              relieved {detail.relievedName}
              {relieved ? ` (${relieved.short})` : ""}
              {detail.relievedOvertimeMs > 0 ? ` · ${shortDurationStr(detail.relievedOvertimeMs)} OT` : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}