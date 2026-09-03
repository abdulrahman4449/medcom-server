import { BUILD_STAMP } from "../brand/build-stamp.jsx";
import { callFrom, callTo } from "../domain/call-locations.jsx";
import { PRIORITY, REQUIREMENTS, priorityKeyOf } from "../domain/constants.jsx";
import { alarmOutcome, ensureAudioCtx, nativeAlarm, nativeBackgroundStatus, openNativeSettings, screenAwakeHeld, shellBuildNote, shellReport, volumeFloorNote, soundCallAlert, soundSpeakerCheck, standDownOutcome } from "../lib/dates.jsx";
import { ArrowRight, Bell, MapPin, Volume2, VolumeX } from "../lib/icons.jsx";
import { alertsSupported, requestAlertPermission } from "../lib/notify.jsx";
import { useEffect, useState } from "../lib/react.jsx";
import { alertsArmedBefore, setSoundLevel, soundLevelMeta, useSoundLevel } from "../lib/sound.jsx";
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
            soundSpeakerCheck(audioCtxRef, priority || "routine");
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
            onClick={() => soundSpeakerCheck(audioCtxRef, k)}
          >
            ▶ {meta.label}
          </button>
        );
      })}
    </div>
  );
}

// What this device is actually going to make a noise with, said out loud.
//
// Three rounds of testing went into "no tone" without anybody being able to see
// which of the three possible paths was being taken, or which build was even
// installed. A crew cannot read a console and neither can a supervisor on a
// phone, so the answers are on the screen: the build, whether the operating
// system's alarm path is available, and what state the page's own audio is in.
// Small and grey — it is for the person diagnosing, not for the crew.
export function SoundDiagnostics({ audioCtxRef }) {
  const plugin = !!nativeAlarm();
  const ctx = audioCtxRef ? audioCtxRef.current : null;
  const state = ctx ? ctx.state : "none yet";
  const bg = useBackgroundStatus();
  return (
    <div style={styles.soundDiag}>
      build {BUILD_STAMP} · {shellReport()}{shellBuildNote(bg)} · page audio {state} ·
      screen held {screenAwakeHeld() ? "yes" : "no"} · last alarm: {alarmOutcome()} ·
      last stand-down: {standDownOutcome()}
      {bg ? `${bg.platform === "ios"
        ? ` · device volume ${bg.alarmVolumePct}% (no floor on iPhone)`
        : ` · alarm volume ${bg.alarmVolumePct}%${volumeFloorNote(bg)}`
      } · notifications ${
        bg.notificationsEnabled ? "on" : "OFF"
      }${bg.platform === "ios" ? "" : ` · channel ${bg.channelSilenced ? "SILENCED" : "ok"} · battery saver ${
        bg.batteryOptimised ? "ON" : "off"
      }`}` : ""}
    </div>
  );
}

// The shell's answer to "will this phone actually make a noise", re-read on a
// slow tick.
//
// Read rather than assumed, because every one of these is the owner's to change
// and none of them is visible from inside a web page. Ten seconds is often
// enough: a crew fixing one of these is standing at the phone, and the line has
// to tell them it worked.
export function useBackgroundStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      const answered = nativeBackgroundStatus();
      if (!answered || typeof answered.then !== "function") return;
      answered.then((s) => {
        if (live && s) setStatus(s);
      });
    };
    read();
    const t = setInterval(read, 10000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return status;
}

