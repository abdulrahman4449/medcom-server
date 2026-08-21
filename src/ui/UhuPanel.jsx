import { STATIONS, stationOf } from "../domain/live-sheet.jsx";
import { msDurationStr } from "../domain/messages.jsx";
import { computeUhu } from "../domain/uhu.jsx";
import { Circle, Clock } from "../lib/icons.jsx";
import { useEffect, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";

// ---------- UHU panel ----------

// Crews see only their own team's UHU (this replaces the log sheet for them);
// dispatch and admin see the whole fleet plus a combined total.
export function UhuPanel({ units, requests, focusUnitId }) {
  const [now, setNow] = useState(Date.now());

  // Own ticker so a running call's time counts up second by second even when
  // nothing else on the board changes.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const rows = computeUhu(units, requests, now);
  const focus = focusUnitId ? rows.find((r) => r.unit.id === focusUnitId) : null;
  const fleetMs = rows.reduce((sum, r) => sum + r.totalMs, 0);
  const fleetCalls = rows.reduce((sum, r) => sum + r.calls, 0);

  // Grouped by station and then ordered by unit, not ranked by time. Both
  // stations run a MEDIC 1, and a list sorted by hours put them in the order
  // "MEDIC 1, MEDIC 2, MEDIC 1" with nothing to say the last one was CCC's.
  // Reading a roster is easier when the trucks are in the order they are named.
  const groups = STATIONS.map((st) => ({
    station: st,
    rows: rows
      .filter((r) => stationOf(r.unit) === st.key)
      .sort((a, b) =>
        a.unit.name.localeCompare(b.unit.name, undefined, { numeric: true, sensitivity: "base" })
      ),
  })).filter((g) => g.rows.length);

  return (
    <div style={styles.uhuPanel}>
      <div style={styles.logHeader}>
        <Clock size={13} color="var(--ink-3)" />
        <span>UHU — TIME ON CALL</span>
        <span style={styles.uhuScope}>this shift</span>
      </div>

      {focus ? (
        <div style={styles.uhuFocus}>
          <div style={styles.uhuFocusUnit}>{focus.unit.name}</div>
          <div style={styles.uhuFocusTotal}>{msDurationStr(focus.totalMs)}</div>
          <div style={styles.uhuFocusCaption}>
            total time on call across {focus.calls} {focus.calls === 1 ? "call" : "calls"}
          </div>
          {focus.activeCall ? (
            <div style={styles.uhuLiveBox}>
              <div style={styles.uhuLiveRow}>
                <Circle size={8} fill="var(--crit)" style={{ animation: "pulse-dot 1.4s ease-in-out infinite" }} />
                <span style={styles.uhuLiveLabel}>ON A CALL NOW</span>
                <span style={styles.uhuLiveTime}>{msDurationStr(focus.activeMs)}</span>
              </div>
              <div style={styles.uhuLiveNature}>{focus.activeCall.nature}</div>
            </div>
          ) : (
            <div style={styles.uhuIdleBox}>Not on a call — the clock is stopped.</div>
          )}
        </div>
      ) : (
        <React.Fragment>
          <div style={styles.uhuList}>
            {groups.length === 0 && <div style={styles.logEmpty}>No teams on the board yet.</div>}
            {groups.map((g) => (
              <React.Fragment key={g.station.key}>
                {/* Only worth a heading when both stations are in the list. A
                    desk sees its own station and needs no heading at all. */}
                {groups.length > 1 && <div style={styles.uhuStationHead}>{g.station.label}</div>}
                {g.rows.map((row) => (
              <div key={row.unit.id} style={styles.uhuRow}>
                <div style={styles.uhuRowMain}>
                  <span style={styles.uhuRowName}>{row.unit.name}</span>
                  {row.activeCall && (
                    <Circle size={7} fill="var(--crit)" style={{ animation: "pulse-dot 1.4s ease-in-out infinite" }} />
                  )}
                </div>
                <div style={styles.uhuRowRight}>
                  <span style={styles.uhuRowTime}>{msDurationStr(row.totalMs)}</span>
                  <span style={styles.uhuRowCalls}>
                    {row.calls} {row.calls === 1 ? "call" : "calls"}
                    {row.activeCall ? ` · +${msDurationStr(row.activeMs)} running` : ""}
                  </span>
                </div>
              </div>
                ))}
              </React.Fragment>
            ))}
          </div>
          <div style={styles.uhuFooter}>
            <span>FLEET TOTAL</span>
            <span style={styles.uhuFooterTime}>
              {msDurationStr(fleetMs)} · {fleetCalls} {fleetCalls === 1 ? "call" : "calls"}
            </span>
          </div>
        </React.Fragment>
      )}
    </div>
  );
}