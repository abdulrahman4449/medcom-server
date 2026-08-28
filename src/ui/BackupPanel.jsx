import { canArea } from "../domain/delegation.jsx";
import { authHeaders } from "../lib/auth.jsx";
import { connectionListeners, connectionOk, lastSyncedAt, lastWriteError, notifyPendingChanged, pushPendingWrites, totalPendingCount } from "../lib/offline-queue.jsx";
import { API_BASE } from "../lib/board-api.jsx";
import { useEffect, useState } from "../lib/react.jsx";
import { gregDateTimeStr } from "../lib/dates.jsx";
import { bytesStr, keyName } from "./storage-banner.jsx";
import { styles } from "../styles.jsx";
import { FoldingSection } from "./AdminView.jsx";
import { AlertTriangle, Archive, RotateCcw } from "../lib/icons.jsx";

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

// ---------- is this device actually in sync? ----------
//
// The banner at the top of the app speaks up when something is wrong and says
// nothing when it is not, which is right for a crew working a call — but it
// leaves "is my data safe" answerable only by the absence of a warning, and an
// absence is not an answer anybody trusts. This says it out loud, beside the
// backups, where somebody is standing precisely because they are worried about
// exactly this.
// Exported, because the desk needs this as much as administration does.
//
// Every write in the app goes through the same queue, so a dispatcher raising
// calls on a weak connection is holding them exactly as a crew would be - and
// until now the only place that said so was a panel inside the admin screens.
// A desk that cannot see it has no way to know the board it is looking at is
// ahead of the board everyone else is looking at.
export function SyncStatus({ compact }) {
  const [, force] = useState(0);
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    connectionListeners.add(fn);
    // Nothing here changes on a timer except the words "a minute ago", and a
    // status line that re-renders every second is a status line that twitches.
    const t = setInterval(fn, 30000);
    return () => { connectionListeners.delete(fn); clearInterval(t); };
  }, []);

  const held = totalPendingCount();
  const ok = connectionOk && held === 0 && !lastWriteError;
  const ago = lastSyncedAt ? Date.now() - lastSyncedAt : null;
  const when =
    ago === null ? null
      : ago < 60000 ? "a moment ago"
      : ago < 3600000 ? `${Math.round(ago / 60000)} minutes ago`
      : gregDateTimeStr(lastSyncedAt);

  return (
    <div style={ok ? styles.syncOk : styles.syncHeld}>
      <span style={{ ...styles.syncDot, background: ok ? "var(--ok)" : "var(--hold)" }} />
      <span style={styles.syncWords}>
        {lastWriteError ? (
          <>
            <strong>The server is refusing to save.</strong> {held} change
            {held === 1 ? "" : "s"} held on this device. Nothing is lost.
          </>
        ) : !connectionOk ? (
          <>
            <strong>No signal.</strong> {held} change{held === 1 ? "" : "s"} held on this device
            and sent automatically when it comes back. Nothing is lost.
          </>
        ) : held > 0 ? (
          <>
            <strong>Catching up.</strong> {held} change{held === 1 ? "" : "s"} still going up.
          </>
        ) : (
          <>
            <strong>In sync.</strong> Everything entered on this device has reached the server.{" "}
            {when ? `Last saved ${when}.` : "Nothing has needed saving since this page opened."}
          </>
        )}
      </span>
      {/* Save.
          The queue drains by itself on every poll, so this is not the
          mechanism - it is the answer to "is it actually saved?", which is a
          question somebody standing at the end of a shift is entitled to ask
          and to get an answer to without waiting three seconds to find out.
          It says what happened either way. */}
      <button
        style={{ ...styles.ghostBtnSm, ...(saving ? { opacity: 0.6, cursor: "wait" } : null) }}
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          setSaid("");
          const before = totalPendingCount();
          try {
            await pushPendingWrites();
          } catch (e) {
            /* reported by what is left behind, below */
          }
          const after = totalPendingCount();
          setSaid(
            after === 0
              ? before === 0
                ? "Nothing was waiting — everything was already saved."
                : `Saved. ${before} change${before === 1 ? "" : "s"} sent.`
              : `${after} change${after === 1 ? "" : "s"} still held — the server is not reachable. Nothing is lost.`
          );
          notifyPendingChanged();
          setSaving(false);
          force((n) => n + 1);
        }}
      >
        {saving ? "Saving…" : "Save now"}
      </button>
      {said && <span style={styles.syncSaid}>{said}</span>}
    </div>
  );
}

