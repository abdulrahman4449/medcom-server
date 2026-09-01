import { authHeaders } from "../lib/auth.jsx";
import { API_BASE } from "../lib/board-api.jsx";
import { gregDateTimeStr } from "../lib/dates.jsx";
import { useEffect, useState } from "../lib/react.jsx";
import { msDurationStr } from "../domain/messages.jsx";
import { missingLogFields } from "../domain/sheet-gaps.jsx";
import { styles } from "../styles.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";

// ---------- the owner's System page ----------
//
// Everything the platform knows about its own health, on one screen, for one
// person. Errors devices reported land here with the build stamp that says
// whether the phone was even running the current version; the fleet table
// says which phones the server has actually heard from — a crew phone gone
// silent is a crew that will miss a call, and silence is a thing only the
// server can see. Read when the page is OPENED, never on a poll: watching
// the system must not become a load on the system.
export function SystemPanel({ requests, accounts }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [readAt, setReadAt] = useState(0);

  async function readNow() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/system`, { headers: authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `The server answered ${res.status}.`);
      }
      setData(await res.json());
      setReadAt(Date.now());
    } catch (e) {
      setError(e.message || "Could not read the system report.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    readNow();
  }, []);

  async function clearReports() {
    if (!window.confirm("Clear the error list?\n\nThis records that you have read everything on it. The next fault starts the list again."))
      return;
    setBusy(true);
    try {
      await fetch(`${API_BASE}/api/system/clear-reports`, { method: "POST", headers: authHeaders() });
      await readNow();
    } finally {
      setBusy(false);
    }
  }

  const mb = (bytes) => {
    const n = Number(bytes || 0);
    return n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${(n / 1048576).toFixed(1)} MB`;
  };
  const ago = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)}s ago` : `${msDurationStr(ms)} ago`);

  // The data-quality half comes from the board the page already holds — the
  // server report carries the machine's health, this carries the record's.
  const shortCalls = (requests || []).filter((r) => r && r.status === "completed" && missingLogFields(r).length > 0);
  const expiredCodes = (accounts || []).filter(
    (a) => a && !a.hasPassword && a.codeIssued && a.codeExpires && a.codeExpires < Date.now()
  );
  const neverClaimed = (accounts || []).filter((a) => a && !a.hasPassword && !a.codeIssued);

  const head = (text) => <div style={{ ...styles.invShortHead, marginTop: 14 }}>{text}</div>;
  const row = (label, value, tone) => (
    <div key={label} style={styles.invMoveRow}>
      <span style={styles.invMoveItem}>{label}</span>
      <span style={{ ...styles.invMoveWho, ...(tone ? { color: tone } : {}) }}>{value}</span>
    </div>
  );

  return (
    <div>
      <InfoNote label="Owner's eyes only">
        This page is answered by the server to {`your account`} alone — it maps every device, lists
        every fault reported, and shows how the server is coping. It is read when you open it, and
        costs the board nothing while it sits closed.
      </InfoNote>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <button style={styles.ghostBtnSm} disabled={busy} onClick={readNow}>
          {busy ? "…" : "Read again"}
        </button>
        {readAt > 0 && <span style={styles.formHint}>read {gregDateTimeStr(readAt)}</span>}
      </div>
      {error && <div style={styles.loginError}>{error}</div>}

      {data && (
        <div style={styles.invMovesWrap}>
          {head("ERRORS DEVICES REPORTED")}
          {(data.reports || []).length === 0 ? (
            <div style={styles.formHint}>Nothing reported. Errors caught on any signed-in device land here by themselves.</div>
          ) : (
            <>
              {(data.reports || []).slice(0, 20).map((r, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ ...styles.invMoveItem, color: "var(--crit)" }}>
                    {r.message} {r.count > 1 ? `· ×${r.count}` : ""}
                  </div>
                  <div style={styles.formHint}>
                    {r.role || "?"} {r.unit ? `· ${r.unit}` : ""} · {r.by || ""} · build {r.build || "?"} ·{" "}
                    {gregDateTimeStr(r.ts)} {r.platform ? `· ${r.platform}` : ""}
                  </div>
                </div>
              ))}
              <button style={styles.ghostBtnSm} disabled={busy} onClick={clearReports}>
                Clear the list — I have read these
              </button>
            </>
          )}

          {head("SERVER FAULTS (5xx ANSWERS)")}
          {(data.recent5xx || []).length === 0 ? (
            <div style={styles.formHint}>None since the server started ({gregDateTimeStr(data.server.startedAt)}).</div>
          ) : (
            (data.recent5xx || []).slice(0, 10).map((e, i) =>
              row(`${e.method} ${e.path}`, `${e.status} · ${gregDateTimeStr(e.ts)}`, "var(--crit)")
            )
          )}

          {head("DEVICES — WHO THE SERVER HAS HEARD FROM")}
          {(data.devices || []).length === 0 ? (
            <div style={styles.formHint}>
              No device has said hello since the server started. Devices report themselves every few
              minutes once they run this build.
            </div>
          ) : (
            (data.devices || []).map((d, i) =>
              row(
                `${d.name} · ${(d.role || "?").toUpperCase()}${d.unit ? ` · ${d.unit}` : ""}`,
                d.stale ? `SILENT ${ago(d.silentMs)} · build ${d.build || "?"}` : `${ago(d.silentMs)} · build ${d.build || "?"}`,
                d.stale ? "var(--crit)" : undefined
              )
            )
          )}
          <div style={styles.formHint}>
            {(data.accountsSeen || []).filter((a) => !a.stale).length} account(s) active in the last
            two minutes · a signed-on truck going SILENT here is a crew that will miss a call.
          </div>

          {head("THE RECORD — WHAT IS INCOMPLETE")}
          {row("Completed calls missing sheet data", String(shortCalls.length), shortCalls.length ? "var(--hold-2)" : undefined)}
          {row("Accounts with an EXPIRED sign-in code", String(expiredCodes.length), expiredCodes.length ? "var(--hold-2)" : undefined)}
          {expiredCodes.slice(0, 5).map((a) => row(`· ${a.name || a.id}`, "issue a new code from the roster"))}
          {row("Accounts never signed into, no code out", String(neverClaimed.length))}

          {head("TRAFFIC — HOW FAST THE SERVER ANSWERS")}
          {(data.traffic || []).map((t) =>
            row(
              t.group,
              `${t.requests} req · p50 ${t.p50}ms · p95 ${t.p95}ms` +
                (t.notModified ? ` · ${Math.round((t.notModified / t.requests) * 100)}% unchanged` : "") +
                (t.serverErrors ? ` · ${t.serverErrors} failed` : ""),
              t.serverErrors ? "var(--crit)" : t.p95 > 5000 ? "var(--hold-2)" : undefined
            )
          )}

          {head("STORAGE & COPIES")}
          {row("Database", `${mb(data.database.fileBytes)} · ${data.database.survivesRedeploy ? "on a persistent disk" : "NOT PERSISTENT — will be lost on deploy"}`,
            data.database.survivesRedeploy ? undefined : "var(--crit)")}
          {data.disk && data.disk.measured
            ? row("Disk", `${data.disk.usedPct}% full · ${mb(data.disk.freeBytes)} free`,
                data.disk.warning ? "var(--hold-2)" : undefined)
            : row("Disk", "not measurable on this host")}
          {row("Board", `${mb(data.boardBytes)} · largest ${data.boardKeys && data.boardKeys[0] ? `${data.boardKeys[0].key} (${mb(data.boardKeys[0].bytes)})` : "—"}`)}
          {row("Backups", data.backups && data.backups.primary
            ? `${data.backups.primary.count} copies · last written ${data.backups.ageMs != null ? ago(data.backups.ageMs) : "never"}`
            : "state unavailable",
            data.backups && data.backups.stale ? "var(--crit)" : undefined)}
          {row("Push alerts", data.server.pushConfigured ? `configured · ${data.server.pushTokens} device token(s)` : "NOT configured — locked phones are not woken",
            data.server.pushConfigured ? undefined : "var(--hold-2)")}

          {head("THE PROCESS")}
          {row("Up since", `${gregDateTimeStr(data.server.startedAt)} (${msDurationStr(data.server.uptimeMs)})`)}
          {row("Memory", `${data.server.memoryMb} MB`, data.server.memoryMb > 1500 ? "var(--hold-2)" : undefined)}
          {row("Node", data.server.node)}
        </div>
      )}
    </div>
  );
}
