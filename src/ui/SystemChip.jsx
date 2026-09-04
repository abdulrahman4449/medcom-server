import { BUILD_STAMP } from "../brand/build-stamp.jsx";
import { systemDetailLine, systemSummary } from "../domain/system-analysis.jsx";
import { alarmOutcome, openNativeSettings, screenAwakeHeld, shellBuildNote, shellReport, standDownOutcome, volumeFloorNote } from "../lib/dates.jsx";
import { connectionListeners, connectionOk, lastWriteError, totalPendingCount } from "../lib/offline-queue.jsx";
import { useEffect, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { useBackgroundStatus } from "./AlarmOverlay.jsx";

// ---------- system analysis ----------

// Everything one reading of this device says about itself, gathered in the one
// place that reads it — so the chip in the masthead and the crew screen's
// banner can never disagree about whether this phone is well.
export function useSystemReading(audioCtxRef) {
  const bg = useBackgroundStatus();
  const [, force] = useState(0);

  // The sync half moves on events, not on a timer: a status line that
  // re-renders every second is a status line that twitches, and this one sits
  // beside somebody's name on every screen.
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    connectionListeners.add(fn);
    return () => connectionListeners.delete(fn);
  }, []);

  const ctx = audioCtxRef ? audioCtxRef.current : null;
  return {
    build: BUILD_STAMP,
    shell: shellReport(),
    shellNote: shellBuildNote(bg),
    pageAudio: ctx ? ctx.state : "none yet",
    screenHeld: screenAwakeHeld(),
    alarm: alarmOutcome(),
    standDown: standDownOutcome(),
    bg,
    floorNote: volumeFloorNote(bg),
    held: totalPendingCount(),
    connectionOk,
    writeError: lastWriteError || "",
  };
}

// The chip beside the name in the masthead.
//
// On a healthy device this is the whole of what used to be a permanent grey
// diagnostic line on the crew screen: a dot, a word, and nothing else. Tapping
// it opens the full line, which is what somebody diagnosing "no tone" is asked
// for — so nothing was lost by making it quiet, only moved one tap away.
export function SystemChip({ audioCtxRef }) {
  const [open, setOpen] = useState(false);
  const reading = useSystemReading(audioCtxRef);
  const { ok, faults, level } = systemSummary(reading);
  const tone = ok ? "var(--ok)" : level === "bad" ? "var(--crit)" : "var(--hold)";

  return (
    <div style={styles.shiftChipWrap}>
      <button
        style={{ ...styles.sysChip, ...(ok ? null : { borderColor: tone, color: tone }) }}
        onClick={() => setOpen((v) => !v)}
        title="System analysis — what this device says about itself"
      >
        <span style={{ ...styles.sysChipDot, background: tone }} />
        SYSTEM
        {faults.length > 0 ? ` · ${faults.length}` : ""}
      </button>
      {open && (
        <div style={{ ...styles.shiftMenu, width: 320 }}>
          <div style={styles.shiftMenuHead}>SYSTEM ANALYSIS</div>
          {ok ? (
            <div style={styles.sysPanelLine}>
              <span style={{ color: "var(--ok)" }}>✓</span>
              <span>Nothing wrong with this device. It is on the current build, in sync, and able to be heard.</span>
            </div>
          ) : (
            faults.map((f, i) => (
              <div key={i} style={styles.sysPanelLine}>
                <span style={{ color: f.level === "bad" ? "var(--crit)" : "var(--hold-2)" }}>
                  {f.level === "bad" ? "⚠" : "•"}
                </span>
                <span style={{ flex: 1 }}>
                  {f.say}
                  {/* The one that can be fixed from here is fixed from here.
                      Naming a settings page a crew then has to find is how
                      "notifications are off" stays true for a fortnight. */}
                  {f.which && (
                    <button
                      style={{ ...styles.ghostBtnSm, marginTop: 6, display: "block" }}
                      onClick={() => openNativeSettings(f.which)}
                    >
                      Open settings
                    </button>
                  )}
                </span>
              </div>
            ))
          )}
          <div style={styles.sysPanelDetail}>{systemDetailLine(reading)}</div>
          <button style={styles.ghostBtnSm} onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}
