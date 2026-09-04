import { APP_NAME, APP_SLUG } from "../brand/brand.jsx";
import {
  CHECKLIST_PARTS,
  CHECK_ANSWERS,
  checklistFlags,
  checklistItems,
  checklistReadings,
} from "../domain/checklist.jsx";
import { stationLabel } from "../domain/live-sheet.jsx";
import { clockStr } from "../domain/messages.jsx";
import { seatLabel, shiftLabelWithWindow } from "../domain/shift-helpers.jsx";
import { dressSheet, titleSheet } from "../domain/uhu-person.jsx";
import { autoFitSheet } from "../export/workbook.jsx";
import { gregDateStr, gregDateTimeStr } from "../lib/dates.jsx";
import { Search } from "../lib/icons.jsx";
import { useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { FoldingSection } from "./AdminView.jsx";

// ---------- the filed checklists, kept ----------
//
// Every list a crew has filed, back as far as the store holds. The
// administration screen answers "has today's check been done"; this answers
// "what did that truck's check say in March", which is a different question and
// the one an incident is investigated with.
//
// It reads the words off the run itself where they are there — see the comment
// on `fileChecklist` — and falls back to resolving ids against the current
// lists for runs filed before that was kept, which is the best that can be done
// for them.

function partLabel(key) {
  const p = CHECKLIST_PARTS.find((x) => x.key === key);
  return p ? p.label : key;
}

function answerMeta(key) {
  return CHECK_ANSWERS.find((a) => a.key === key) || { label: key, color: "var(--ink-3)" };
}

// What this run flagged, in words. Newer runs carry them; older ones are
// resolved against the lists as they stand now.
export function runFlags(run, checklists) {
  if (run && Array.isArray(run.flagged)) return run.flagged;
  return checklistFlags(run, checklistItems(checklists, run && run.part)).map((f) => ({
    id: f.item.id,
    text: f.item.text,
    answer: f.answer,
  }));
}

export function runReadings(run, checklists) {
  if (run && Array.isArray(run.readings)) return run.readings;
  return checklistReadings(run, checklistItems(checklists, run && run.part)).map((r) => ({
    id: r.item.id,
    text: r.item.text,
    value: r.value,
  }));
}

// Free text against everything a person would search a filed run by: who filed
// it, which truck, and — the reason anybody comes back here — what was wrong
// with it.
function matches(run, checklists, q) {
  if (!q) return true;
  const hay = [
    run.byName,
    run.byAccountId,
    run.unitName,
    partLabel(run.part),
    stationLabel(run.station),
    run.note,
    ...runFlags(run, checklists).map((f) => `${f.text} ${answerMeta(f.answer).label}`),
    ...runReadings(run, checklists).map((r) => `${r.text} ${r.value}`),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

async function exportFiledChecklists(runs, checklists) {
  const wb = XLSX.utils.book_new();
  const headers = [
    "Filed",
    "Day",
    "Shift",
    "Station",
    "Medic",
    "List",
    "Seat",
    "Filed by",
    "Employee ID",
    "Flagged",
    "What was flagged",
    "Readings",
    "Note",
  ];
  const rows = runs.map((r) => {
    const flags = runFlags(r, checklists);
    const reads = runReadings(r, checklists);
    return [
      r.at ? gregDateTimeStr(r.at) : "",
      r.dayKey || "",
      shiftLabelWithWindow(r.shift),
      stationLabel(r.station),
      r.unitName || "",
      partLabel(r.part),
      r.seat ? seatLabel(r.seat) : "",
      r.byName || "",
      r.byAccountId || "",
      flags.length,
      flags.map((f) => `${f.text} — ${answerMeta(f.answer).label}`).join("; "),
      reads.map((x) => `${x.text}: ${x.value}`).join("; "),
      r.note || "",
    ];
  });

  const aoa = [["FILED CHECKLISTS"], [`${runs.length} on file`], [], headers, ...rows];
  const sheet = autoFitSheet(XLSX.utils.aoa_to_sheet(aoa), 3);
  titleSheet(sheet);
  dressSheet(sheet, 3, 1);
  XLSX.utils.book_append_sheet(wb, sheet, "Checklists");

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const filename = `${APP_SLUG}-filed-checklists.xlsx`;
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const file = new File([blob], filename, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: `${APP_NAME} — Filed checklists` });
      return;
    }
  } catch (e) {
    // fall through to download
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function FiledChecklists({ checklistRuns, checklists }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [openRun, setOpenRun] = useState(null);
  const [busy, setBusy] = useState(false);

  const all = (checklistRuns || [])
    .filter((r) => r && r.at)
    .slice()
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  const q = query.trim().toLowerCase();
  const shown = all.filter((r) => {
    if (flaggedOnly && runFlags(r, checklists).length === 0) return false;
    return matches(r, checklists, q);
  });
  const flaggedTotal = all.filter((r) => runFlags(r, checklists).length > 0).length;

  // Under the day it was filed on — the operational day, so a list filed at two
  // in the morning sits under the night it belongs to rather than opening a new
  // heading for a day nobody worked.
  const days = [];
  shown.forEach((r) => {
    const key = r.dayKey || "";
    const last = days[days.length - 1];
    if (last && last.key === key) last.runs.push(r);
    else days.push({ key, runs: [r] });
  });

  async function download() {
    if (busy || !shown.length) return;
    setBusy(true);
    try {
      await exportFiledChecklists(shown, checklists);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FoldingSection
      title="FILED CHECKLISTS"
      count={all.length}
      countLabel="on file"
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div style={styles.sectionNote}>
        {flaggedTotal > 0
          ? `${flaggedTotal} of them reported something.`
          : "None of them reported anything."}
      </div>

      <div style={styles.chkFilterRow}>
        <label style={styles.chkSearchWrap}>
          <Search size={13} />
          <input
            style={styles.chkSearch}
            value={query}
            placeholder="Name, medic, or what was flagged"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          style={flaggedOnly ? styles.reasonPillActive : styles.reasonPill}
          onClick={() => setFlaggedOnly((v) => !v)}
        >
          Only ones that reported something
        </button>
        <button style={styles.primaryBtnSm} onClick={download} disabled={busy || !shown.length}>
          {busy ? "Building…" : "Excel sheet"}
        </button>
      </div>

      {shown.length === 0 ? (
        <div style={styles.emptyState}>
          {all.length === 0
            ? "No checklists have been filed yet."
            : "Nothing on file matches that."}
        </div>
      ) : (
        days.map((day) => (
          <div key={day.key || "undated"} style={{ marginTop: 10 }}>
            <div style={styles.calDayHeading}>
              <span style={styles.calDayHeadingText}>
                {day.key ? gregDateStr(new Date(`${day.key}T12:00:00`).getTime()) : "Undated"}
              </span>
              <span style={styles.calDayHeadingCount}>
                {day.runs.length === 1 ? "1 list" : `${day.runs.length} lists`}
              </span>
            </div>
            {day.runs.map((r) => {
              const flags = runFlags(r, checklists);
              const reads = runReadings(r, checklists);
              const expanded = openRun === r.id;
              return (
                <div key={r.id || `${r.unitId}-${r.part}-${r.at}`} style={styles.chkRunCard}>
                  <button
                    style={styles.chkRunHead}
                    onClick={() => setOpenRun(expanded ? null : r.id)}
                  >
                    <span style={styles.chkRunTime}>{clockStr(r.at)}</span>
                    <span style={styles.chkRunUnit}>{r.unitName || "—"}</span>
                    <span style={styles.chkRunPart}>{partLabel(r.part)}</span>
                    <span style={styles.chkRunWho}>{r.byName || "—"}</span>
                    <span style={flags.length ? styles.chkRunFlagged : styles.chkRunClean}>
                      {flags.length ? `${flags.length} flagged` : "all available"}
                    </span>
                  </button>
                  {expanded && (
                    <div style={styles.chkRunBody}>
                      <div style={styles.chkRunMeta}>
                        {stationLabel(r.station)} · {shiftLabelWithWindow(r.shift)}
                        {r.seat ? ` · ${seatLabel(r.seat)}` : ""}
                        {r.byAccountId ? ` · ${r.byAccountId}` : ""} · filed{" "}
                        {gregDateTimeStr(r.at)}
                      </div>
                      {flags.length > 0 ? (
                        flags.map((f) => (
                          <div key={f.id} style={styles.chkFlagRow}>
                            <span style={{ ...styles.chkFlagDot, background: answerMeta(f.answer).color }} />
                            <span style={styles.chkFlagText}>{f.text}</span>
                            <span style={{ ...styles.chkFlagAnswer, color: answerMeta(f.answer).color }}>
                              {answerMeta(f.answer).label}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div style={styles.chkRunMeta}>
                          Everything on the list was available.
                        </div>
                      )}
                      {reads.length > 0 && (
                        <div style={styles.chkReadings}>
                          {reads.map((x) => (
                            <span key={x.id} style={styles.chkReading}>
                              {x.text}: <strong>{x.value}</strong>
                            </span>
                          ))}
                        </div>
                      )}
                      {r.note && <div style={styles.chkRunNote}>“{r.note}”</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </FoldingSection>
  );
}
