import { callFrom, callTo } from "../domain/call-locations.jsx";
import { PRIORITY, REQUIREMENTS, priorityKeyOf } from "../domain/constants.jsx";
import { ensureAudioCtx, soundCallAlert } from "../lib/dates.jsx";
import { ArrowRight, Bell, MapPin, Volume2, VolumeX } from "../lib/icons.jsx";
import { alertsSupported, requestAlertPermission } from "../lib/notify.jsx";
import { useState } from "../lib/react.jsx";
import { setSoundLevel, soundLevelMeta, useSoundLevel } from "../lib/sound.jsx";
import { styles } from "../styles.jsx";

// ---------- alarm overlay ----------

// Nothing about a muted speaker announces itself: a board that has never made a
// noise looks exactly like a board with nothing to make a noise about. So every
// priority's tone can be played on demand — from the desk that sets it and from
// the tablet that has to hear it — which turns "are the alerts working?" into a
// three-second check instead of a guess. Tapping one is also a user gesture, so
// the check arms the audio it is checking.
export function AlertToneCheck({ audioCtxRef, priority, label, style }) {
  const level = useSoundLevel();
  // The three levels, in their own words, each playing its own tone. The list
  // used to be the internal tone names labelled from the level table, so CCT
  // was shown against the tone that belongs to ALS.
  const keys = priority ? [priority] : ["cct", "als", "bls"];
  const muted = soundLevelMeta(level).gain <= 0;

  // A row of play buttons that make no sound is a worse answer than no row at
  // all: the crew would read silence as a broken speaker. So a silenced device
  // says what it is and offers the one tap that undoes it.
  if (muted) {
    return (
      <div style={{ ...styles.toneCheck, ...style }}>
        <span style={styles.toneCheckLabelMuted}>
          <VolumeX size={12} /> {label || "Test alert tone"} — SILENCED ON THIS DEVICE
        </span>
        <button
          type="button"
          style={{ ...styles.toneCheckBtn, borderColor: "var(--hold)", color: "var(--hold-2)" }}
          onClick={() => {
            setSoundLevel("full");
            soundCallAlert(audioCtxRef, priority || "routine");
          }}
        >
          ▶ TURN SOUND BACK ON
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...styles.toneCheck, ...style }}>
      <span style={styles.toneCheckLabel}>
        <Volume2 size={12} /> {label || "Test alert tone"}
      </span>
      {keys.map((k) => {
        const meta = PRIORITY[k] || PRIORITY.bls;
        return (
          <button
            key={k}
            type="button"
            style={{ ...styles.toneCheckBtn, borderColor: meta.color, color: meta.color }}
            title={`Play the ${meta.label} alert tone`}
            onClick={() => soundCallAlert(audioCtxRef, k)}
          >
            ▶ {meta.label}
          </button>
        );
      })}
    </div>
  );
}

// Whether this device can actually raise the alarm, and a way to fix it if not.
// A crew tablet that has never been tapped since it loaded has its audio
// suspended by the browser and, on a restored session, may never have been
// asked about notifications — either way a call would arrive silently, which is
// the one thing this board cannot do. The whole app re-renders off the header
// clock every second, so reading the live permission and audio state here is
// enough to make the notice disappear the moment it's sorted.
export function CallAlertNotice({ audioCtxRef }) {
  const level = useSoundLevel();
  const silenced = soundLevelMeta(level).gain <= 0;
  const supported = alertsSupported();
  const permission = supported ? Notification.permission : "unsupported";
  const ctx = audioCtxRef ? audioCtxRef.current : null;
  const browserBlocked = !ctx || ctx.state !== "running";

  // Silenced on purpose is its own notice, and it outranks the others: the crew
  // did this, they can undo it in one tap, and the board should not be lecturing
  // them about a browser that has nothing to do with it. It never disappears
  // while the device is quiet — that is the whole job of this line.
  if (silenced) {
    return (
      <div style={styles.alertNoticeMuted}>
        <span style={styles.alertNoticeMutedText}>
          <strong>Alert tones are silenced on this device.</strong> A call still arrives — the
          full-screen alarm, the vibration and the call notification all still come through — but
          your tablet will not make a sound for it.
        </span>
        <button
          style={styles.alertNoticeMutedBtn}
          onClick={() => {
            setSoundLevel("full");
            soundCallAlert(audioCtxRef, "routine");
            requestAlertPermission();
          }}
        >
          <Volume2 size={13} /> TURN SOUND BACK ON
        </button>
      </div>
    );
  }

  if (!browserBlocked && (permission === "granted" || !supported)) return null;

  async function enableAlerts() {
    try {
      const ctx = ensureAudioCtx(audioCtxRef);
      if (ctx) await ctx.resume();
    } catch (e) {
      // audio not available; ignore
    }
    // Play the routine tone back straight away: "armed" is only worth saying if
    // the speaker actually made a sound, and this is the tap that licenses one.
    soundCallAlert(audioCtxRef, "routine");
    requestAlertPermission();
  }

  const parts = [];
  if (browserBlocked) parts.push("the alert tone is muted by this browser");
  if (permission === "default") parts.push("call notifications haven't been allowed yet");
  if (permission === "denied") parts.push("call notifications are blocked in your browser settings");

  const fixable = browserBlocked || permission === "default";

  return (
    <div style={styles.alertNotice}>
      <span style={styles.alertNoticeText}>
        <strong>Call alerts aren't fully armed</strong> — {parts.join(" and ")}.{" "}
        {fixable
          ? "Turn them on so a call reaches you even when this page isn't in front of you."
          : "Allow notifications for this site so a call reaches you even when this page isn't in front of you."}
      </span>
      {fixable && (
        <button style={styles.alertNoticeBtn} onClick={enableAlerts}>
          <Bell size={13} /> ENABLE CALL ALERTS
        </button>
      )}
    </div>
  );
}

