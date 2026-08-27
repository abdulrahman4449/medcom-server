import { PRIORITY, REQUIREMENTS, priorityKeyOf } from "../domain/constants.jsx";
import { stationLabel } from "../domain/live-sheet.jsx";
import { patientRecords, recordMatches } from "../domain/patient-records.jsx";
import { hhmm } from "../domain/shift-helpers.jsx";
import { gregDateStr } from "../lib/dates.jsx";
import { Search } from "../lib/icons.jsx";
import { useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { FoldingSection } from "./AdminView.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";

// ---------- the patient record, for the desk ----------
//
// A ward rings about a patient the department has moved eleven times. Until now
// the desk had no way to know that: the eleven journeys were eleven call cards
// spread across three closed shifts and two archived days, findable only by
// remembering roughly when.
//
// Typed by MRN — the one field on a transfer that identifies a person, and the
// one the desk already fills in. It answers the three things somebody taking a
// booking asks: have we had them before, where do they usually go, and what did
// they need last time.
//
// Read-only, deliberately. It is a window onto what the board already holds,
// not a second place where patient details are kept.

const REQ_LABEL = (k) => {
  const r = REQUIREMENTS.find((x) => x.key === k);
  return r ? r.label : k;
};

function whenShort(ts) {
  if (!ts) return "—";
  return `${gregDateStr(ts)} ${hhmm(ts)}`;
}

export function PatientRecords({ requests, scheduled, archives, units }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [openMrn, setOpenMrn] = useState(null);

  const records = patientRecords(requests, scheduled, archives);
  const q = query.trim().toLowerCase();
  const shown = records.filter((r) => recordMatches(r, q));
  // Without a search this is a list of everybody the department has ever moved,
  // which is not a thing anybody reads. The most recent twenty answer "who have
  // we had lately"; anything older is found by typing.
  const list = q ? shown.slice(0, 60) : shown.slice(0, 20);
  const unitName = (id) => {
    const u = (units || []).find((x) => x.id === id);
    return u ? u.name : "";
  };

  return (
    <FoldingSection
      title="PATIENT RECORDS"
      count={records.length}
      countLabel={records.length === 1 ? "patient on file" : "patients on file"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <InfoNote label="What this is">
        Every journey the board still holds, gathered by MRN — the live board, what is booked
        ahead, and the days that have been archived. It answers whether the department has moved
        this patient before, where they usually go, and what they needed last time. Nothing here
        can be changed from this screen.
      </InfoNote>

      <label style={styles.chkSearchWrap}>
        <Search size={13} />
        <input
          style={styles.chkSearch}
          value={query}
          placeholder="MRN, ward, or what was wrong"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {records.length === 0 ? (
        <div style={styles.emptyState}>
          No patient records yet. A call or a booking with an MRN on it appears here.
        </div>
      ) : list.length === 0 ? (
        <div style={styles.emptyState}>Nothing on file matches that.</div>
      ) : (
        <React.Fragment>
          {!q && shown.length > list.length && (
            <div style={styles.formHint}>
              The {list.length} most recent of {shown.length}. Type an MRN or a ward to find the
              rest.
            </div>
          )}
          {list.map((r) => {
            const expanded = openMrn === r.mrn;
            return (
              <div key={r.mrn} style={styles.recCard}>
                {/* Two lines, not one. Squeezed onto one, the route — the
                    thing somebody is actually reading this for — was the part
                    that got the ellipsis, and "Ward 3 → Renal" came out as
                    "W…". */}
                <button style={styles.recHead} onClick={() => setOpenMrn(expanded ? null : r.mrn)}>
                  <span style={styles.recHeadTop}>
                    <span style={styles.recMrn}>{r.mrn}</span>
                    <span style={styles.recCount}>
                      {r.count === 1 ? "1 journey" : `${r.count} journeys`}
                    </span>
                    {r.openCount > 0 && <span style={styles.recOpen}>{r.openCount} still open</span>}
                    <span style={styles.recLast}>
                      {r.nextAt ? `next ${whenShort(r.nextAt)}` : r.lastAt ? `last ${whenShort(r.lastAt)}` : ""}
                    </span>
                  </span>
                  <span style={styles.recRoute}>{r.usualRoute || r.usualNature || "—"}</span>
                </button>
                {expanded && (
                  <div style={styles.recBody}>
                    <div style={styles.recSummary}>
                      {r.usualNature && (
                        <span>
                          Usually <strong>{r.usualNature}</strong>
                        </span>
                      )}
                      {r.usualRoute && <span>{r.usualRoute}</span>}
                      {r.station && <span>{stationLabel(r.station)}</span>}
                      <span>First seen {whenShort(r.firstAt)}</span>
                    </div>
                    {r.requirements.length > 0 && (
                      <div style={styles.checklistRow}>
                        {r.requirements.map((k) => (
                          <span key={k} style={styles.reqBadge}>
                            {REQ_LABEL(k)}
                          </span>
                        ))}
                      </div>
                    )}
                    {r.journeys.map((j) => {
                      const meta = PRIORITY[priorityKeyOf(j)];
                      return (
                        <div key={j.id} style={styles.recJourney}>
                          <span style={styles.recJourneyTop}>
                            <span style={styles.recJourneyWhen}>{whenShort(j.at)}</span>
                            <span style={{ ...styles.recJourneyKind, color: meta ? meta.color : "var(--ink-4)" }}>
                              {j.kind === "booking" ? "BOOKED" : "CALL"}
                            </span>
                            <span style={styles.recJourneyWhat}>{j.nature || "—"}</span>
                            <span style={styles.recJourneyUnit}>{unitName(j.unitId)}</span>
                            <span style={styles.recJourneyStatus}>{j.status || ""}</span>
                          </span>
                          <span style={styles.recJourneyRoute}>
                            {j.from || "—"} → {j.to || "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </React.Fragment>
      )}
    </FoldingSection>
  );
}
