import { callsAwaitingEditVerify, pendingCallEditCount, verifyCallEditOn } from "../domain/constants.jsx";
import { AlertTriangle } from "../lib/icons.jsx";
import { styles } from "../styles.jsx";
import { CallRoute, InfoNote, PendingEditReview } from "./AssistanceTasks.jsx";

// ---------- dispatcher view ----------

// The safety net. A correction reported on a call that then closes would
// otherwise disappear with the call — the desk's active board only carries
// calls that are still running. This gathers every one still waiting, from any
// call in any state, and puts it at the top of the desk's screen until it has
// been dealt with.
export function PendingEditsInbox({ requests, units, user, saveRequests, addLog }) {
  const waiting = callsAwaitingEditVerify(requests);
  if (!waiting.length) return null;

  async function verify(req, entry, accept) {
    await verifyCallEditOn({
      req, entry, accept,
      who: user && user.name ? user.name : "Dispatch",
      requests, saveRequests, addLog,
    });
  }

  return (
    <div style={styles.editInbox}>
      <div style={styles.editInboxHead}>
        <AlertTriangle size={14} /> CALL INFORMATION WAITING TO BE CONFIRMED —{" "}
        {pendingCallEditCount(requests)}
      </div>
      <InfoNote label="How this works">
        Crews have reported these details as wrong. Nothing changes on the call until you confirm it.
        Calls that have already closed still show here, so a correction is never lost because the
        team went back in service.
      </InfoNote>
      {waiting.map((req) => {
        const unit = units.find((u) => u.id === req.assignedUnitId);
        return (
          <div key={req.id} style={styles.editInboxCall}>
            <div style={styles.editInboxCallHead}>
              <span style={styles.editInboxNature}>{req.nature}</span>
              <span style={styles.editInboxMeta}>
                <CallRoute req={req} size="sm" />
                {unit ? ` · ${unit.name}` : ""}
                {req.status === "completed" ? " · CALL CLOSED" : ""}
              </span>
            </div>
            <PendingEditReview
              req={req}
              onVerify={(e) => verify(req, e, true)}
              onReject={(e) => verify(req, e, false)}
            />
          </div>
        );
      })}
    </div>
  );
}