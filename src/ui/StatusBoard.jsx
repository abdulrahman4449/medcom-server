import { gregDateTimeStr } from "../lib/dates.jsx";
import { callCloseReason, callWasCancelled } from "../domain/close-reasons.jsx";
import { responseCompliance } from "../domain/compliance.jsx";
import { REQ_STATUS, STATUS, TIME_STEPS } from "../domain/constants.jsx";
import { ON_CALL_STATUSES, effectiveStatus } from "../domain/in-service.jsx";
import { stationOf } from "../domain/live-sheet.jsx";
import { clockStr, msDurationStr } from "../domain/messages.jsx";
import { NO_TRANSPORT, REFUSAL_TIME_KEY, REFUSAL_TIME_LABEL } from "../domain/outcomes.jsx";
import { pcrAuthorOf, pcrAuthorText } from "../domain/pcr-author.jsx";
import { assistOf, assistTeams, isNoTransport } from "../domain/second-ambulance.jsx";
import { CALL_TYPES, LOADED_KM, LOADED_KM_COLOR, callTypeMeta, callTypeOf, loadedKmOf, suggestedCallType } from "../domain/sheet-vocabulary.jsx";
import { uhuWindowStart } from "../domain/uhu.jsx";
import { Ambulance, Ban, CircleSlash, FileSignature, HandRaised, Ruler, Tag } from "../lib/icons.jsx";
import { styles } from "../styles.jsx";

// ---------- status board ----------

// The station at a glance.
//
// Five equal boxes counting five statuses answered a question nobody asks. What
// a desk needs to know when it looks up is one number — how many can I send —
// so that is the number that is large. Everything else is annotation, and the
// bar underneath carries the same information in a shape you can read without
// counting.
// The state of the room, in four numbers.
//
// This is the change the whole remodel is built around. The board could already
// be read — by counting cards. A dispatcher wanting to know whether there was
// anything left to send had to look at eight tiles and add up the green ones,
// which is a thing you do slowly, and which you do wrong when the phone is
// ringing. So the answer is stated instead of implied, in figures sized to be
// read from across the room rather than from in front of the screen.
//
// Four, and no more. Available is what a desk taking a call needs; on a call
// and out of service are what makes the first number make sense; the shift's
// call count is the only piece of history that belongs on a live board. Every
// other figure worth having is on the statistics page, where somebody is
// reading rather than working.
export function StatusBoard({ units, requests, station }) {
  const now = Date.now();
  // Counted from what each unit's status actually is, not from the field stored
  // on it. A crew that signed off without the write landing left "available"
  // behind, and this strip reported a truck ready to go when nobody was on it.
  const counts = Object.keys(STATUS).reduce((acc, k) => ({ ...acc, [k]: 0 }), {});
  (units || []).forEach((u) => {
    const k = effectiveStatus(u, requests);
    counts[k] = (counts[k] || 0) + 1;
  });

  const free = counts.available || 0;
  const onCall = ON_CALL_STATUSES.reduce((n, k) => n + (counts[k] || 0), 0);
  const oos = counts.oos || 0;

  // Only this shift's calls. A running total since the board was created tells
  // a desk nothing about the twelve hours they are actually standing.
  const shiftFrom = uhuWindowStart(now);
  const shiftCalls = requests
    ? (requests || []).filter(
        (r) =>
          r &&
          r.createdAt >= shiftFrom &&
          (!station || stationOf(r) === station)
      )
    : null;
  const resp = shiftCalls ? responseCompliance(shiftCalls, shiftFrom, now + 1) : null;

  // Nothing free is the one number on this strip that is allowed to shout, and
  // it does it by turning the colour the rest of the board uses for a call in
  // progress rather than by growing or flashing.
  const freeColor = free === 0 ? "var(--crit)" : "var(--ok)";

  return (
    <div style={styles.roomState}>
      <div style={styles.roomCell}>
        <span style={{ ...styles.roomFigure, color: freeColor }}>{free}</span>
        <span style={styles.roomLabel}>AVAILABLE</span>
      </div>
      <div style={styles.roomCell}>
        <span style={{ ...styles.roomFigure, color: onCall ? "var(--hold)" : "var(--ink-4)" }}>
          {onCall}
        </span>
        <span style={styles.roomLabel}>ON A CALL</span>
      </div>
      <div style={styles.roomCell}>
        <span style={{ ...styles.roomFigure, color: "var(--ink-4)" }}>{oos}</span>
        <span style={styles.roomLabel}>OUT OF SERVICE</span>
      </div>
      {shiftCalls && (
        <div style={styles.roomCellWide}>
          <span style={{ ...styles.roomFigure, color: "var(--ink)" }}>{shiftCalls.length}</span>
          <span style={styles.roomLabel}>THIS SHIFT</span>
          {resp && resp.avg !== null && (
            <span style={styles.roomAside}>avg response {msDurationStr(resp.avg)}</span>
          )}
        </div>
      )}
    </div>
  );
}

