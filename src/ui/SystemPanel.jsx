import { authHeaders, issueClaimCode } from "../lib/auth.jsx";
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
export function SystemPanel({ requests, accounts, onOpenCall }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [readAt, setReadAt] = useState(0);
  const [openDevice, setOpenDevice] = useState(null);
  const [testNote, setTestNote] = useState("");
  const [issued, setIssued] = useState({}); // accountId -> code

  async function act(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body || {}),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `The server answered ${res.status}.`);
    return out;
  }

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
          {head("SELF-TEST — THE SERVER CHECKS ITSELF NIGHTLY")}
          {data.selfTest ? (
            <>
              <div style={styles.formHint}>
                Last run {gregDateTimeStr(data.selfTest.at)} ({data.selfTest.reason}) ·{" "}
                {data.selfTest.checks.filter((c) => c.ok).length} of {data.selfTest.checks.length} passed
              </div>
              {data.selfTest.checks.map((c) =>
                row(c.name, (c.ok ? "OK" : "FAILED") + (c.note ? ` · ${c.note}` : ""), c.ok ? undefined : "var(--crit)")
              )}
            </>
          ) : (
            <div style={styles.formHint}>Not run yet.</div>
          )}
          <button
            style={{ ...styles.ghostBtnSm, marginTop: 6 }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await act("/api/system/self-test"); await readNow(); }
              catch (e) { setError(e.message); }
              finally { setBusy(false); }
            }}
          >
            Run the self-test now
          </button>

          {head("ERRORS DEVICES REPORTED")}
          {(data.reports || []).length === 0 ? (
            <div style={styles.formHint}>Nothing reported.</div>
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

          {head("WHAT THE SERVER REFUSED OR CORRECTED")}
          {(data.findings || []).length === 0 ? (
            <div style={styles.formHint}>
              Nothing to report. When a guard fires — a stale device replaying a settled record, a
              write refused for shape or authority, the sign-in limiter tripping — it is listed
              here instead of happening silently.
            </div>
          ) : (
            (data.findings || []).slice(0, 20).map((f, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ ...styles.invMoveItem, color: "var(--hold-2)" }}>
                  {f.message} {f.count > 1 ? `· ×${f.count}` : ""}
                </div>
                <div style={styles.formHint}>{f.kind} · last {gregDateTimeStr(f.ts)}</div>
              </div>
            ))
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
              No device has said hello since the server started.
            </div>
          ) : (
            (data.devices || []).map((d) => {
              const open = openDevice === d.deviceId || openDevice === d.accountId + d.lastSeen;
              const key = d.deviceId || d.accountId + d.lastSeen;
              return (
                <div key={key}>
                  <button
                    style={{ background: "transparent", border: "none", padding: 0, width: "100%", cursor: "pointer", textAlign: "inherit", font: "inherit" }}
                    onClick={() => { setOpenDevice(open ? null : key); setTestNote(""); }}
                  >
                    {row(
                      `${open ? "▾ " : "▸ "}${d.name} · ${(d.role || "?").toUpperCase()}${d.unit ? ` · ${d.unit}` : ""}`,
                      (d.stale ? `SILENT ${ago(d.silentMs)}` : ago(d.silentMs)) +
                        ` · build ${d.build || "?"}` +
                        (d.heldWrites ? ` · HOLDING ${d.heldWrites} unsent` : ""),
                      d.stale ? "var(--crit)" : d.heldWrites ? "var(--hold-2)" : undefined
                    )}
                  </button>
                  {open && (
                    <div style={{ padding: "4px 0 10px 14px" }}>
                      {d.diagnostics ? (
                        Object.entries(d.diagnostics).map(([k, v]) => row(k, String(v),
                          /NOT|absent|denied|no$/.test(String(v)) ? "var(--hold-2)" : undefined))
                      ) : (
                        <div style={styles.formHint}>
                          No diagnostics from this device yet. Ask below — the phone answers on its
                          own next heartbeat, usually inside a minute; press Read again after.
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <button style={styles.ghostBtnSm} disabled={busy}
                          onClick={async () => {
                            try { await act("/api/system/ask-diagnostics", { deviceId: d.deviceId }); setTestNote("Asked. The device answers on its next heartbeat — read again in a minute."); }
                            catch (e) { setTestNote(e.message); }
                          }}>
                          Ask for diagnostics
                        </button>
                        <button style={styles.ghostBtnSm} disabled={busy}
                          onClick={async () => {
                            try {
                              const r = await act("/api/system/test-push", { deviceId: d.deviceId });
                              setTestNote(r.note || `Test sent down the real dispatch path to ${r.sent} of ${r.tokens} token(s)${r.dead ? ` · ${r.dead} dead token(s) pruned` : ""}. The phone should sound like a call.`);
                            } catch (e) { setTestNote(e.message); }
                          }}>
                          Test the alert path
                        </button>
                      </div>
                      {testNote && <div style={{ ...styles.formHint, marginTop: 6 }}>{testNote}</div>}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div style={styles.formHint}>
            {(data.accountsSeen || []).filter((a) => !a.stale).length} account(s) active in the last
            two minutes.
          </div>

          {head("THE RECORD — WHAT IS INCOMPLETE")}
          {row("Completed calls missing sheet data", String(shortCalls.length), shortCalls.length ? "var(--hold-2)" : undefined)}
          {shortCalls.slice(0, 6).map((r) => (
            <div key={r.id} style={{ ...styles.invMoveRow, alignItems: "center" }}>
              <span style={styles.invMoveItem}>
                · {gregDateTimeStr(r.createdAt)} · {r.from || "?"} → {r.to || "?"} — missing{" "}
                {missingLogFields(r).map((f) => f.label).slice(0, 3).join(", ")}
                {missingLogFields(r).length > 3 ? "…" : ""}
              </span>
              {onOpenCall && (
                <button style={styles.ghostBtnSm} onClick={() => onOpenCall(r)}>
                  Find on the board
                </button>
              )}
            </div>
          ))}
          {row("Accounts with an EXPIRED sign-in code", String(expiredCodes.length), expiredCodes.length ? "var(--hold-2)" : undefined)}
          {expiredCodes.slice(0, 5).map((a) => (
            <div key={a.id} style={{ ...styles.invMoveRow, alignItems: "center" }}>
              <span style={styles.invMoveItem}>· {a.name || a.id}</span>
              {issued[a.id] ? (
                <span style={{ ...styles.invMoveWho, fontFamily: "monospace" }}>
                  {issued[a.id]}{" "}
                  <button style={styles.ghostBtnSm} onClick={() => {
                    try { window.navigator.clipboard.writeText(issued[a.id]); } catch (e) {}
                  }}>Copy</button>
                </span>
              ) : (
                <button style={styles.ghostBtnSm} disabled={busy}
                  onClick={async () => {
                    try {
                      const r = await issueClaimCode(a.id);
                      if (r && r.code) setIssued((m) => ({ ...m, [a.id]: r.code }));
                    } catch (e) { window.alert(e.message || "Could not issue a code."); }
                  }}>
                  New code
                </button>
              )}
            </div>
          ))}
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
          {data.server.pushTokensStale > 0 && (
            <div style={{ ...styles.invMoveRow, alignItems: "center" }}>
              <span style={styles.invMoveItem}>· {data.server.pushTokensStale} token(s) silent for two months</span>
              <button style={styles.ghostBtnSm} disabled={busy}
                onClick={async () => {
                  try { const r = await act("/api/system/prune-tokens"); setError(""); await readNow(); window.alert(`Pruned ${r.pruned} stale token(s). A live phone re-registers at its next sign-on.`); }
                  catch (e) { setError(e.message); }
                }}>
                Prune
              </button>
            </div>
          )}

          {head("DAY BY DAY — ONE LINE PER SELF-TEST")}
          {(data.history || []).length >= 2 && (() => {
            // Board p95 by day, as bars. One series, one calm hue; a day
            // whose self-test failed wears the critical red instead — red
            // already means "act" everywhere on this board. Labels only
            // where they earn their place: the peak and the latest day.
            const hist = (data.history || []).slice(-30);
            const max = Math.max(1, ...hist.map((h) => h.boardP95 || 0));
            const peakI = hist.reduce((bi, h, i) => ((h.boardP95 || 0) > (hist[bi].boardP95 || 0) ? i : bi), 0);
            return (
              <div style={{ margin: "6px 0 10px" }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 64,
                  borderBottom: "1px solid var(--hair-2)", paddingBottom: 1 }}>
                  {hist.map((h, i) => (
                    <div key={h.day} title={`${h.day} · board p95 ${h.boardP95} ms`}
                      style={{ flex: 1, minWidth: 3, borderRadius: "2px 2px 0 0",
                        height: `${Math.max(3, Math.round(((h.boardP95 || 0) / max) * 100))}%`,
                        background: h.selfTest === false ? "var(--crit)" : "var(--flow)",
                        position: "relative" }}>
                      {(i === peakI || i === hist.length - 1) && (h.boardP95 || 0) > 0 && (
                        <span style={{ position: "absolute", top: -14, left: "50%",
                          transform: "translateX(-50%)", fontSize: 9, color: "var(--ink-3)",
                          whiteSpace: "nowrap" }}>{h.boardP95}</span>
                      )}
                    </div>
                  ))}
                </div>
                <div style={styles.formHint}>
                  Board reads, 95th percentile ms by day · a red bar is a day whose self-test failed
                </div>
              </div>
            );
          })()}
          {(data.history || []).length === 0 ? (
            <div style={styles.formHint}>No history yet.</div>
          ) : (
            (data.history || []).slice(-14).reverse().map((h) =>
              row(
                `${h.day}${h.selfTest === false ? " · SELF-TEST FAILED" : ""}`,
                `${h.requests} req · board p95 ${h.boardP95}ms · ${h.serverErrors} failed · ${h.devices} device(s) · DB ${h.dbMb} MB`,
                h.selfTest === false ? "var(--crit)" : h.boardP95 > 5000 ? "var(--hold-2)" : undefined
              )
            )
          )}

          {head("THE PROCESS")}
          {row("Up since", `${gregDateTimeStr(data.server.startedAt)} (${msDurationStr(data.server.uptimeMs)})`)}
          {row("Memory", `${data.server.memoryMb} MB`, data.server.memoryMb > 1500 ? "var(--hold-2)" : undefined)}
          {row("Node", data.server.node)}
        </div>
      )}
    </div>
  );
}
