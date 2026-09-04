// ---------- the employees' six-week schedule ----------
//
// The plan, not the board. An administrator (or somebody lent the schedule
// area) lays out six weeks of codes for the department's employees, grouped as
// the department groups them, with the rules it schedules against checked as
// each cell is set. Adding, changing and clearing a code is one tap on the
// cell; the summary and the coverage rows recalculate under it.
//
// It is one object on the board, `ems:schedule`, written whole on each edit —
// an admin planning tool, not the live board, so the whole-key write is the
// right shape here (see the write-rule note in CLAUDE.md).
import {
  SCHEDULE_CODES, SCHEDULE_CODE_ORDER, SCHEDULE_COVERAGE, SCHEDULE_KEY,
  SCHEDULE_REQUIRED_SHIFTS, defaultScheduleStart, employeeScheduleSummary,
  parseScheduleCode, scheduleCellKey, scheduleCoverageCount, scheduleDayIsWeekend,
  scheduleDayKeys, scheduleEligibleAccounts, scheduleIsApproved, scheduleStatusLabel,
  effectiveScheduleCodes, effectiveScheduleCodeOrder, SCHEDULE_CODE_KINDS,
} from "../domain/schedule.jsx";
import { exportScheduleExcel, openSchedulePdf } from "../export/schedule-export.jsx";
import { canArea, isDelegatedAdmin } from "../domain/delegation.jsx";
import { uid } from "../lib/helpers.jsx";
import { writeKey, readKey } from "../lib/offline-queue.jsx";
import { useMemo, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { SectionBanner } from "./AdminView.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";
import { Plus } from "../lib/icons.jsx";

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A colour per code, from the status/brand tokens, so the grid reads at a
// glance without inventing a new palette.
function codeColor(code, codes) {
  const meta = (codes || SCHEDULE_CODES)[code];
  if (!meta) return "var(--ink-3)";
  if (meta.color) return meta.color;
  if (meta.off) return code === "L" ? "var(--ink-4)" : "var(--crit-2)";
  if (meta.ot) return "var(--hold)";
  switch (meta.site) {
    case "main": return meta.period === "night" ? "var(--ink-3)" : "var(--ink)";
    case "ccc": return "#4CD3C8";
    case "royal": return "#BF8CFF";
    case "alm": return "#FF8A5B";
    case "zah": return "#5AA9FF";
    case "disp": return "var(--ok)";
    case "msu": return "#FF5DA2";
    default: return "var(--ink-2)";
  }
}

function dayLabelParts(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return { dow: DOW[wd], dom: d, mon: MON[m - 1] };
}

// The board object, with safe defaults so a fresh board draws an empty grid.
function normalise(schedule) {
  const s = schedule && typeof schedule === "object" ? schedule : {};
  return {
    start: typeof s.start === "number" ? s.start : defaultScheduleStart(),
    groups: Array.isArray(s.groups) ? s.groups : [],
    cells: s.cells && typeof s.cells === "object" ? s.cells : {},
    updatedAt: s.updatedAt || null,
    updatedBy: s.updatedBy || "",
    status: s.status === "submitted" || s.status === "approved" ? s.status : "draft",
    version: typeof s.version === "number" ? s.version : 0,
    submittedBy: s.submittedBy || "", submittedAt: s.submittedAt || null,
    approvedBy: s.approvedBy || "", approvedAt: s.approvedAt || null,
    customCodes: s.customCodes && typeof s.customCodes === "object" ? s.customCodes : {},
    hiddenCodes: Array.isArray(s.hiddenCodes) ? s.hiddenCodes : [],
  };
}

export function SchedulePage({ schedule, setSchedule, accounts, user, addLog }) {
  const model = normalise(schedule);
  const [start, setStart] = useState(model.start);
  const [picker, setPicker] = useState(null); // { accountId, dayKey }
  const [otHours, setOtHours] = useState("");
  const [assignTo, setAssignTo] = useState(null); // group id being added to
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const dayKeys = useMemo(() => scheduleDayKeys(start), [start]);
  const groups = model.groups;
  const cells = model.cells;
  const codes = effectiveScheduleCodes(model);
  const codeOrder = effectiveScheduleCodeOrder(model);
  const [codeEditor, setCodeEditor] = useState(false);

  const accountName = (id) => {
    const a = (accounts || []).find((x) => x.id === id);
    return a ? (a.name || a.id) : id;
  };
  const assigned = new Set(groups.flatMap((g) => g.memberIds || []));
  const everyoneIds = groups.flatMap((g) => g.memberIds || []);

  async function save(next, note) {
    setBusy(true);
    setErr("");
    // Read fresh and merge onto it so two people editing different cells do not
    // wipe each other; the whole object is small enough to write each time.
    const live = normalise(await readKey(SCHEDULE_KEY, schedule));
    const merged = {
      ...live,
      ...next,
      cells: next.cells || live.cells,
      groups: next.groups || live.groups,
      customCodes: next.customCodes || live.customCodes,
      hiddenCodes: next.hiddenCodes || live.hiddenCodes,
      start: next.start != null ? next.start : live.start,
      updatedAt: Date.now(),
      updatedBy: (user && user.name) || "",
    };
    const ok = await writeKey(SCHEDULE_KEY, merged);
    setBusy(false);
    if (!ok) { setErr("No signal — that change was not saved. Nothing changed; try again."); return false; }
    setSchedule(merged);
    if (note) await addLog(note, "status");
    return true;
  }

  // A content edit (a cell, a group, a member) reopens an approved or submitted
  // schedule to draft — an approved sheet on screen must always be the one that
  // was approved.
  async function saveEdit(next, note) {
    return save({ ...next, status: "draft" }, note);
  }

  const isRealAdmin = !!user && user.role === "admin" && !isDelegatedAdmin(user);
  const approved = scheduleIsApproved(model);

  async function submitForApproval() {
    if (!window.confirm("Submit this schedule to an administrator for approval?")) return;
    await save({ status: "submitted", submittedBy: (user && user.name) || "", submittedAt: Date.now() },
      `Schedule submitted for approval by ${(user && user.name) || "preparer"}`);
  }
  async function approveSchedule() {
    if (!window.confirm("Approve and publish this schedule? It can then be exported as the staff PDF.")) return;
    await save({ status: "approved", version: (model.version || 0) + 1, approvedBy: (user && user.name) || "", approvedAt: Date.now() },
      `Schedule V${(model.version || 0) + 1} approved by ${(user && user.name) || "admin"}`);
  }
  async function sendBack() {
    if (!window.confirm("Send this schedule back to the preparer as a draft?")) return;
    await save({ status: "draft" }, `Schedule sent back to draft by ${(user && user.name) || "admin"}`);
  }

  function exportMeta() {
    const first = dayKeys[0].split("-").map(Number), last = dayKeys[dayKeys.length - 1].split("-").map(Number);
    const MONF = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
    const hijri = (() => { try { const f = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { month: "long", day: "numeric" }); return `${f.format(new Date(first[0], first[1]-1, first[2]))} → ${f.format(new Date(last[0], last[1]-1, last[2]))} 1448 H`; } catch (e) { return ""; } })();
    const todayKeyOf = (() => { const d = new Date(); const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; })();
    return {
      periodLabel: `${first[2]} ${MONF[first[1]-1]} TO ${last[2]} ${MONF[last[1]-1]} ${last[0]}`,
      hijriRange: hijri,
      version: model.version, status: model.status, statusLabel: scheduleStatusLabel(model),
      approvedBy: model.approvedBy, approvedAt: model.approvedAt ? new Date(model.approvedAt).toLocaleDateString("en-GB") : "",
      generated: `Generated ${new Date().toLocaleString("en-GB")}`,
      todayKey: todayKeyOf, fileTag: dayKeys[0],
    };
  }
  function doExportPdf() { openSchedulePdf({ schedule: model, accounts, dayKeys, meta: exportMeta() }); }
  async function doExportExcel() { await exportScheduleExcel({ schedule: model, accounts, dayKeys, meta: exportMeta() }); }

  function setStartDate(value) {
    // value: "YYYY-MM-DD" from the date field. Snap to the Sunday of that week.
    if (!value) return;
    const [y, m, d] = value.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setHours(0, 0, 0, 0);
    dt.setDate(dt.getDate() - dt.getDay());
    const ms = dt.getTime();
    setStart(ms);
    saveEdit({ start: ms }, `Schedule start set to the week of ${value}`);
  }

  async function addGroup() {
    const name = window.prompt("Name this group (you can rename it later):", `Group ${groups.length + 1}`);
    if (!name) return;
    await saveEdit({ groups: [...groups, { id: uid("grp"), name: name.trim(), memberIds: [] }] }, `Schedule group "${name.trim()}" added`);
  }
  async function renameGroup(g) {
    const name = window.prompt("Rename this group:", g.name);
    if (!name || name.trim() === g.name) return;
    await saveEdit({ groups: groups.map((x) => (x.id === g.id ? { ...x, name: name.trim() } : x)) }, `Schedule group renamed to "${name.trim()}"`);
  }
  async function removeGroup(g) {
    if (!window.confirm(`Remove the group "${g.name}"? The people in it go back to Unassigned; their codes are kept.`)) return;
    await saveEdit({ groups: groups.filter((x) => x.id !== g.id) }, `Schedule group "${g.name}" removed`);
  }
  async function addToGroup(groupId, accountId) {
    await saveEdit({
      groups: groups.map((g) => (g.id === groupId ? { ...g, memberIds: [...(g.memberIds || []), accountId] } : { ...g, memberIds: (g.memberIds || []).filter((id) => id !== accountId) })),
    }, `${accountName(accountId)} added to the schedule`);
    setAssignTo(null);
  }
  async function removeFromGroup(groupId, accountId) {
    await saveEdit({ groups: groups.map((g) => (g.id === groupId ? { ...g, memberIds: (g.memberIds || []).filter((id) => id !== accountId) } : g)) },
      `${accountName(accountId)} taken off the schedule`);
  }

  async function setCell(accountId, dayKey, code, hours) {
    const token = code ? code + (hours ? String(hours) : "") : "";
    const nextCells = { ...cells };
    const key = scheduleCellKey(accountId, dayKey);
    if (token) nextCells[key] = token; else delete nextCells[key];
    const parts = dayLabelParts(dayKey);
    await saveEdit({ cells: nextCells },
      `Schedule — ${accountName(accountId)} on ${parts.dow} ${parts.dom} ${parts.mon} set to ${token || "off"}`);
    setPicker(null);
    setOtHours("");
  }

  const unassigned = scheduleEligibleAccounts(accounts).filter((a) => !assigned.has(a.id));

  return (
    <div>
      <SectionBanner title="EMPLOYEES SCHEDULE" countLabel="six weeks">
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--ink-4)" }}>Starts</span>
          <input
            type="date"
            lang="en-GB"
            style={{ ...styles.dateInput, maxWidth: 170 }}
            value={dayKeys[0]}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <button style={styles.bannerBtn} onClick={addGroup}><Plus size={12} /> Group</button>
        </span>
      </SectionBanner>

      {/* Status, version, and the workflow. A preparer submits; a real
          administrator approves or sends back; the approved sheet is the only
          one the staff PDF is offered from. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "2px 0 4px" }}>
        <span style={{
          fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, padding: "3px 9px", borderRadius: 5,
          background: approved ? "rgba(48,209,88,.14)" : model.status === "submitted" ? "rgba(255,159,10,.16)" : "var(--inset-2)",
          color: approved ? "var(--ok)" : model.status === "submitted" ? "var(--hold)" : "var(--ink-3)",
        }}>{model.version ? `V${model.version} · ` : ""}{scheduleStatusLabel(model)}</span>
        {model.status === "submitted" && model.submittedBy && (
          <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>submitted by {model.submittedBy}</span>
        )}
        {approved && model.approvedBy && (
          <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>approved by {model.approvedBy}</span>
        )}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 7, flexWrap: "wrap" }}>
          {!approved && model.status !== "submitted" && (
            <button style={styles.bannerBtn} disabled={busy} onClick={submitForApproval}>Submit for approval</button>
          )}
          {model.status === "submitted" && isRealAdmin && (
            <>
              <button style={styles.bannerBtn} disabled={busy} onClick={sendBack}>Send back</button>
              <button style={{ ...styles.primaryBtnSm }} disabled={busy} onClick={approveSchedule}>Approve &amp; publish</button>
            </>
          )}
          {model.status === "submitted" && !isRealAdmin && (
            <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>waiting for an administrator to approve</span>
          )}
          <button style={styles.bannerBtn} onClick={doExportExcel}>Export Excel</button>
          {approved
            ? <button style={styles.bannerBtn} onClick={doExportPdf}>Export staff PDF</button>
            : <button style={{ ...styles.bannerBtn, opacity: 0.5 }} disabled title="Approve the schedule first">Staff PDF (after approval)</button>}
        </span>
      </div>

      {model.updatedAt ? (
        <div style={styles.sectionNote}>
          Last edited {new Date(model.updatedAt).toLocaleString("en-GB")}{model.updatedBy ? ` by ${model.updatedBy}` : ""}.
          Tap any day to set, change or clear its code. The rules are checked as you go.
        </div>
      ) : (
        <div style={styles.sectionNote}>
          Add a group, put employees in it, then tap a day to set a code. Six weeks from the Sunday shown.
        </div>
      )}
      {err && <div style={styles.loginError}>{err}</div>}

      <div style={{ overflowX: "auto", marginTop: 10, WebkitOverflowScrolling: "touch" }}>
        <ScheduleGrid
          dayKeys={dayKeys}
          groups={groups}
          cells={cells}
          codes={codes}
          accountName={accountName}
          onCell={(accountId, dayKey) => { setPicker({ accountId, dayKey }); setOtHours(parseScheduleCode(cells[scheduleCellKey(accountId, dayKey)] || "").hours || ""); }}
          onRenameGroup={renameGroup}
          onRemoveGroup={removeGroup}
          onRemoveMember={removeFromGroup}
          onAddMember={(gid) => setAssignTo(gid)}
          allIds={everyoneIds}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button style={styles.bannerBtn} onClick={() => setCodeEditor(true)}>Manage codes</button>
      </div>
      <ScheduleLegend codes={codes} codeOrder={codeOrder} />
      {codeEditor && (
        <CodeEditor
          model={model}
          codes={codes}
          codeOrder={codeOrder}
          onClose={() => setCodeEditor(false)}
          onSave={saveEdit}
        />
      )}

      {/* The cell code picker. */}
      {picker && (() => {
        const parts = dayLabelParts(picker.dayKey);
        const cur = parseScheduleCode(cells[scheduleCellKey(picker.accountId, picker.dayKey)] || "");
        return (
          <div style={sx.modalWrap} onClick={() => setPicker(null)}>
            <div style={sx.modal} onClick={(e) => e.stopPropagation()}>
              <div style={sx.modalHead}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{accountName(picker.accountId)}</span>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{parts.dow} {parts.dom} {parts.mon}</span>
                <button style={sx.modalX} onClick={() => setPicker(null)}>✕</button>
              </div>
              <div style={sx.codeGrid}>
                {codeOrder.map((code) => {
                  const meta = codes[code];
                  const on = cur.code === code;
                  return (
                    <button
                      key={code}
                      title={meta.label}
                      style={{ ...sx.codeBtn, color: codeColor(code, codes), borderColor: on ? "var(--flow)" : "var(--hair-2)", background: on ? "rgba(10,132,255,.18)" : "var(--inset-2)" }}
                      onClick={() => setCell(picker.accountId, picker.dayKey, code, meta.ot ? (otHours || "") : "")}
                    >
                      {meta.show || code}
                    </button>
                  );
                })}
                <button style={{ ...sx.codeBtn, color: "var(--ink-3)", borderColor: "var(--hair-2)", background: "var(--inset)" }} onClick={() => setCell(picker.accountId, picker.dayKey, "", "")}>OFF</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Overtime hours</span>
                <input
                  type="number"
                  min="0"
                  max="12"
                  style={{ ...styles.input, width: 80, fontSize: 16 }}
                  value={otHours}
                  onChange={(e) => setOtHours(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="—"
                />
                <span style={{ fontSize: 11, color: "var(--ink-4)" }}>for H · P · CH · CP</span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 8 }}>
                Tap a code to set it. The number applies to the overtime codes only — H6 is a 12-hour day with 6 of them overtime.
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add an employee to a group. */}
      {assignTo && (
        <div style={sx.modalWrap} onClick={() => setAssignTo(null)}>
          <div style={sx.modal} onClick={(e) => e.stopPropagation()}>
            <div style={sx.modalHead}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Add an employee</span>
              <button style={sx.modalX} onClick={() => setAssignTo(null)}>✕</button>
            </div>
            {unassigned.length === 0 ? (
              <div style={styles.formHint}>Everyone on file is already on the schedule.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                {unassigned.map((a) => (
                  <button key={a.id} style={sx.pickRow} disabled={busy} onClick={() => addToGroup(assignTo, a.id)}>
                    <span style={{ fontWeight: 600 }}>{a.name || a.id}</span>
                    <span style={{ fontSize: 12, color: "var(--ink-4)" }}>{a.id}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <InfoNote label="What the rules check">
        Every employee owes {SCHEDULE_REQUIRED_SHIFTS} shifts across the six weeks; overtime is capped at 80 hours;
        nobody works a sixth day in a row or sits more than five days off in a row; a leave must have a worked day on
        both sides. Office staff are exempt from the shift count. Coverage counts people, and a team is two people.
      </InfoNote>
    </div>
  );
}

function ScheduleGrid({ dayKeys, groups, cells, codes, accountName, onCell, onRenameGroup, onRemoveGroup, onRemoveMember, onAddMember, allIds }) {
  const CODES = codes || SCHEDULE_CODES;
  const NAME_W = 150, CW = 30, SUM_W = 132;
  const weekendBg = "var(--inset)";
  return (
    <div style={{ minWidth: NAME_W + dayKeys.length * CW + SUM_W }}>
      {/* header */}
      <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 1 }}>
        <div style={{ width: NAME_W, flex: "none", position: "sticky", left: 0, zIndex: 3, background: "var(--panel)" }} />
        {dayKeys.map((k, i) => {
          const p = dayLabelParts(k);
          const wknd = scheduleDayIsWeekend(k);
          return (
            <div key={k} style={{ width: CW, flex: "none", textAlign: "center", padding: "2px 0", background: wknd ? weekendBg : "transparent", borderLeft: p.dow === "SUN" ? "1px solid var(--hair-2)" : "none" }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: "var(--ink-4)" }}>{p.dow[0]}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: p.dom === 1 ? "var(--ink)" : "var(--ink-2)" }}>{p.dom}</div>
            </div>
          );
        })}
        <div style={{ width: SUM_W, flex: "none", display: "flex" }}>
          {["SHIFTS", "OT h", "RULES"].map((t) => (
            <div key={t} style={{ flex: 1, textAlign: "center", fontSize: 8.5, fontWeight: 800, letterSpacing: 0.6, color: "var(--ink-4)", alignSelf: "flex-end", paddingBottom: 3 }}>{t}</div>
          ))}
        </div>
      </div>

      {groups.length === 0 && (
        <div style={{ ...styles.formHint, padding: "16px 4px" }}>No groups yet. Add one from the banner, then add employees to it.</div>
      )}

      {groups.map((g) => (
        <div key={g.id}>
          <div style={sx.groupHead}>
            <button style={sx.groupName} onClick={() => onRenameGroup(g)} title="Rename">{g.name}</button>
            <span style={{ fontSize: 10.5, color: "var(--ink-4)" }}>{(g.memberIds || []).length} people</span>
            <button style={sx.groupBtn} onClick={() => onAddMember(g.id)}><Plus size={11} /> Add</button>
            <button style={sx.groupBtn} onClick={() => onRemoveGroup(g)}>Remove group</button>
          </div>
          {(g.memberIds || []).map((id) => {
            const sum = employeeScheduleSummary(cells, id, dayKeys, CODES);
            const bad = sum.flags.length > 0;
            return (
              <div key={id} style={{ display: "flex", borderBottom: "1px solid var(--hair)", background: bad ? "rgba(255,69,58,.04)" : "transparent" }}>
                <div style={{ width: NAME_W, flex: "none", position: "sticky", left: 0, zIndex: 2, background: bad ? "#2a1518" : "var(--panel)", display: "flex", alignItems: "center", gap: 4, padding: "0 6px", borderRight: "1px solid var(--hair-2)", minWidth: 0 }}>
                  <button style={sx.memberX} title="Take off the schedule" onClick={() => onRemoveMember(g.id, id)}>✕</button>
                  <span style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{accountName(id)}</span>
                </div>
                {dayKeys.map((k) => {
                  const tok = parseScheduleCode(cells[scheduleCellKey(id, k)] || "");
                  const wknd = scheduleDayIsWeekend(k);
                  const meta = CODES[tok.code];
                  return (
                    <button key={k} onClick={() => onCell(id, k)}
                      style={{ width: CW, height: 26, flex: "none", boxSizing: "border-box", border: "none", borderLeft: dayLabelParts(k).dow === "SUN" ? "1px solid var(--hair-2)" : "1px solid var(--hair)", background: wknd ? weekendBg : "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: tok.code.length > 1 ? 8.5 : 10.5, fontWeight: meta && meta.ot ? 800 : 700, color: codeColor(tok.code, CODES), padding: 0 }}>
                      {meta ? (meta.show || tok.code) : ""}{tok.hours ? <span style={{ fontSize: 7 }}>{tok.hours}</span> : ""}
                    </button>
                  );
                })}
                <div style={{ width: SUM_W, flex: "none", display: "flex", alignItems: "center" }}>
                  <div style={{ flex: 1, textAlign: "center", fontSize: 11.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: sum.exempt ? "var(--ink-4)" : sum.shifts === SCHEDULE_REQUIRED_SHIFTS ? "var(--ink-2)" : "var(--hold)" }}>{sum.exempt ? "—" : sum.shifts}</div>
                  <div style={{ flex: 1, textAlign: "center", fontSize: 11.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: sum.otHours > 80 ? "var(--crit)" : sum.otHours ? "var(--hold)" : "var(--ink-4)" }}>{sum.otHours || "—"}</div>
                  <div style={{ flex: 1, textAlign: "center" }} title={sum.flags.join("; ")}>
                    {bad
                      ? <span style={{ display: "inline-flex", minWidth: 18, height: 18, borderRadius: 999, background: "rgba(255,69,58,.16)", color: "var(--crit)", fontSize: 10.5, fontWeight: 800, alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{sum.flags.length}</span>
                      : <span style={{ color: "var(--ok)", fontWeight: 800, fontSize: 12 }}>✓</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* coverage */}
      {groups.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={sx.groupHead}><span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1, color: "var(--ink-3)" }}>COVERAGE — PEOPLE ON, PER DAY</span></div>
          {SCHEDULE_COVERAGE.map((c) => (
            <div key={c.key} style={{ display: "flex", borderBottom: "1px solid var(--hair)" }}>
              <div style={{ width: NAME_W, flex: "none", position: "sticky", left: 0, zIndex: 2, background: "var(--panel)", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 6px", borderRight: "1px solid var(--hair-2)" }}>
                <span style={{ fontSize: 10.5, color: "var(--ink-2)" }}>{c.label}</span>
              </div>
              {dayKeys.map((k) => {
                const wknd = scheduleDayIsWeekend(k);
                const need = c.need(wknd);
                const n = scheduleCoverageCount(cells, allIds, k, c.codes);
                const short = need > 0 && n < need;
                return (
                  <div key={k} style={{ width: CW, height: 22, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", borderLeft: dayLabelParts(k).dow === "SUN" ? "1px solid var(--hair-2)" : "1px solid var(--hair)", background: short ? "rgba(255,159,10,.3)" : wknd ? weekendBg : "transparent", fontSize: 9.5, fontWeight: short ? 800 : 600, color: short ? "var(--hold)" : need === 0 ? "var(--hair-3)" : "var(--ink-4)" }}>
                    {need === 0 ? "·" : n}
                  </div>
                );
              })}
              <div style={{ width: SUM_W, flex: "none" }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduleLegend({ codes, codeOrder }) {
  const CODES = codes || SCHEDULE_CODES;
  const order = codeOrder || SCHEDULE_CODE_ORDER;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", alignItems: "center", marginTop: 8 }}>
      {order.map((code) => {
        const meta = CODES[code]; if (!meta) return null;
        return (
          <span key={code} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ minWidth: 20, height: 17, padding: "0 4px", boxSizing: "border-box", borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--inset-2)", color: codeColor(code, CODES), fontSize: 9.5, fontWeight: 800 }}>{meta.show || code}</span>
            <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{meta.label}</span>
          </span>
        );
      })}
      <span style={{ fontSize: 10.5, color: "var(--ink-4)" }}>H6 = a 12-hour day, 6 of them overtime</span>
    </div>
  );
}

// Add, rename, recolour or remove the codes the department schedules with. The
// built-in legend is the starting point; changes are stored on the schedule
// (customCodes / hiddenCodes) so they travel with it and never touch another.
function CodeEditor({ model, codes, codeOrder, onClose, onSave }) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#4CD3C8");
  const [kind, setKind] = useState("day");
  const [busy, setBusy] = useState(false);
  const custom = model.customCodes || {};
  const hidden = model.hiddenCodes || [];

  async function write(nextCustom, nextHidden, note) {
    setBusy(true);
    await onSave({ customCodes: nextCustom, hiddenCodes: nextHidden }, note);
    setBusy(false);
  }
  async function addCode() {
    const k = code.trim().toUpperCase().replace(/[^A-Z&]/g, "");
    if (!k || !label.trim()) return;
    await write({ ...custom, [k]: { label: label.trim(), color, kind } }, hidden.filter((h) => h !== k), `Schedule code ${k} added`);
    setCode(""); setLabel("");
  }
  async function editCode(k, patch) {
    await write({ ...custom, [k]: { ...(custom[k] || {}), ...patch } }, hidden, `Schedule code ${k} changed`);
  }
  async function removeCode(k) {
    if (SCHEDULE_CODES[k]) { await write(custom, [...new Set([...hidden, k])], `Schedule code ${k} hidden`); }
    else { const c = { ...custom }; delete c[k]; await write(c, hidden, `Schedule code ${k} removed`); }
  }
  async function restore(k) { await write(custom, hidden.filter((h) => h !== k), `Schedule code ${k} restored`); }

  return (
    <div style={sx.modalWrap} onClick={onClose}>
      <div style={{ ...sx.modal, width: 460, maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={sx.modalHead}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Manage codes</span>
          <button style={sx.modalX} onClick={onClose}>✕</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {codeOrder.map((k) => {
            const meta = codes[k]; if (!meta) return null;
            const isBuiltin = !!SCHEDULE_CODES[k];
            return (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, background: "var(--inset)", border: "1px solid var(--hair)" }}>
                <span style={{ minWidth: 26, height: 20, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--inset-2)", color: codeColor(k, codes), fontSize: 11, fontWeight: 800 }}>{meta.show || k}</span>
                <input style={{ ...styles.input, flex: 1, fontSize: 16, padding: "6px 8px" }} value={meta.label} onChange={(e) => editCode(k, { label: e.target.value })} />
                <input type="color" value={meta.color || "#888888"} onChange={(e) => editCode(k, { color: e.target.value })} style={{ width: 30, height: 30, border: "none", background: "none", padding: 0, cursor: "pointer" }} title="Colour" />
                <button style={sx.groupBtn} disabled={busy} onClick={() => removeCode(k)}>{isBuiltin ? "Hide" : "Delete"}</button>
              </div>
            );
          })}
          {hidden.filter((k) => SCHEDULE_CODES[k]).length > 0 && (
            <div style={{ marginTop: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-4)" }}>HIDDEN — tap to restore</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
                {hidden.filter((k) => SCHEDULE_CODES[k]).map((k) => (
                  <button key={k} style={sx.groupBtn} onClick={() => restore(k)}>{k} · {SCHEDULE_CODES[k].label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{ height: 1, background: "var(--hair)", margin: "12px 0" }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>ADD A CODE</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <input style={{ ...styles.input, width: 70, fontSize: 16, padding: "8px" }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code" maxLength={3} />
          <input style={{ ...styles.input, flex: 1, minWidth: 140, fontSize: 16, padding: "8px" }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What it means" />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 34, height: 34, border: "none", background: "none", padding: 0, cursor: "pointer" }} />
          <select style={{ ...styles.input, width: 130, fontSize: 16, padding: "8px" }} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="day">Day shift</option>
            <option value="night">Night shift</option>
            <option value="overtime">Overtime</option>
            <option value="office">Office (exempt)</option>
            <option value="off">Off / leave</option>
          </select>
          <button style={styles.primaryBtnSm} disabled={busy || !code.trim() || !label.trim()} onClick={addCode}>Add</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 8, lineHeight: 1.5 }}>
          A code's kind decides how it counts: a day, night or office code is a worked shift; overtime adds hours; off is a rest or leave day. Built-in codes can be hidden and brought back; codes you add can be deleted outright. Coverage rows follow the built-in sites.
        </div>
      </div>
    </div>
  );
}

const sx = {
  groupHead: { display: "flex", alignItems: "center", gap: 8, background: "var(--inset-2)", borderTop: "1px solid var(--hair-2)", borderBottom: "1px solid var(--hair)", padding: "4px 8px", position: "sticky", left: 0, zIndex: 2, width: "fit-content", minWidth: 150 },
  groupName: { fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: "var(--ink-2)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 },
  groupBtn: { fontSize: 10.5, fontWeight: 600, color: "var(--ink-3)", background: "var(--veil)", border: "1px solid var(--hair-2)", borderRadius: 999, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 3 },
  memberX: { flex: "none", width: 16, height: 16, borderRadius: 999, border: "1px solid var(--hair-2)", background: "var(--veil)", color: "var(--ink-4)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 },
  modalWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 },
  modal: { background: "var(--panel)", border: "1px solid var(--hair-2)", borderRadius: 16, boxShadow: "0 12px 32px rgba(0,0,0,.6)", padding: 14, width: 300, maxWidth: "100%" },
  modalHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  modalX: { marginLeft: "auto", background: "none", border: "none", color: "var(--ink-3)", cursor: "pointer", padding: 2 },
  codeGrid: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 },
  codeBtn: { height: 40, borderRadius: 9, border: "1px solid var(--hair-2)", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" },
  pickRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, background: "var(--inset)", border: "1px solid var(--hair)", cursor: "pointer", fontFamily: "inherit", color: "var(--ink)" },
};
