import { API_BASE } from "../lib/board-api.jsx";
import { useEffect, useState } from "../lib/react.jsx";
import { gregDateTimeStr } from "../lib/dates.jsx";
import { bytesStr } from "./storage-banner.jsx";
import { styles } from "../styles.jsx";
import { FoldingSection } from "./AdminView.jsx";
import { AlertTriangle, Archive } from "../lib/icons.jsx";

// ---------- backups ----------
//
// The board is one file on one disk. That survives a redeploy, which was the
// problem fixed earlier, but not the disk failing and not somebody deleting a
// member of staff by mistake. This panel is where an administrator can see
// that a copy is actually being taken, take one on the spot, and — where the
// server has been given a token — carry one away.
//
// Two destinations, when the server has been told about a second one. On a
// server the department owns, that second one is the mount path of an external
// drive left plugged in: the same snapshot is written to both, so losing
// either disk still leaves a copy. On a hosted server there is no socket to
// plug a drive into, and the second copy is the one somebody downloads.
const BACKUP_POLL_MS = 5 * 60 * 1000;
const TOKEN_KEY = "ems:backupToken";

export function BackupPanel({ role }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [token, setToken] = useState(() => {
    try { return window.localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  });

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/backups`);
      if (!res.ok) throw new Error(String(res.status));
      setState(await res.json());
    } catch (e) {
      setState({ unreachable: true });
    }
  };

  useEffect(() => {
    let alive = true;
    const tick = async () => { if (alive) await load(); };
    tick();
    const t = setInterval(tick, BACKUP_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (role !== "admin") return null;

  async function backupNow() {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(`${API_BASE}/api/backups`, { method: "POST" });
      const body = await res.json();
      setNote(
        body.written && body.written.length
          ? `Copy taken — ${body.name}, written to ${body.written.length} place${body.written.length === 1 ? "" : "s"}.`
          : "The copy could not be written. See the note below."
      );
      await load();
    } catch (e) {
      setNote("Could not reach the server to take a copy.");
    }
    setBusy(false);
  }

  function rememberToken(v) {
    setToken(v);
    try { window.localStorage.setItem(TOKEN_KEY, v); } catch (e) { /* private window */ }
  }

  const b = state || {};
  const last = b.last;
  // A backup that quietly stopped a month ago is worse than no backup, because
  // nobody is worried about it. Age is what this panel leads with.
  const ageHours = b.ageMs ? Math.round(b.ageMs / 3600000) : null;
  const secondOk = b.second && b.second.configured && b.second.reachable;
  const secondBroken = b.second && b.second.configured && !b.second.reachable;

  return (
    <FoldingSection
      title="BACKUPS"
      count={b.primary ? b.primary.count : 0}
      countLabel={
        b.unreachable
          ? "server not answering"
          : b.stale
            ? "copies · NOT RUNNING"
            : `copies · newest ${ageHours === null ? "—" : ageHours < 1 ? "under an hour" : `${ageHours} h`} old`
      }
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {b.unreachable ? (
        <div style={styles.storageBanner}>
          <AlertTriangle size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
          The server did not answer when asked about backups. Until it does, treat the
          board as having no copy.
        </div>
      ) : (
        <>
          {b.stale && (
            <div style={styles.storageBanner}>
              <AlertTriangle size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
              <strong>No recent backup.</strong> The last copy of the board is more than
              two days old, or there has never been one. Everything on this board —
              every call, every filed log, every archive — exists in one place only.
            </div>
          )}
          {secondBroken && (
            <div style={styles.bigKeyBanner}>
              <AlertTriangle size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
              <strong>The second copy is not being written.</strong> The server was told
              to keep a copy at <code>{b.second.dir}</code> and cannot reach it — an
              external drive unplugged, switched off, or not mounted. The first copy is
              still being taken.
            </div>
          )}

          <div style={styles.backupGrid}>
            <div style={styles.backupCell}>
              <span style={styles.backupLabel}>ON THE SERVER'S DISK</span>
              <span style={styles.backupValue}>{b.primary ? b.primary.count : 0} copies</span>
              <span style={styles.backupNote}>
                {b.primary && b.primary.totalBytes ? bytesStr(b.primary.totalBytes) : "nothing yet"}
                {b.keepDaily ? ` · every day for ${b.keepDaily} days, then weekly for ${b.keepWeekly} weeks` : ""}
              </span>
            </div>
            <div style={styles.backupCell}>
              <span style={styles.backupLabel}>SECOND COPY</span>
              <span style={{ ...styles.backupValue, color: secondOk ? "var(--ok)" : "var(--ink-4)" }}>
                {!b.second || !b.second.configured ? "Not set up" : secondOk ? `${b.second.count} copies` : "Unreachable"}
              </span>
              <span style={styles.backupNote}>
                {b.second && b.second.configured
                  ? b.second.dir
                  : "Set BACKUP_DIR_2 on the server to a second disk — on a server you own, that is where an external drive is mounted."}
              </span>
            </div>
          </div>

          {last && (
            <div style={styles.backupNote}>
              Last copy: <strong>{last.name}</strong> · {gregDateTimeStr(new Date(last.at).getTime())} ·{" "}
              {bytesStr(last.bytes || 0)} · {last.reason}
              {last.failed && last.failed.length > 0 && (
                <> · <span style={{ color: "var(--hold)" }}>failed to write to {last.failed.length} place</span></>
              )}
            </div>
          )}

          <div style={styles.backupActions}>
            <button style={styles.primaryBtn} disabled={busy} onClick={backupNow}>
              <Archive size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
              {busy ? "Taking a copy…" : "Back up now"}
            </button>
          </div>
          {note && <div style={styles.backupNote}>{note}</div>}

          {/* Downloading a backup is downloading every patient record the
              department holds, so the server refuses unless somebody has
              deliberately set a token on it. */}
          <div style={styles.backupDownload}>
            <span style={styles.backupLabel}>TAKE A COPY AWAY</span>
            {!b.downloadEnabled ? (
              <span style={styles.backupNote}>
                Turned off. A backup file contains every patient record on the board, so
                downloading one is only possible when a <code>BACKUP_TOKEN</code> has been
                set on the server. Set one there, then this becomes a download button.
              </span>
            ) : (
              <>
                <span style={styles.backupNote}>
                  This file contains patient MRNs. Keep it where the department keeps
                  confidential records — not in a personal folder or a consumer cloud drive.
                </span>
                <div style={styles.backupActions}>
                  <input
                    style={{ ...styles.input, maxWidth: 240 }}
                    type="password"
                    placeholder="Backup token"
                    value={token}
                    onChange={(e) => rememberToken(e.target.value)}
                  />
                  <button
                    style={styles.ghostBtn}
                    disabled={!token || !b.primary || !b.primary.newest}
                    onClick={() => {
                      const name = b.primary.newest.name;
                      window.open(
                        `${API_BASE}/api/backups/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`,
                        "_blank"
                      );
                    }}
                  >
                    Download newest
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </FoldingSection>
  );
}