export function AlarmOverlay({ request, onAcknowledge, assisting, withUnit }) {
  // Acknowledging reads from the server before anything changes, so on a weak
  // signal the alarm sat there looking unpressed. It now answers the tap at
  // once and cannot be fired twice.
  const [acking, setAcking] = useState(false);
  const level = useSoundLevel();
  const silenced = soundLevelMeta(level).gain <= 0;
  return (
    <div style={styles.alarmOverlay}>
      <div style={styles.alarmCard}>
        <div style={styles.alarmPulseDot} />
        <div style={styles.alarmTitle}>{assisting ? "ASSIST ANOTHER TEAM" : "INCOMING CALL"}</div>
        {assisting && (
          <div style={styles.alarmAssistLine}>
            Second ambulance requested{withUnit ? ` by ${withUnit}` : ""} — go to this call
          </div>
        )}
        <div style={{ ...styles.alarmPriority, background: PRIORITY[priorityKeyOf(request)].color }}>
          {PRIORITY[priorityKeyOf(request)].label}
        </div>
        <div style={styles.alarmNature}>{request.nature}</div>
        <div style={styles.alarmRoute}>
          <div style={styles.alarmLocation}>
            <span style={styles.alarmLocationLabel}>FROM</span>
            <MapPin size={14} /> {callFrom(request) || "—"}
          </div>
          {callTo(request) && (
            <div style={styles.alarmLocation}>
              <span style={styles.alarmLocationLabel}>TO</span>
              <ArrowRight size={14} /> {callTo(request)}
            </div>
          )}
        </div>
        {request.mrn && <div style={styles.alarmMrn}>MRN: {request.mrn}</div>}
        {request.requirements && request.requirements.length > 0 && (
          <div style={styles.checklistRow}>
            {request.requirements.map((k) => (
              <span key={k} style={styles.alarmReqBadge}>{REQUIREMENTS.find((r) => r.key === k).label}</span>
            ))}
          </div>
        )}
        <button
          style={acking ? styles.alarmAckBtnBusy : styles.alarmAckBtn}
          disabled={acking}
          onClick={async () => {
            if (acking) return;
            setAcking(true);
            try {
              await onAcknowledge();
            } finally {
              setAcking(false);
            }
          }}
        >
          {acking ? (
            "ACKNOWLEDGING…"
          ) : (
            <>
              <Bell size={16} /> {assisting ? "ACKNOWLEDGE ASSIST" : "ACKNOWLEDGE CALL"}
            </>
          )}
        </button>
        {silenced ? (
          <div style={styles.alarmFootnoteMuted}>
            <VolumeX size={12} /> This device is silenced — this alarm arrived without a tone. It
            stays on screen until acknowledged.
          </div>
        ) : (
          <div style={styles.alarmFootnote}>The alert tone will keep repeating until acknowledged.</div>
        )}
      </div>
    </div>
  );
}