// One button for "something is missing and I do not know what".
//
// Picking keys off a table is the right shape for a known loss and the wrong
// one for the usual case, where somebody knows the board is short and does not
// know of what. This reads a copy and puts back every record the board no
// longer has, by record id - so nothing already there is touched, nothing
// arrives twice, and nothing is ever removed.
//
// It leaves finished work alone. A completed call is dropped from the live
// board four shifts after its shift was filed because the archive already
// holds it; putting those back would fill the board with work that is done.
// The count is reported either way, so the number that did not come back is
// not a silent decision.
function SyncFromCopy({ copies, onDone }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");

  async function run() {
    if (
      !window.confirm(
        `Read all ${copies.length} saved copies and put back everything this board no longer has?\n\n` +
          `Nothing is removed and nothing already on the board is changed. A record found in ` +
          `several copies comes back once. A safety copy is taken first.`
      )
    )
      return;
    setBusy(true);
    setError("");
    setDone(null);
    try {
      const res = await fetch(`${API_BASE}/api/backups/sync-all`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `The server refused (${res.status}).`);
      setDone(data);
      if (onDone) onDone();
    } catch (e) {
      setError(e.message || "That did not run.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.restoreBox}>
      <div style={styles.restoreHead}>PUT BACK EVERYTHING THAT IS MISSING</div>
      <div style={styles.formHint}>
        Reads every saved copy — all {copies.length} of them — and adds back any record this board
        no longer has. Nothing is removed, nothing already here is changed, and a record found in
        several copies comes back once. Safe to press at any time, and safe to press twice.
      </div>
      <button
        style={{ ...styles.primaryBtn, width: "100%", justifyContent: "center", marginTop: 10 }}
        disabled={busy || !copies.length}
        onClick={run}
      >
        {busy ? "Reading every copy…" : `Sync with all ${copies.length} copies`}
      </button>
      {error && <div style={styles.loginError}>{error}</div>}
      {done && (
        <div style={styles.formHint}>
          {done.added === 0
            ? `Nothing was missing. All ${done.copiesRead} copies were read and the board already had everything in them.`
            : `${done.added} record${done.added === 1 ? "" : "s"} put back, from ${done.copiesRead} copies.`}
          {(done.keys || []).map((k) => (
            <div key={k.key} style={styles.restoreDoneRow}>
              {keyName(k.key)}: {k.added} back
              {k.alreadyFiled ? ` · ${k.alreadyFiled} left alone (already filed in the archive)` : ""}
            </div>
          ))}
          {(done.unreadable || []).length > 0 && (
            <div style={styles.restoreDoneRow}>
              Could not read: {done.unreadable.map((u) => u.name).join(", ")}
            </div>
          )}
          <div style={{ marginTop: 6 }}>Safety copy: {(done.safety || []).join(", ") || "—"}</div>
        </div>
      )}
    </div>
  );
}

// ---------- putting something back ----------
//
// The command line version of this exists for the day the app itself will not
// open. This is for every other day: pick the copy, see what is different, tick
// what to put back.
//
// It restores KEYS, not the whole file. A whole-file rollback throws away every
// hour worked since — the calls, the crews, the hours — to get back something
// that only one key ever lost. What an actual loss looks like is one part of
// the board emptying while everything else carries on being right, and that is
// what this is shaped for.
function RestoreFromCopy({ copies, onDone }) {
  const [pick, setPick] = useState("");
  const [rows, setRows] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  async function compare(name) {
    setPick(name);
    setRows(null);
    setChosen([]);
    setError("");
    setDone(null);
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/backups/${encodeURIComponent(name)}/compare`, {
        headers: authHeaders(),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
      setRows(body.rows || []);
      // Anything smaller now than it was then is ticked to begin with. That is
      // the answer nine times in ten, and it saves reading a table of twenty
      // keys to find the two that matter.
      setChosen(body.lost || []);
    } catch (e) {
      setError((e && e.message) || "That copy could not be read.");
    }
    setBusy(false);
  }

  function toggle(key) {
    setChosen((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
  }

  async function restore() {
    if (!pick || !chosen.length || busy) return;
    const what = chosen
      .map((k) => {
        const r = (rows || []).find((x) => x.key === k);
        const said = (side) => (!side ? "nothing" : side.count === null ? bytesStr(side.bytes) : `${side.count} items`);
        return `  ${keyName(k)}: ${said(r && r.live)} now  ->  ${said(r && r.backup)} from the copy`;
      })
      .join("\n");
    if (
      !window.confirm(
        `Put these back from ${pick}?\n\n${what}\n\n` +
          `Anything added to them since that copy was taken is replaced. Everything ` +
          `else on the board is left alone, and accounts and passwords are never ` +
          `touched.\n\nA copy of the board as it stands right now is taken first, so ` +
          `this is itself undoable.`
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/backups/${encodeURIComponent(pick)}/restore`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ keys: chosen }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
      setDone(body);
      await compare(pick);
      if (onDone) onDone();
    } catch (e) {
      setError((e && e.message) || "That could not be put back.");
    }
    setBusy(false);
  }

  const said = (side) =>
    !side ? "—" : side.count === null ? bytesStr(side.bytes) : `${side.count}`;

  return (
    <div style={styles.backupDownload}>
      <span style={styles.backupLabel}>PUT SOMETHING BACK</span>
      <span style={styles.backupNote}>
        Pick a copy from before whatever went missing. Nothing is changed until you press
        the button at the bottom, and a copy of the board as it stands now is taken first.
      </span>

      <div style={styles.backupActions}>
        <select
          style={{ ...styles.assignSelect, maxWidth: 300 }}
          value={pick}
          onChange={(e) => compare(e.target.value)}
        >
          <option value="">Choose a copy…</option>
          {(copies || []).map((c) => (
            <option key={c.name} value={c.name}>
              {gregDateTimeStr(new Date(c.at).getTime())} · {bytesStr(c.bytes || 0)}
            </option>
          ))}
        </select>
        {busy && <span style={styles.backupNote}>Working…</span>}
      </div>

      {error && <div style={styles.loginError}>{error}</div>}

      {done && (
        <div style={styles.restoreDone}>
          Put back {done.restored.length} · the board is right within a few seconds. The copy
          taken just before this is <strong>{done.safetyCopy}</strong>, if this was the wrong one.
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div style={styles.restoreHead}>
            <span style={styles.restoreHeadKey}>WHAT</span>
            <span style={styles.restoreHeadNum}>IN THE COPY</span>
            <span style={styles.restoreHeadNum}>NOW</span>
          </div>
          {rows.map((r) => {
            const on = chosen.includes(r.key);
            return (
              <button
                key={r.key}
                style={on ? styles.restoreRowOn : styles.restoreRow}
                disabled={!r.restorable}
                onClick={() => toggle(r.key)}
              >
                <span style={styles.restoreTick}>{on ? "✓" : r.restorable ? "" : "—"}</span>
                <span style={styles.restoreKey}>
                  {keyName(r.key)}
                  {r.shrank && <span style={styles.restoreLost}>SMALLER NOW</span>}
                </span>
                <span style={styles.restoreNum}>{said(r.backup)}</span>
                <span style={{ ...styles.restoreNum, color: r.shrank ? "var(--hold)" : "var(--ink-4)" }}>
                  {said(r.live)}
                </span>
              </button>
            );
          })}
          <div style={styles.backupActions}>
            <button style={styles.dangerBtnSm} disabled={busy || !chosen.length} onClick={restore}>
              <RotateCcw size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
              {busy
                ? "Putting it back…"
                : chosen.length
                  ? `Put back ${chosen.length} of these`
                  : "Tick what to put back"}
            </button>
          </div>
        </>
      )}

      {rows && rows.length === 0 && (
        <div style={styles.backupNote}>That copy holds nothing to compare.</div>
      )}
    </div>
  );
}

