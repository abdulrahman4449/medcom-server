import { msDurationStr } from "../domain/messages.jsx";
import { LOCATION_STALE_MS } from "../domain/truck-locations.jsx";
import { useEffect, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";

// ---------- asking before locating ----------
//
// Google requires a prominent disclosure of its own before location is
// collected — the operating system's permission dialog does not count, because
// it says what is being asked for and not why. This is that disclosure, and it
// is written to be read by somebody who is about to drive somewhere rather than
// by a lawyer: what is collected, when, for how long, who sees it, and what
// happens if they say no.
// Asking the device, at the moment the person says yes.
//
// Consent in the app and permission from the operating system are two different
// permissions, and only one of them was ever asked for. The app recorded "yes",
// and then the first thing that actually wanted a position was `watchPosition`
// inside the tracking effect — which on the native shells is not a user gesture
// and, on a phone that had never been asked, produced nothing at all: no OS
// dialog, no error the crew could see, just a truck that never appeared on the
// map. Worse, when it did prompt it prompted mid-call, which is the one moment
// nobody wants to read a dialog.
//
// This runs inside the tap on "Allow", which is a gesture, so the operating
// system's own dialog comes up there and then, next to the disclosure that
// explains it. The answer is reported back so a device-level refusal can be
// said out loud rather than discovered on a call.
export function primeDeviceLocation() {
  return new Promise((resolve) => {
    try {
      if (!navigator.geolocation) {
        resolve("unavailable");
        return;
      }
      let settled = false;
      const done = (v) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      // A cold GPS fix can take a while and the crew must not be left holding a
      // spinning button for it. What matters here is the permission, not the
      // position, so a slow fix counts as granted.
      const timer = window.setTimeout(() => done("slow"), 8000);
      navigator.geolocation.getCurrentPosition(
        () => {
          window.clearTimeout(timer);
          done("ok");
        },
        (err) => {
          window.clearTimeout(timer);
          done(err && err.code === 1 ? "denied" : "nofix");
        },
        { enableHighAccuracy: false, maximumAge: 60000, timeout: 8000 }
      );
    } catch (e) {
      resolve("unavailable");
    }
  });
}

export function TrackingConsentModal({ open, user, onDecide }) {
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function decide(status) {
    if (busy) return;
    if (status === "refused" && !reason.trim()) return;
    setBusy(true);
    try {
      // Saying yes here also asks the phone. A device that says no does not
      // undo the consent — the person agreed, and the record should say so —
      // but they are told, because nothing else on the screen would tell them
      // until a call was already running.
      let device = null;
      if (status === "granted") device = await primeDeviceLocation();
      await onDecide(status, reason.trim());
      if (device === "denied") {
        window.alert(
          "Thank you — that is recorded.\n\n" +
            "This phone is still blocking location for this app, so the desk will not see " +
            "your position until that is changed:\n\n" +
            "iPhone: Settings › Privacy & Security › Location Services › PulseOps › " +
            "While Using the App.\n" +
            "Android: Settings › Apps › PulseOps › Permissions › Location › Allow only " +
            "while using the app."
        );
      } else if (device === "unavailable") {
        window.alert(
          "Thank you — that is recorded.\n\n" +
            "This device has no location service, so the desk will not see a position for " +
            "this truck. Everything else works exactly as it does now."
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.consentScrim}>
      <div style={styles.consentSheet}>
        <div style={styles.consentEyebrow}>LOCATION — {user && user.accountId ? user.accountId : "YOUR ID"}</div>
        <div style={styles.consentTitle}>Share this truck's position while you are on a call?</div>

        <div style={styles.consentBody}>
          <div style={styles.consentPoint}>
            <strong>Only during a call.</strong> It starts when you are dispatched and stops the
            moment you go back in service. Between calls nothing is sent.
          </div>
          <div style={styles.consentPoint}>
            <strong>Only while this app is open.</strong> Lock the tablet or switch away and it
            stops on its own. There is no background tracking.
          </div>
          <div style={styles.consentPoint}>
            <strong>Once a minute, and only the latest one is kept.</strong> Each position replaces
            the one before it, and the whole thing is deleted when the call ends. No route or
            history of where you have been is stored.
          </div>
          <div style={styles.consentPoint}>
            <strong>Who sees it.</strong> The dispatch desk and administration, on the department's
            own server. It is not sent to anyone else and it is not used for anything but finding
            the nearest truck.
          </div>
          <div style={styles.consentPoint}>
            <strong>If you say no.</strong> Everything else works exactly as it does now — you take
            calls, stamp times, all of it. The desk simply sees no position for this truck. You will
            be asked again on your next call.
          </div>
        </div>

        {!refusing ? (
          <div style={styles.consentBtns}>
            <button style={styles.consentYes} onClick={() => decide("granted")} disabled={busy}>
              Allow while on a call
            </button>
            <button style={styles.consentNo} onClick={() => setRefusing(true)} disabled={busy}>
              Not now
            </button>
          </div>
        ) : (
          <div style={styles.consentRefuse}>
            <label style={styles.label}>Why? The department asks for a reason.</label>
            <textarea
              style={styles.consentReason}
              rows={3}
              value={reason}
              maxLength={300}
              placeholder="e.g. personal phone, not a work device"
              onChange={(e) => setReason(e.target.value)}
            />
            <div style={styles.consentNote}>
              This is recorded for administration. It does not change the answer — saying no takes
              effect straight away, and nobody has to approve it.
            </div>
            <div style={styles.consentBtns}>
              <button
                style={reason.trim() ? styles.consentNo : styles.consentNoOff}
                onClick={() => decide("refused")}
                disabled={busy || !reason.trim()}
              >
                Send and continue
              </button>
              <button style={styles.ghostBtnSm} onClick={() => setRefusing(false)} disabled={busy}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// The crew's own bar: on, off, and how long ago the last fix was. A crew whose
// position stopped updating twenty minutes ago should be able to see that on
// their own screen, not only on the desk's.
// Why this truck is, or is not, on the map.
//
// The first version only rendered while tracking was actually running, which
// meant every reason it was NOT running was invisible: a crew in the Bravo
// seat, a crew who had not been asked yet, a device that refused permission —
// all of them looked identical to a working app, and the desk just saw "nobody
// out". A gate nobody can see is a gate nobody can fix. So it renders for the
// whole call and always says which of the reasons applies.
export function TrackingBar({ state, lastTs, error, reason }) {
  // Its own second hand. The crew screen has no shared ticker, and the whole
  // point of this bar is that the number moves — a bar reading "2 min ago"
  // forever is worse than no bar, because it looks like it is working.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const age = lastTs ? Math.max(0, now - lastTs) : null;
  const stale = age !== null && age > LOCATION_STALE_MS;

  // Not this device's job, or not agreed to. Either way, say which.
  if (state !== "on") {
    return (
      <div style={styles.trackBarOff}>
        <span style={styles.trackDotOff} />
        {reason || "Location off — the desk cannot see this truck's position"}
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.trackBarWarn}>
        <span style={styles.trackDotWarn} />
        Location unavailable — {error}
      </div>
    );
  }

  return (
    <div style={stale ? styles.trackBarWarn : styles.trackBarOn}>
      <span style={stale ? styles.trackDotWarn : styles.trackDotOn} className={stale ? "" : "breathing"} />
      {lastTs ? (
        <>
          Sharing position · last update{" "}
          <strong>{age < 60000 ? "just now" : `${msDurationStr(age)} ago`}</strong>
          {stale && " — the desk is seeing an old position"}
        </>
      ) : (
        "Sharing position · waiting for the first fix"
      )}
    </div>
  );
}