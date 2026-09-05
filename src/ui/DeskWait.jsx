import { deskAsk, deskFor, deskHolder } from "../domain/desk-handover.jsx";
import { stationLabel } from "../domain/live-sheet.jsx";
import { clockStr } from "../domain/messages.jsx";
import { styles } from "../styles.jsx";

// Waiting for the desk (desk-handover.jsx). The person is signed in and
// waiting, exactly as a reliever waits for a seat: the holder has been asked
// on their own phone, and the desk is theirs the moment the holder approves
// or signs out. Shown INSTEAD of the board — a second dispatcher watching the
// desk they do not hold is the thing this exists to stop.
export function DeskWait({ user, desk, onWithdraw }) {
  const station = user.deskStation || user.station;
  const rec = deskFor(desk, station);
  const holder = deskHolder(rec);
  const ask = deskAsk(rec);
  return (
    <div style={styles.reliefWait}>
      <div style={styles.oosAskHead}>
        Waiting for {holder ? holder.name : "the dispatcher"} to hand over the desk — {stationLabel(station)}
      </div>
      <div style={styles.oosAskWhy}>
        {holder ? `${holder.name} has been asked on their own phone.` : "The desk is being handed over."}
        {ask && ask.queuedAt ? ` Asked at ${clockStr(ask.queuedAt)}.` : ""} The desk is yours the moment they approve or
        sign out. If they cannot answer, an administrator can hand it over.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={styles.ghostBtnSm} onClick={onWithdraw}>Withdraw &amp; sign out</button>
      </div>
    </div>
  );
}
