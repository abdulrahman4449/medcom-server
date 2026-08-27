import { PRIORITY, REQUIREMENTS } from "../domain/constants.jsx";
import { CALL_TYPES, LOADED_KM, callTypeMeta, loadedKmMeta } from "../domain/sheet-vocabulary.jsx";
import { DEFAULT_STATION, atStation } from "../domain/live-sheet.jsx";
import { callRoute } from "../domain/call-locations.jsx";
import { scheduledShiftKey } from "../domain/shift-helpers.jsx";
import { gregDateTimeStr } from "../lib/dates.jsx";
import { uid } from "../lib/helpers.jsx";
import { readKey } from "../lib/offline-queue.jsx";
import { useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { SectionBanner } from "./AdminView.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";

// ---------- a call that ran while the board was not there ----------
//
// The server goes down, or a station loses its line for two hours, and the
// department keeps working — because an ambulance service does not stop when a
// screen does. Those calls happened. They belong on the sheet, in the month's
// figures and in the patient's record, and until now there was no way to put
// them there: every call on this board is created by being dispatched, and you
// cannot dispatch something that already finished.
//
// So the desk writes it up afterwards. The same fields the sheet wants, the six
// times typed in, and — this is the part that matters — a stamp saying it was
// entered by hand, by whom, and why. A record that was reconstructed from a
// paper log an hour later is not the same kind of fact as one the crew stamped
// from the truck, and the sheet must never present the two as identical.

// The timeline, in the order it has to be typed and the order it has to run in.
export const PAST_CALL_STEPS = [
  { key: "assigned", label: "Assigned", required: true },
  { key: "enroute", label: "En route", required: false },
  { key: "arrival", label: "Arrival at scene", required: false },
  { key: "departure", label: "Departure from scene", required: false },
  { key: "arrivalDestination", label: "Arrival at destination", required: false },
  { key: "backInService", label: "Back in service", required: true },
];

export function localYmd(ts) {
  const d = new Date(ts);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

// A date and a wall-clock time, as an instant. Local, because a desk types the
// time the department was standing in, not the time in Greenwich.
export function tsFrom(ymd, hhmm) {
  if (!ymd || !hhmm) return null;
  const t = new Date(`${ymd}T${hhmm}:00`).getTime();
  return Number.isFinite(t) ? t : null;
}

// What is wrong with the times, said in the order somebody would notice it.
//
// A call that crosses midnight is not an error — a transfer that leaves at
// 23:40 and clears at 00:20 is an ordinary night — so a time that lands before
// the one before it is rolled to the next day rather than refused.
export function pastCallTimes(ymd, entered) {
  const out = {};
  let last = null;
  let rolled = false;
  for (const step of PAST_CALL_STEPS) {
    const raw = entered[step.key];
    if (!raw) continue;
    let ts = tsFrom(ymd, raw);
    if (ts === null) return { error: `${step.label} is not a time.` };
    if (last !== null && ts < last) {
      ts += 86400000;
      rolled = true;
      if (ts < last) return { error: `${step.label} is before the step above it.` };
    }
    out[step.key] = ts;
    last = ts;
  }
  for (const step of PAST_CALL_STEPS) {
    if (step.required && !out[step.key]) return { error: `${step.label} is needed.` };
  }
  if (out.backInService > Date.now() + 60000) {
    return { error: "That call finishes in the future. Check the date." };
  }
  return { times: out, rolled };
}

export function PastCallForm({ user, units, saveRequests, addLog, onDone }) {
  const now = Date.now();
  const [ymd, setYmd] = useState(() => localYmd(now));
  const [times, setTimes] = useState({});
  const [unitId, setUnitId] = useState("");
  const [alpha, setAlpha] = useState("");
  const [bravo, setBravo] = useState("");
  const [nature, setNature] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mrn, setMrn] = useState("");
  const [priority, setPriority] = useState("bls");
  const [callType, setCallType] = useState("");
  const [loadedKm, setLoadedKm] = useState("");
  const [requirements, setRequirements] = useState([]);
  const [why, setWhy] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const station = (user && user.station) || DEFAULT_STATION;
  const mine = atStation(units || [], station);

  function setTime(key, v) {
    setTimes((t) => ({ ...t, [key]: v }));
    setError("");
  }

  // Whoever is in the seats now, as a starting point. During an outage the
  // crew that ran the call may not be the crew sitting there afterwards, so
  // these are typed rather than picked.
  function pickUnit(id) {
    setUnitId(id);
    const u = mine.find((x) => x.id === id);
    if (!u) return;
    if (!alpha && u.alpha && u.alpha.name) setAlpha(u.alpha.name);
    if (!bravo && u.bravo && u.bravo.name) setBravo(u.bravo.name);
  }

  function toggleRequirement(key) {
    setRequirements((r) => (r.includes(key) ? r.filter((x) => x !== key) : [...r, key]));
  }

  async function save() {
    if (busy) return;
    const stamped = pastCallTimes(ymd, times);
    if (stamped.error) return setError(stamped.error);
    if (!nature.trim()) return setError("Say what the call was.");
    if (!unitId) return setError("Which team ran it?");
    if (!why.trim()) return setError("Say why this is being entered by hand — it goes on the record.");

    const t = stamped.times;
    const unit = mine.find((x) => x.id === unitId);
    const at = t.assigned;
    const enteredBy = (user && user.name) || "Dispatch";

    const req = {
      id: uid("req"),
      station,
      locationFrom: from.trim(),
      locationTo: to.trim(),
      location: from.trim(),
      nature: nature.trim(),
      priority,
      mrn: mrn.trim(),
      requirements,
      callType: callTypeMeta(callType) ? callType : null,
      callTypeBy: callTypeMeta(callType) ? enteredBy : "",
      callTypeAt: callTypeMeta(callType) ? at : null,
      loadedKm: loadedKmMeta(loadedKm) ? loadedKm : null,
      loadedKmBy: loadedKmMeta(loadedKm) ? enteredBy : "",
      loadedKmAt: loadedKmMeta(loadedKm) ? at : null,
      status: "completed",
      assignedUnitId: unitId,
      acknowledged: true,
      // The shift it ran on, and the day it ran on — not the shift and day it
      // is being typed on. A call written up on Thursday morning that ran on
      // Tuesday night belongs to Tuesday night, and `createdAt` is what every
      // archive, sheet and statistic files it by.
      shift: scheduledShiftKey(at),
      createdAt: at,
      ts: at,
      times: t,
      // Who ran it, as words. The board cannot credit their UHU — that is
      // worked out from who was signed on at the time, and during an outage
      // nobody was — but the sheet and the card can at least say their names.
      crewNames: { alpha: alpha.trim(), bravo: bravo.trim() },
      // The PCR belongs to a person. Alpha unless only Bravo was named.
      pcrAuthor: alpha.trim() || bravo.trim()
        ? {
            seat: alpha.trim() ? "alpha" : "bravo",
            name: alpha.trim() || bravo.trim(),
            accountId: null,
            unitId,
            unitName: unit ? unit.name : "",
            assignedAt: at,
            assignedBy: enteredBy,
          }
        : null,
      // The stamp that keeps this honest.
      enteredAfterTheFact: {
        by: enteredBy,
        accountId: (user && user.accountId) || "",
        at: Date.now(),
        reason: why.trim(),
      },
    };

    setBusy(true);
    try {
      // Read first: this is a write onto a board other people are using, and
      // the record merge behind saveRequests wants the freshest list it can get.
      const fresh = (await readKey("ems:requests", [])) || [];
      await saveRequests([req, ...fresh]);
      await addLog(
        `Call entered by hand: ${req.nature} — ${callRoute(req)} (${unit ? unit.name : "?"}), ` +
          `ran ${gregDateTimeStr(at)} to ${gregDateTimeStr(t.backInService)} · entered by ${enteredBy} · ${why.trim()}`,
        "call"
      );
      if (onDone) onDone();
    } catch (e) {
      setError((e && e.message) || "That could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const preview = pastCallTimes(ymd, times);

  return (
    <div style={styles.requestForm}>
      <InfoNote label="What this is for">
        Calls the department ran while the board was not available — a server outage, a station
        without a line. They belong on the sheet and in the month's figures. Every one is stamped
        as entered by hand, with who entered it and why, because a call reconstructed from a paper
        log is not the same kind of record as one a crew stamped from the truck.
        <br />
        <br />
        The hours cannot be credited to anybody's UHU: that is worked out from who was signed on at
        the time, and during an outage nobody was. Name the crew below and their names go on the
        card and the sheet.
      </InfoNote>

      <div style={styles.formRow}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label style={styles.label}>Date it ran</label>
          <input style={styles.input} type="date" value={ymd} onChange={(e) => { setYmd(e.target.value); setError(""); }} />
        </div>
        <div style={{ flex: 2, minWidth: 180 }}>
          <label style={styles.label}>Team</label>
          <select style={styles.assignSelect} value={unitId} onChange={(e) => pickUnit(e.target.value)}>
            <option value="">Which team ran it…</option>
            {mine.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>

      <label style={styles.label}>The times, as they happened</label>
      <div style={styles.pastTimes}>
        {PAST_CALL_STEPS.map((step) => (
          <label key={step.key} style={styles.pastTimeField}>
            <span style={styles.pastTimeLabel}>
              {step.label}
              {step.required ? <span style={styles.pastTimeNeeded}> · needed</span> : ""}
            </span>
            <input
              style={styles.input}
              type="time"
              value={times[step.key] || ""}
              onChange={(e) => setTime(step.key, e.target.value)}
            />
          </label>
        ))}
      </div>
      {preview.rolled && (
        <div style={styles.formHint}>
          This call runs past midnight — the later times are being read as the next day.
        </div>
      )}

      <div style={styles.formRow}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label style={styles.label}>Alpha</label>
          <input style={styles.input} value={alpha} onChange={(e) => setAlpha(e.target.value)} placeholder="Who was in the seat" />
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label style={styles.label}>Bravo</label>
          <input style={styles.input} value={bravo} onChange={(e) => setBravo(e.target.value)} placeholder="If a second seat was crewed" />
        </div>
      </div>

      <div style={styles.formRow}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label style={styles.label}>Location from (pick-up)</label>
          <input style={styles.input} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="e.g. Ward 4B" />
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label style={styles.label}>Location to (destination)</label>
          <input style={styles.input} value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. CT" />
        </div>
      </div>

      <div style={styles.formRow}>
        <div style={{ flex: 2, minWidth: 180 }}>
          <label style={styles.label}>Nature of call</label>
          <input style={styles.input} value={nature} onChange={(e) => { setNature(e.target.value); setError(""); }} placeholder="e.g. Chest pain, 54M" />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={styles.label}>MRN</label>
          <input style={styles.input} value={mrn} onChange={(e) => setMrn(e.target.value)} placeholder="Patient MRN, if known" />
        </div>
      </div>

      <div style={styles.formRow}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label style={styles.label}>Level of care</label>
          <select style={styles.assignSelect} value={priority} onChange={(e) => setPriority(e.target.value)}>
            {Object.keys(PRIORITY).map((k) => (
              <option key={k} value={k}>{PRIORITY[k].label}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label style={styles.label}>Cat. of call</label>
          <select style={styles.assignSelect} value={callType} onChange={(e) => setCallType(e.target.value)}>
            <option value="">Not coded</option>
            {CALL_TYPES.map((c) => (
              <option key={c.key} value={c.key}>{c.key} — {c.name}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label style={styles.label}>Loaded kilometres</label>
          <select style={styles.assignSelect} value={loadedKm} onChange={(e) => setLoadedKm(e.target.value)}>
            <option value="">Not coded</option>
            {LOADED_KM.map((c) => (
              <option key={c.key} value={c.key}>{c.key} — {c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <label style={styles.label}>What it needed</label>
      <div style={styles.checklistRow}>
        {REQUIREMENTS.map((r) => (
          <button
            key={r.key}
            style={requirements.includes(r.key) ? styles.reasonPillActive : styles.reasonPill}
            onClick={() => toggleRequirement(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <label style={styles.label}>Why is this being entered by hand?</label>
      <input
        style={styles.input}
        value={why}
        onChange={(e) => { setWhy(e.target.value); setError(""); }}
        placeholder="e.g. Server unreachable 14:00–16:30, taken from the station's paper log"
      />

      {error && <div style={styles.loginError}>{error}</div>}

      <div style={styles.backupActions}>
        <button style={styles.primaryBtnSm} disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Add this call to the record"}
        </button>
        <button style={styles.ghostBtnSm} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

// The banner and the button that opens it.
export function PastCallSection({ user, units, saveRequests, addLog }) {
  const [open, setOpen] = useState(false);
  if (!user || (user.role !== "dispatcher" && user.role !== "admin")) return null;
  return (
    <div>
      <SectionBanner
        title="ADD A CALL THE BOARD MISSED"
        action={
          <button style={styles.bannerBtn} onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Write one up"}
          </button>
        }
      />
      {open && (
        <PastCallForm
          user={user}
          units={units}
          saveRequests={saveRequests}
          addLog={addLog}
          onDone={() => setOpen(false)}
        />
      )}
    </div>
  );
}