// Every stamp on a call, in the order it was made: the fixed timeline steps,
// plus — sitting where it happened, between arrival and departure — the moment
// the patient refused the transfer, if they did. The refusal is picked out in
// its own colour because it is the one stamp that changes what the call was.
export function callTimeChips(times) {
  const t = times || {};
  const chips = [];
  const refused = t[REFUSAL_TIME_KEY];
  let refusalPlaced = false;
  const pushRefusal = () => {
    if (refused && !refusalPlaced) {
      refusalPlaced = true;
      chips.push({ key: REFUSAL_TIME_KEY, label: REFUSAL_TIME_LABEL, ts: refused, color: NO_TRANSPORT.color });
    }
  };
  TIME_STEPS.forEach((s) => {
    if (t[s.timeKey]) chips.push({ key: s.timeKey, label: s.timeLabel, ts: t[s.timeKey] });
    // A refusal recorded without an arrival stamp (an older record, or a crew
    // who marked it before the step) still appears — just earlier in the row.
    if (s.timeKey === "arrival") pushRefusal();
  });
  pushRefusal();
  return chips;
}

// The five stamps as a stepper rather than a row of chips.
//
// Chips answer "what times were recorded". They do not answer "where are we",
// which is the question a crew and a desk both actually have — and answering it
// from a row of chips means reading every label and working out which one is
// missing. A stepper answers it without reading: ticks behind, a ring on the
// step being worked, nothing ahead.
//
// A refusal sits in the line where it happened rather than at the end, because
// it is a thing that occurred between two stamps and reading it out of order
// misrepresents the call.
export function CallStepper({ req, compact }) {
  const t = (req && req.times) || {};
  const rows = [];
  if (t.assigned) {
    rows.push({ key: "assigned", label: "Assigned", ts: t.assigned, done: true });
  }
  TIME_STEPS.forEach((step) => {
    rows.push({
      key: step.timeKey,
      label: step.timeLabel,
      ts: t[step.timeKey] || null,
      done: !!t[step.timeKey],
    });
    if (step.timeKey === "arrival" && t[REFUSAL_TIME_KEY]) {
      rows.push({
        key: REFUSAL_TIME_KEY,
        label: REFUSAL_TIME_LABEL,
        ts: t[REFUSAL_TIME_KEY],
        done: true,
        color: NO_TRANSPORT.color,
      });
    }
  });

  const currentIdx = rows.findIndex((r) => !r.done);

  return (
    <div style={compact ? styles.stepperCompact : styles.stepper}>
      {rows.map((row, i) => {
        const current = i === currentIdx;
        const tint = row.color || (row.done ? "var(--ok)" : current ? "var(--flow)" : "var(--hair-2)");
        const last = i === rows.length - 1;
        return (
          <div key={row.key} style={styles.stepperRow}>
            <div style={styles.stepperRail}>
              <div
                style={{
                  ...styles.stepperDot,
                  background: row.done ? tint : "var(--inset)",
                  borderColor: tint,
                }}
              >
                {row.done && <span style={styles.stepperTick}>✓</span>}
                {current && <span style={styles.stepperPip} />}
              </div>
              {!last && (
                <div
                  style={{
                    ...styles.stepperLine,
                    background: row.done ? tint : "var(--hair-2)",
                  }}
                />
              )}
            </div>
            <div style={last ? styles.stepperTextLast : styles.stepperText}>
              <span
                style={{
                  ...styles.stepperLabel,
                  color: row.done
                    ? "var(--ink-2)"
                    : current
                    ? "var(--ink)"
                    : "var(--ink-4)",
                  fontWeight: current ? 700 : 500,
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  ...styles.stepperTime,
                  color: row.done ? "var(--ink)" : "var(--ink-4)",
                }}
              >
                {row.ts ? clockStr(row.ts) : "—"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// The same five stamps, reduced to a bar. On the desk's board there are eight
// of these on screen at once and there is no room for a stepper — but "how far
// through is it" is still the question, so it is answered in segments: filled
// behind, hollow ahead, in the colour the call's current stage already uses.
export function CallProgress({ req }) {
  const t = (req && req.times) || {};
  const tint = (REQ_STATUS[req && req.status] || {}).color || "var(--flow)";
  return (
    <div style={styles.callProgress}>
      {TIME_STEPS.map((step) => (
        <div
          key={step.timeKey}
          title={step.timeLabel + (t[step.timeKey] ? ` — ${clockStr(t[step.timeKey])}` : "")}
          style={{
            ...styles.callProgressSeg,
            background: t[step.timeKey] ? tint : "var(--hair-2)",
          }}
        />
      ))}
    </div>
  );
}

// A call whose times were typed in afterwards, rather than stamped from the
// truck. Wherever the times are shown, this is shown with them: a record
// reconstructed from a paper log an hour later is a different kind of fact from
// one a crew pressed at the moment it happened, and a sheet that presents the
// two identically is a sheet that quietly overstates itself.
export function ByHandTag({ req }) {
  const h = req && req.enteredAfterTheFact;
  if (!h) return null;
  return (
    <span
      style={styles.byHandTag}
      title={
        `Entered by ${h.by || "the desk"}` +
        (h.at ? ` on ${gregDateTimeStr(h.at)}` : "") +
        (h.reason ? ` — ${h.reason}` : "")
      }
    >
      ✎ ENTERED BY HAND
    </span>
  );
}

export function CallTimes({ times, req }) {
  const chips = callTimeChips(times);
  if (chips.length === 0) return null;
  return (
    <div style={styles.timesRow}>
      {req && req.enteredAfterTheFact && <ByHandTag req={req} />}
      {chips.map((c) => (
        <div key={c.key} style={c.color ? { ...styles.timeChip, borderColor: c.color } : styles.timeChip}>
          <span style={c.color ? { ...styles.timeChipLabel, color: c.color } : styles.timeChipLabel}>{c.label}</span>
          <span style={styles.timeChipValue}>{clockStr(c.ts)}</span>
        </div>
      ))}
    </div>
  );
}

// The one-line stamp a call carries once the patient has refused the transfer:
// the ambulance responded, nobody was moved. Sits with the status pills on the
// desk, on the crew's own card, in the history and on the admin monitor, so
// there is no view of the call where the outcome has to be inferred.
export function NoTransportTag({ req, style }) {
  if (!isNoTransport(req)) return null;
  const at = req.times ? req.times[REFUSAL_TIME_KEY] : null;
  const signed = req.refusal || null;
  return (
    <span
      style={{ ...styles.noTransportTag, ...style }}
      title={
        `Patient refused the transfer${at ? ` at ${clockStr(at)}` : ""}` +
        (signed ? ` — signed by ${signed.name} (${signed.relation}, National ID ${signed.nationalId})` : "")
      }
    >
      <Ban size={11} /> {NO_TRANSPORT.label}
    </span>
  );
}

// The matching stamp for a call that was never run at all — stood down, called
// off by the ward, a duplicate, nobody at the pickup point. It reads off the
// close reason, so it only ever appears on a closed call, and it is what makes
// the "Cancelled requests" filter legible: a card in that list says on its face
// why it is there instead of leaving the reason to be found three lines down.
export function CancelledTag({ req, style }) {
  if (!callWasCancelled(req)) return null;
  return (
    <span style={{ ...styles.cancelledCallTag, ...style }} title={callCloseReason(req)}>
      <CircleSlash size={11} /> CANCELLED
    </span>
  );
}

// Who is writing the patient care report for this call, carried on every view
// of it: the crew's own card, the desk, the admin monitor and the history. Once
// a crew are sitting at the destination with the call still open, the missing
// name is usually the reason — so at that point the absence is shown too,
// rather than leaving a desk to guess why nobody has gone back in service.
export function PcrAuthorTag({ req, style }) {
  const a = pcrAuthorOf(req);
  if (!a) {
    if (!req || req.status !== "arrived") return null;
    return (
      <span
        style={{ ...styles.pcrAuthorTagPending, ...style }}
        title="The crew have not named a PCR author yet — the call cannot go back in service until they do"
      >
        <FileSignature size={11} /> PCR AUTHOR NOT SET
      </span>
    );
  }
  return (
    <span style={{ ...styles.pcrAuthorTag, ...style }} title={`PCR author: ${pcrAuthorText(req)}`}>
      <FileSignature size={11} /> PCR: {pcrAuthorText(req)}
    </span>
  );
}

// The two codes as they read on a card: the letter or the number first, because
// that is what goes on the sheet, with what it means alongside so nobody has to
// hold the table in their head. They appear on every view of a call — the desk,
// the crew's own card, the admin monitor and the history — so a call that has
// not been coded is visibly uncoded wherever it is looked at.
export function CallTypeTag({ req, style }) {
  const t = callTypeOf(req);
  if (!t) return null;
  return (
    <span
      style={{ ...styles.codeTag, borderColor: t.color, color: t.color, ...style }}
      title={`Category of call ${t.key} — ${t.desc}${req.callTypeBy ? ` · set by ${req.callTypeBy}` : ""}`}
    >
      <Tag size={11} /> TYPE {t.key} · {t.name}
    </span>
  );
}

export function LoadedKmTag({ req, style }) {
  const k = loadedKmOf(req);
  if (!k) return null;
  return (
    <span
      style={{ ...styles.codeTag, borderColor: LOADED_KM_COLOR, color: LOADED_KM_COLOR, ...style }}
      title={`Loaded kilometers band ${k.key} — ${k.desc}${req.loadedKmBy ? ` · set by ${req.loadedKmBy}` : ""}`}
    >
      <Ruler size={11} /> KM {k.key} · {k.name}
    </span>
  );
}

// The picker for both codes, in one block. Wherever it is drawn — the desk's
// call card, the crew's card, the history list — it is the same block doing the
// same thing, because the desk and the crew are filling in the same two boxes on
// the same sheet and a different layout in each place would only invite them to
// be filled in differently.
//
// Wide, thumb-sized targets for the same reason the PCR seats are: this is
// pressed on a tablet in a moving vehicle.
//
// `missing` is the subset of ["callType", "loadedKm"] that is currently holding
// a call open. It is only ever passed on the crew's own card, at the last step;
// everywhere else the block is drawn quietly, because everywhere else these are
// two boxes somebody is helpfully filling in rather than the thing between a
// crew and the end of their call.
export function CallCodingBlock({ req, onSet, title, hint, missing }) {
  const type = callTypeOf(req);
  const km = loadedKmOf(req);
  const suggested = type ? null : suggestedCallType(req);
  const needType = !!missing && missing.includes("callType");
  const needKm = !!missing && missing.includes("loadedKm");
  const required = needType || needKm;

  return (
    <div style={required ? styles.codingBlockRequired : styles.codingBlock}>
      <div style={required ? styles.codingHeaderRequired : styles.codingHeader}>
        <Tag size={11} /> {title || "CALL TYPE & LOADED KILOMETERS"}
        {required ? " — REQUIRED BEFORE BACK IN SERVICE" : ""}
      </div>

      <div style={needType ? styles.codingRowLabelRequired : styles.codingRowLabel}>
        CATEGORY OF CALL{needType ? " — NOT SET" : ""}
      </div>
      <div style={styles.codingChoices}>
        {CALL_TYPES.map((t) => {
          const on = !!type && type.key === t.key;
          const isSuggested = suggested === t.key;
          return (
            <button
              key={t.key}
              type="button"
              style={{
                ...(on ? styles.codeChoiceOn : styles.codeChoice),
                borderColor: on ? t.color : isSuggested ? "rgba(245,158,11,0.7)" : "var(--hair-2)",
                ...(on ? { color: t.color } : null),
              }}
              title={`${t.key} — ${t.desc}`}
              onClick={() => onSet("callType", t.key)}
            >
              <span style={styles.codeChoiceKey}>{t.key}</span>
              <span style={styles.codeChoiceName}>{t.name}</span>
            </button>
          );
        })}
      </div>
      {suggested && (
        <div style={styles.codingSuggestion}>
          This call looks like a <strong>{suggested}</strong> —{" "}
          {callTypeMeta(suggested).desc.toLowerCase()}. Tap it to record that, or pick another.
        </div>
      )}

      <div
        style={{
          ...(needKm ? styles.codingRowLabelRequired : styles.codingRowLabel),
          marginTop: 10,
        }}
      >
        LOADED KILOMETERS{needKm ? " — NOT SET" : ""}
      </div>
      <div style={styles.codingChoices}>
        {LOADED_KM.map((k) => {
          const on = !!km && km.key === k.key;
          return (
            <button
              key={k.key}
              type="button"
              style={{
                ...(on ? styles.codeChoiceOn : styles.codeChoice),
                borderColor: on ? LOADED_KM_COLOR : "var(--hair-2)",
                ...(on ? { color: LOADED_KM_COLOR } : null),
              }}
              title={`${k.key} — ${k.desc}`}
              onClick={() => onSet("loadedKm", k.key)}
            >
              <span style={styles.codeChoiceKey}>{k.key}</span>
              <span style={styles.codeChoiceName}>{k.name}</span>
            </button>
          );
        })}
      </div>

      {/* Only when something is outstanding, and then only what is outstanding.
          The standing paragraph explaining who may set the codes appeared on
          every call and was read once, by everybody, months ago. */}
      {(required || hint || (type && req.callTypeBy) || (km && req.loadedKmBy)) && (
        <div style={required ? styles.codingNoteRequired : styles.codingNote}>
          {required
            ? `${needType && needKm ? "Both codes" : needType ? "Category of call" : "Loaded kilometers"} needed to go back in service.`
            : hint || ""}
          {type && req.callTypeBy ? `${required || hint ? " · " : ""}Type ${type.key} by ${req.callTypeBy}` : ""}
          {km && req.loadedKmBy ? ` · Km ${km.key} by ${req.loadedKmBy}` : ""}
        </div>
      )}
    </div>
  );
}

// The same two codes as a pair of intake selects, for the forms where a call is
// being written down rather than worked. Optional on both: a desk taking a call
// on the radio should never be held up by a code the crew will know better in
// twenty minutes.
export function CallCodingFields({ callType, setCallType, loadedKm, setLoadedKm }) {
  return (
    <div style={styles.formRow}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <label style={styles.label}>Call type (CAT. OF CALL) — optional</label>
        <select style={styles.input} value={callType} onChange={(e) => setCallType(e.target.value)}>
          <option value="">Not coded yet</option>
          {CALL_TYPES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.key} — {t.desc}
            </option>
          ))}
        </select>
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <label style={styles.label}>Loaded kilometers — optional</label>
        <select style={styles.input} value={loadedKm} onChange={(e) => setLoadedKm(e.target.value)}>
          <option value="">Not coded yet</option>
          {LOADED_KM.map((k) => (
            <option key={k.key} value={k.key}>
              {k.key} — {k.desc}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// Where the ask for a second ambulance has got to, shown on the call itself.
// Read by the crew who asked (is help coming?) and by every desk (has this been
// dealt with?), which is why it says the same thing in both places.
export function AssistStatusLine({ req, units }) {
  const a = assistOf(req);
  if (!a) return null;
  const helping = assistTeams(req).filter((t) => !t.clearedAt);
  const done = assistTeams(req).filter((t) => t.clearedAt);
  return (
    <div style={styles.assistStatusLine}>
      {a.status === "pending" && (
        <span style={styles.assistStatusWaiting}>
          <HandRaised size={11} /> Second ambulance asked for at {clockStr(a.requestedAt)}
          {a.requestedByUnitName ? ` by ${a.requestedByUnitName}` : ""}
          {a.detail ? ` — ${a.detail}` : ""}
        </span>
      )}
      {a.status === "cancelled" && (
        <span style={styles.assistStatusStood}>
          Assist stood down{a.cancelledBy ? ` by ${a.cancelledBy}` : ""}
          {a.cancelledAt ? ` at ${clockStr(a.cancelledAt)}` : ""}
          {/* The desk's reason, in their words, where the crew who asked will
              see it. */}
          {a.cancelledReason ? <strong style={styles.assistReason}>“{a.cancelledReason}”</strong> : null}
        </span>
      )}
      {helping.map((t) => {
        const u = (units || []).find((x) => x.id === t.unitId);
        return (
          <span key={t.unitId} style={styles.assistStatusHelping}>
            <Ambulance size={11} /> {t.unitName || (u ? u.name : t.unitId)} assisting since{" "}
            {clockStr(t.assignedAt)}
            {t.acknowledgedAt ? "" : " · not acknowledged yet"}
          </span>
        );
      })}
      {done.map((t) => (
        <span key={`${t.unitId}-done`} style={styles.assistStatusDone}>
          {t.unitName || t.unitId} assisted {clockStr(t.assignedAt)}–{clockStr(t.clearedAt)}
        </span>
      ))}
    </div>
  );
}