// Gated on the AREA, not the role.
//
// `role === "admin"` was the test, and a delegate holding the archive IS an
// admin session - but the areas they were lent decide what they may touch, and
// this panel is the archive's. Reading the role instead meant the one person
// who had been asked to look after the backups was the one person who could
// not see them.
export function BackupPanel({ user }) {
  const role = user && user.role;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [pickToTake, setPickToTake] = useState("");
  const [token, setToken] = useState(() => {
    try { return window.localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  });

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/backups`, { headers: authHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      setState(await res.json());
    } catch (e) {
      setState({ unreachable: true });
    }
  };

  useEffect(() => {
    // Hooks run before the role check below, so without this a crew tablet
    // asked the server about backups every five minutes and was told 401 every
    // time, for a panel it never draws.
    if (!canArea(user, "archive")) return undefined;
    let alive = true;
    const tick = async () => { if (alive) await load(); };
    tick();
    const t = setInterval(tick, BACKUP_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [role]);

  if (!canArea(user, "archive")) return null;

  async function backupNow() {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(`${API_BASE}/api/backups`, { method: "POST", headers: authHeaders() });
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
      {/* First thing in the panel: this device, before anything about copies. */}
      <SyncStatus />

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
                  This is how a copy reaches an external drive: download it and save it there.
                  The server has no drive of its own to write to — a hosted machine has no socket
                  to plug one into. (On a server the department owns, <code>BACKUP_DIR_2</code>
                  writes every snapshot straight to a mounted drive as well, and no download is
                  needed.)
                  <br />
                  <br />
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
                  {/* Any copy, not only the newest. Carrying one away is
                      usually about a particular day — the one before whatever
                      went wrong — and "newest" is the one day that is no use
                      for that. */}
                  <select
                    style={{ ...styles.assignSelect, maxWidth: 260 }}
                    value={pickToTake}
                    onChange={(e) => setPickToTake(e.target.value)}
                  >
                    <option value="">Newest copy</option>
                    {(b.copies || []).map((c) => (
                      <option key={c.name} value={c.name}>
                        {gregDateTimeStr(new Date(c.at).getTime())} · {bytesStr(c.bytes || 0)}
                      </option>
                    ))}
                  </select>
                  <button
                    style={styles.ghostBtn}
                    disabled={!token || !b.primary || !b.primary.newest}
                    onClick={() => {
                      const name = pickToTake || b.primary.newest.name;
                      window.open(
                        `${API_BASE}/api/backups/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`,
                        "_blank"
                      );
                    }}
                  >
                    Download
                  </button>
                </div>
              </>
            )}
          </div>

          {/* The usual case first: something is missing and nobody knows what.
              The key-by-key one below is for a loss somebody can already name. */}
          <SyncFromCopy copies={b.copies || []} onDone={load} />
          <RestoreFromCopy copies={b.copies || []} onDone={load} />
        </>
      )}
    </FoldingSection>
  );
}
