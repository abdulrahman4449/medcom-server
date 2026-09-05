import { useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { otHoursStr } from "../domain/messages.jsx";
import { overtimeReasonProblem } from "../domain/overtime.jsx";

// The overtime question at sign-out, drawn by the app instead of asked through
// `window.prompt`. A browser dialog is SYNCHRONOUS: the page stops dead for as
// long as it is open, and on the iPhone that is the shell waiting on web
// content that has stopped answering — measured as a two-second hang that was
// exactly how long it took to press Cancel. The sheet blocks nothing; the
// sign-out waits on the answer and carries on either way.
//
// Nothing is written until an answer is given, so a phone put away with this
// open has signed nobody out and lost nothing — the next press of Sign out
// asks again. Both buttons continue the sign-out: the hours are on the shift
// log whatever is chosen, and "Claim nothing" is a real answer, not a cancel.
export function OvertimeAskSheet({ ask, onAnswer }) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");
  if (!ask) return null;
  const hours = otHoursStr(ask.claim.claimedMs);

  function send() {
    const said = overtimeReasonProblem(ask.claim, reason);
    if (said) { setProblem(said); return; }
    onAnswer({ reason: reason.trim() });
  }

  return (
    <div style={styles.consentScrim}>
      <div style={styles.consentSheet}>
        <div style={styles.consentEyebrow}>OVERTIME — {ask.claim.unitName}</div>
        <div style={styles.consentTitle}>
          You are {hours} past the end of your shift, and you were not on a call when it ended.
        </div>
        <div style={styles.consentRefuse}>
          <label style={styles.otReasonLabel}>WHAT KEPT YOU</label>
          <textarea
            style={styles.otReasonInput}
            rows={3}
            value={reason}
            autoFocus
            placeholder="Restocking after the last call, late handover, truck fault…"
            onChange={(e) => { setReason(e.target.value); if (problem) setProblem(""); }}
          />
          {problem && <span style={styles.otReasonProblem}>{problem}</span>}
        </div>
        <div style={{ ...styles.consentBtns, marginTop: 16 }}>
          <button style={styles.consentYes} onClick={send}>Send {hours} to administration</button>
          <button style={styles.consentNo} onClick={() => onAnswer(null)}>Claim nothing</button>
        </div>
      </div>
    </div>
  );
}