// What is stopping this phone from being heard, in one sentence, with the
// button that fixes it.
//
// "Sometimes the alert works and sometimes it does not" is almost never one
// fault. It is four, each of which silences the alarm on its own, each set by
// somebody long ago on one handset and not the next — and none of which the app
// is allowed to change on the owner's behalf. So it names the one in the way
// and opens the exact settings page.
export function BackgroundAlertNotice() {
  const bg = useBackgroundStatus();
  if (!bg) return null;
  const faults = [];
  if (!bg.notificationsEnabled) {
    faults.push({
      which: "notifications",
      say: "Notifications are turned off for this app, so a call raised while you are not looking at the screen will not show a banner.",
    });
  } else if (bg.channelSilenced) {
    faults.push({
      which: "channel",
      say: "The Dispatch alerts channel has been silenced on this phone. Android will not let the app turn it back on — it has to be done in settings.",
    });
  }
  // The volume, said out loud — and said DIFFERENTLY on the two platforms,
  // because what the app can do about it is different.
  //
  // Android raises the alarm stream to a floor for the length of an alert, so
  // a low reading there is either about to be corrected or was REFUSED, and a
  // refusal is the interesting case: Do Not Disturb and some manufacturers'
  // focus modes turn setStreamVolume into a no-op with no error at all, which
  // is how "the floor did not kick in" stayed invisible.
  //
  // On iPhone there is no floor and there cannot be one — outputVolume is
  // read-only and Apple publishes no way to set the system volume — so a thumb
  // on volume-down genuinely does make the alert quieter and the only honest
  // answer is to name it before the call comes rather than after.
  const onIos = bg.platform === "ios";
  if (onIos && (bg.alarmVolumePct || 0) < 40) {
    faults.push({
      which: null,
      say: `The volume on this iPhone is ${bg.alarmVolumePct}%. On iPhone the alert plays at the phone's own volume — the app cannot raise it for you, so turn it up before your shift.`,
    });
  } else if (!onIos && bg.volumeFloorOk === false && /REFUSED/.test(String(bg.volumeFloor || ""))) {
    faults.push({
      which: "notifications",
      say: `This phone refused to raise the alarm volume for the last alert — ${bg.volumeFloor}. Turn the alarm volume up by hand, and check Do Not Disturb.`,
    });
  } else if (!onIos && (bg.alarmVolumePct || 0) < 30) {
    faults.push({
      which: null,
      say: `The alarm volume on this phone is ${bg.alarmVolumePct}%. The alert plays on the alarm stream, so this is the slider it uses — not the media one.`,
    });
  }
  if (bg.batteryOptimised) {
    faults.push({
      which: "battery",
      say: "Battery optimisation is on for this app. Android will freeze it in the background, and a frozen app never learns a call was raised.",
    });
  }
  if (!faults.length) return null;
  return (
    <div style={styles.bgAlertNotice}>
      <div style={styles.bgAlertHead}>THIS PHONE MAY MISS A CALL</div>
      {faults.map((f, i) => (
        <div key={i} style={styles.bgAlertRow}>
          <span style={styles.bgAlertSay}>{f.say}</span>
          {f.which && (
            <button style={styles.ghostBtnSm} onClick={() => openNativeSettings(f.which)}>
              Fix it
            </button>
          )}
        </div>
      ))}
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
  // Suspended audio on a device that has armed before is not worth a notice.
  // A browser suspends audio on every load and the first tap anywhere on the
  // page arms it again silently, so saying "not fully armed" after each
  // refresh was asking the crew to press a button they had already pressed and
  // teaching them to ignore the one line that matters. What genuinely needs a
  // deliberate tap is the notification permission, and that is still said.
  const audioAsleep = !ctx || ctx.state !== "running";
  // "Armed before" has to count on its own where there is no notification
  // permission to ask for. The native shells have no Notification API at all,
  // so `permission` there is "unsupported" and a test written as
  // `permission === "granted"` could never pass - which made this notice
  // permanent on exactly the devices that need it least, returning after every
  // refresh no matter how many times the crew pressed the button.
  const armed = alertsArmedBefore() && (permission === "granted" || !supported);
  const browserBlocked = audioAsleep && !armed;

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

  // A shell with the native alarm plugin does not go through the browser's
  // audio at all: the tone plays on the operating system's alarm path, which is
  // awake whether or not this page has been tapped. Nagging about a suspended
  // AudioContext there is asking the crew to fix something that is not in the
  // way of anything.
  if (nativeAlarm()) return null;

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