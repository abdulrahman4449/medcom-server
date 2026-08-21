import { shortDurationStr } from "../domain/messages.jsx";
import { hhmm, scheduledShiftKey, shiftWindowFor } from "../domain/shift-helpers.jsx";
import { SHIFTS, SHIFT_KEYS } from "../domain/shifts.jsx";
import { ChevronRight } from "../lib/icons.jsx";
import { styles } from "../styles.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";

// ---------- shift picker ----------

// The day/night question everyone working the board answers on the way in.
// Each option shows the actual 12-hour window it resolves to and whether that
// window is running now, still to come, or already over — the last case being
// someone signing on to carry a call past the end of their shift.
export function ShiftPicker({ subject, busy, onPick, onBack }) {
  const now = Date.now();
  const suggested = scheduledShiftKey(now);
  return (
    <>
      <div style={styles.loginSub}>
        Which shift is {subject} working? The clock says {SHIFTS[suggested].label.toLowerCase()} right now.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        {SHIFT_KEYS.map((key) => {
          const meta = SHIFTS[key];
          const w = shiftWindowFor(key, now);
          const state =
            now < w.start
              ? `Starts ${hhmm(w.start)}`
              : now < w.end
              ? `On now — ends ${hhmm(w.end)}, ${shortDurationStr(w.end - now)} to run`
              : `Ended ${hhmm(w.end)} — signing on ${shortDurationStr(now - w.end)} into overtime`;
          return (
            <button
              key={key}
              style={{
                ...styles.roleBtn,
                ...(key === suggested
                  ? {
                      borderColor: meta.color,
                      borderWidth: 2,
                      background: `color-mix(in srgb, ${meta.color} 14%, var(--panel))`,
                    }
                  : { borderColor: "var(--hair-2)" }),
              }}
              disabled={busy}
              onClick={() => onPick(key)}
            >
              <div style={{ textAlign: "left" }}>
                <div style={styles.roleBtnTitle}>
                  <span style={{ color: meta.color, marginRight: 6 }}>{meta.glyph}</span>
                  {meta.label} · {meta.window}
                  {key === suggested && <span style={styles.shiftNowTag}>NOW</span>}
                </div>
                <div style={styles.roleBtnSub}>{state}</div>
              </div>
              <ChevronRight size={18} color="var(--ink-3)" />
            </button>
          );
        })}
      </div>
      <InfoNote label="More about this">
        Working past the end of your 12 hours is fine — the board keeps counting and puts the extra
        time on the log sheet as overtime.
      </InfoNote>
      <div style={styles.loginActions}>
        <button style={styles.ghostBtn} disabled={busy} onClick={onBack}>Back</button>
      </div>
    </>
  );
}