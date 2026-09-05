import { stoodDownBeforeArrival } from "../domain/close-reasons.jsx";
import { ORG_STAMP } from "../brand/artwork.jsx";
import { APP_NAME, APP_SLUG } from "../brand/brand.jsx";
import { callFrom, callRoute, callTo } from "../domain/call-locations.jsx";
import { CHECKLIST_KEY, CHECKLIST_PARTS, UNSORTED_CHECK, checklistCategories, checklistDoneByPerson, checklistFlags, checklistItems, checklistRunFor, checklistTree, emptyChecklists, isWriteItem, shiftKeyFor } from "../domain/checklist.jsx";
import { CHECKLIST_GOOD, PCR_GOOD, RESPONSE_GOOD, RESPONSE_TARGET_MS, UHU_HEADROOM, UHU_TARGET, isInternalEmergency, responseCompliance, responseMsFor } from "../domain/compliance.jsx";
import { REQ_STATUS, priorityKeyOf } from "../domain/constants.jsx";
import { submissionGaps } from "../domain/coverage.jsx";
import { medicCrewIndex, stayWindow } from "../domain/crew-stamps.jsx";
import { escalatedCalls, escalationIsOpen } from "../domain/escalations.jsx";
import { isStaffed } from "../domain/in-service.jsx";
import { STATIONS, stationLabel, stationOf, stationShort } from "../domain/live-sheet.jsx";
import { clockStr, durationStr, msDurationStr, shortDurationStr } from "../domain/messages.jsx";
import { opDayKey, opDayLabel, opDayStart } from "../domain/op-day.jsx";
import { pcrAuthorOf, pcrAuthorStamp } from "../domain/pcr-author.jsx";
import { requestOutcomeKey, requestOutcomeLabel } from "../domain/second-ambulance.jsx";
import { CALL_CATEGORIES, PATIENT_ORIGINS } from "../domain/sheet-vocabulary.jsx";
import { scheduledShiftKey, shiftWindowAt } from "../domain/shift-helpers.jsx";
import { RUSH_HOURS, rushHourLabel, rushHourProfile, rushHourRanges } from "../domain/rush.jsx";
import { MONTH_NAMES, STAT_RANGES, statPeriodOptions, statRangeBase, statRangeWindow } from "../domain/stat-range.jsx";
import { filedContribution, statsLog, statsRequests } from "../domain/stat-source.jsx";
import { SHIFT_MS } from "../domain/shifts.jsx";
import { topPerformers } from "../domain/standouts.jsx";
import { callBusyMs, callEndTs, callStartTs, uhuPercent, unitCallInterval } from "../domain/uhu.jsx";
import { timeSourceNote } from "../domain/stamping.jsx";
import { CATEGORY_FILLS, SERVICE_FILLS, bravoNameFor, buildShiftHandoverRows, loadedKmFor, personUhuRows, serviceTypeFor } from "../domain/uhu-person.jsx";
import { autoFitSheet, exportSubmission } from "../export/workbook.jsx";
import { gregDateStr, gregDateTimeStr } from "../lib/dates.jsx";
import { uid } from "../lib/helpers.jsx";
import { AlertTriangle, Share2 } from "../lib/icons.jsx";
import { writeKey } from "../lib/offline-queue.jsx";
import { useEffect, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { FoldingSection, SectionBanner } from "./AdminView.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";
import { EscalationInbox } from "./Escalations.jsx";

// Every issue a crew has raised, open or closed, with what they actually said.
//
// The inbox above is a to-do list and empties as things are dealt with, which is
// right for working through them and wrong for looking back. Once an issue was
// closed the reason it was raised effectively disappeared — so the department
// had no way to see what keeps going wrong, which is the whole reason for
// collecting them.
// ---------- statistics ----------
//
// UHU per person rather than per truck. A medic works a different unit most
// weeks, so a figure attached to MEDIC 1 says nothing about anybody; attached to
// the name and ID on the seat, it is the measure the department actually reports.
//
// Two readings, because they answer different questions: the share of the shift
// spent on a call, and the number of calls completed. A crew can be busy on one
// long critical transfer or on nine short ones, and neither number alone tells
// you which.
// How far back the records reach.
//
// A month asked for from before the department started using the app is not "a
// quiet month", it is a month nothing was recorded in. Showing zeros for it
// without saying so is the kind of number somebody puts in a report.
//
// It is handed the same corpus the figures are counted over — the live board
// AND the filed shift logs — so it now describes the whole record rather than
// the working store. It used to say "earlier work is in the filed shift logs
// under Archive, not here", which stopped being true the moment the statistics
// started reading them.
export function ReachNote({ win, log, requests }) {
  const stamps = [];
  (log || []).forEach((l) => { if (l && l.ts) stamps.push(l.ts); });
  (requests || []).forEach((r) => { if (r && r.createdAt) stamps.push(r.createdAt); });
  if (!stamps.length) return null;
  const oldest = Math.min(...stamps);
  // Only about a period that has finished.
  //
  // The period running now obviously holds only what has happened so far, and
  // on a board a department has just started using that is every period — so
  // the note appeared on the current month for the first few weeks and read
  // like a warning about missing data when nothing was missing.
  if (win.end > Date.now()) return null;
  // And only when the window starts before anything the board still holds,
  // with a day's grace either way.
  if (win.start >= oldest - 86400000) return null;
  const whole = win.end <= oldest;
  return (
    <div style={styles.formHint}>
      {whole
        ? `Nothing was recorded in ${win.title} — the earliest work on this board or in the archive is ${gregDateStr(oldest)}. `
        : `The records start on ${gregDateStr(oldest)}, part-way through ${win.title}, so the figures cover that date onwards. `}
    </div>
  );
}

// Where the numbers above came from, when part of them came from the archive.
//
// The statistics used to count the live board alone, so a month that had been
// filed and tidied off the board read as a quiet month — while the same month's
// shift log downloaded as a PDF with forty calls on it. The two now count the
// same work, and this says so: a figure that grew without anything on the board
// changing is one somebody has to be able to explain to their department.
export function FiledNote({ filed }) {
  if (!filed || (filed.calls <= 0 && filed.lines <= 0)) return null;
  const bits = [];
  if (filed.calls > 0) bits.push(`${filed.calls} call${filed.calls === 1 ? "" : "s"}`);
  if (filed.lines > 0) bits.push(`${filed.lines} log line${filed.lines === 1 ? "" : "s"}`);
  return (
    <div style={styles.formHint}>
      Counted with the archive: {bits.join(" and ")} from the filed shift logs,
      which the live board no longer holds. Nothing is counted twice.
    </div>
  );
}

// Which period is being looked at, chosen.
//
// The tabs used to be the whole control, and each one meant "the one running
// now" — so an administrator asked for last month's figures and had no way to
// get them. The tab now picks the SIZE of the window and this picks WHICH one,
// which is how somebody asks the question out loud: "the month — May".
export function StatPeriodPicker({ range, setRange, now }) {
  const base = statRangeBase(range);
  const options = statPeriodOptions(range, now);
  if (!options.length) return null;
  const win = statRangeWindow(range, now);
  // The key as it will match an option: a bare "month" is this month.
  const current = options.find((o) => o.key === range)
    ? range
    : (options[0] && options[0].key) || range;
  return (
    <select
      style={{ ...styles.input, marginTop: 8 }}
      value={current}
      onChange={(e) => setRange(e.target.value)}
      aria-label={`Which ${base}`}
      title={win.title}
    >
      {options.map((o) => (
        <option key={o.key} value={o.key}>{o.label}</option>
      ))}
    </select>
  );
}

// Who was on which truck, when, and for how long — read off the sign-on and
// sign-off lines rather than the current roster, so somebody who worked Tuesday
// still counts on Friday.
// How many of the shifts somebody worked they filed a list for. A list filed on
// a shift the log has no sign-on for is not counted against a denominator that
// does not include it either — the two have to be the same set or the
// percentage means nothing.
function filedShiftsOf(p) {
  if (!p.checklistShifts) return 0;
  let n = 0;
  p.checklistShifts.forEach((sw) => {
    if (p.shifts.has(sw)) n += 1;
  });
  return n;
}

export function staffStatsFor(log, requests, units, win, now, checklistRuns) {
  const people = new Map();
  const person = (id, name) => {
    const k = (id || name || "").toUpperCase();
    if (!people.has(k)) {
      people.set(k, {
        id: id || "", name: name || "", shiftMs: 0, onCallMs: 0, calls: 0,
        units: new Set(),
        // Which shift windows they worked. A set, so a medic who changes
        // truck mid-shift is one shift, not two.
        shifts: new Set(),
      });
    }
    return people.get(k);
  };

  // Time actually worked, paired from sign-on to sign-off.
  //
  // This used to add up the *rostered* twelve hours behind each sign-on, which
  // was wrong the moment anybody moved. Somebody who ran Medic 1 for six hours
  // and then took Bravo on Medic 2 for six signed on twice, so twelve hours of
  // work was counted as twenty-four — and their UHU came out at half what it
  // should have been. The people most likely to move around are the ones
  // covering gaps, so the measure punished exactly the wrong staff.
  //
  // Pairing on to off counts the clock they were actually signed on for, once,
  // however many trucks they sat in. A seat still open at the end of the window
  // is counted up to now.
  const openSeats = new Map();
  const seatKey = (d) => `${d.accountId || d.name}::${d.unitId || ""}::${d.seat || ""}`;

  [...(log || [])]
    .filter((e) => e && e.detail && e.detail.role === "team")
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .forEach((e) => {
      const d = e.detail;
      const k = seatKey(d);
      if (d.kind === "on") {
        openSeats.set(k, { at: e.ts, d });
        if (d.unitId) person(d.accountId, d.name).units.add(d.unitName || d.unitId);
        // Only shifts inside the period being measured.
        //
        // Every sign-on in the whole log was being counted, so a month's UHU was
        // divided by every shift that person had ever worked. Signing on again
        // made the denominator larger and the percentage smaller — which is why
        // the figure looked stuck no matter how much work went into it.
        const sw = shiftWindowAt(d.shiftStart || e.ts).start;
        if (sw >= win.start && sw < win.end) {
          person(d.accountId, d.name).shifts.add(sw);
        }
      } else if (d.kind === "off") {
        const started = openSeats.get(k);
        openSeats.delete(k);
        if (!started) return;
        const from = Math.max(started.at, win.start);
        const to = Math.min(e.ts, win.end);
        if (to > from) person(d.accountId, d.name).shiftMs += to - from;
      }
    });

  // Anyone still on a seat when the window closes.
  openSeats.forEach(({ at, d }) => {
    const from = Math.max(at, win.start);
    const to = Math.min(now, win.end);
    if (to > from) person(d.accountId, d.name).shiftMs += to - from;
    if (d.unitId) person(d.accountId, d.name).units.add(d.unitName || d.unitId);
  });

  // Time on call, and calls completed, credited to whoever actually held the
  // seats while the call was running — read from the same crew index the log
  // sheet uses, so the app and the spreadsheet credit the same people.
  const crewIndex = medicCrewIndex(units, log, now);
  (requests || []).forEach((r) => {
    if (!r || !r.createdAt || r.createdAt < win.start || r.createdAt >= win.end) return;
    const busy = callBusyMs(r, now);
    const from = callStartTs(r);
    const to = callEndTs(r, now);
    const stays = (crewIndex.get(r.assignedUnitId) || []).filter((c) => {
      const w = stayWindow(c, now);
      return w.start && w.start <= (to || from) && w.end >= from;
    });
    if (!stays.length) return;
    const seen = new Set();
    stays.forEach((c) => {
      const k = (c.accountId || c.name || "").toUpperCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      const p = person(c.accountId, c.name);
      p.onCallMs += busy;
      if (r.status === "completed") p.calls += 1;
    });
  });

  // The SHIFTS each person filed a list for, credited by name — not the number
  // of lists.
  //
  // The checklist belongs to the person, once per shift: the first list of
  // their shift is the mandatory one and the one the statistics count, and a
  // second on a truck they moved onto later is offered and not required. This
  // counted every run, so somebody who changed truck mid-shift filed twice and
  // scored two out of one shift — clamped to 100%, which then paid for a shift
  // they had filed nothing on. Over a month that reads as full compliance on a
  // department that is not at full compliance, which is the worst direction for
  // this particular number to be wrong in.
  //
  // Keyed by the shift window, the same key `shifts` uses, and only counted for
  // a shift the log says they actually worked — so the figure is "of the shifts
  // you worked, how many did you check your kit on", and cannot exceed 100%
  // without the clamp doing the work.
  (checklistRuns || []).forEach((r) => {
    if (!r || !r.at || r.at < win.start || r.at >= win.end) return;
    const p = person(r.byAccountId, r.byName);
    if (!p.checklistShifts) p.checklistShifts = new Set();
    p.checklistShifts.add(shiftWindowAt(r.at).start);
  });

  return Array.from(people.values())
    .filter((p) => p.name)
    .map((p) => ({
      ...p,
      unitList: Array.from(p.units).join(", "),
      shiftsWorked: p.shifts.size,
      // Measured against the shift, not against time signed on.
      //
      // Six hours on calls in a twelve-hour shift is 50%. That is what the
      // department means by UHU and what the figure gets compared against
      // elsewhere. Dividing by time-signed-on instead flattered whoever left
      // early: run six hours of calls and sign out after eight, and you scored
      // 75% for the same work as somebody who stayed the full twelve.
      //
      // Over a month it is measured against the shifts actually worked, so
      // somebody who worked ten shifts is judged on ten, not on the calendar.
      uhu:
        p.shifts.size > 0
          ? uhuPercent(p.onCallMs, p.shifts.size * SHIFT_MS)
          : 0,
      // Checklist compliance, against the shifts they actually worked.
      //
      // One list per person per shift is the expectation, so somebody who
      // worked ten shifts and filed eight is at 80%. Measured per person rather
      // than per truck because it is a thing a person did or did not do — and
      // it is credited to whoever filed it, not to whoever was rostered.
      checklistsFiled: filedShiftsOf(p),
      checklistCompliance:
        p.shifts.size > 0 ? Math.min(100, (filedShiftsOf(p) / p.shifts.size) * 100) : 0,
    }))
    .sort((a, b) => b.uhu - a.uhu);
}

// The department's own UHU: every crew member's time on calls over every shift
// they worked, as one figure. Weighted, not an average of percentages - one
// person who worked a single shift must not count as much as somebody who
// worked twenty.
//
// Built from the staff rows rather than from the vehicles, because the target
// is a target for the department's people. Dispatchers are not in these rows
// and are not counted; their measure is still to be defined.
export function departmentUhu(staff) {
  const busy = (staff || []).reduce((n, p) => n + (p.onCallMs || 0), 0);
  const available = (staff || []).reduce((n, p) => n + (p.shiftsWorked || 0) * SHIFT_MS, 0);
  return uhuPercent(busy, available);
}

// Where the month's patients were collected from, per station.
export function originStats(requests, win) {
  const rows = new Map();
  PATIENT_ORIGINS.forEach((o) => rows.set(o, { origin: o, main: 0, ccc: 0, total: 0 }));
  let unstated = 0;
  (requests || []).forEach((r) => {
    if (!r || !r.createdAt || r.createdAt < win.start || r.createdAt >= win.end) return;
    const o = (r.patientOrigin || "").trim();
    if (!o) {
      unstated += 1;
      return;
    }
    if (!rows.has(o)) rows.set(o, { origin: o, main: 0, ccc: 0, total: 0 });
    const row = rows.get(o);
    row[stationOf(r) === "ccc" ? "ccc" : "main"] += 1;
    row.total += 1;
  });
  return { rows: Array.from(rows.values()).filter((r) => r.total > 0).sort((a, b) => b.total - a.total), unstated };
}

// What administration needs to be able to answer: how often the department had
// nothing to send, at which station, for how long, and when. Open gaps are shown
// first and loudly — those are happening now.
// The banner for a gap that is running now. Its own component because it is
// shown in two places — under each station's board at the top of the admin
// screen, and on the desk that declared it — and they must not drift apart.
export function LiveCoverageBanner({ gap }) {
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [gap && gap.id]);
  if (!gap) return null;
  return (
    <div className="breathing" style={styles.coverageOn}>
      <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 7 }} />
      NO COVERAGE — {msDurationStr(tick - gap.startedAt)}
      <span style={styles.coverageSince}>
        since {clockStr(gap.startedAt)} · declared by {gap.startedBy}
        {gap.unitsOut && gap.unitsOut.length ? ` · ${gap.unitsOut.join(", ")} out` : ""}
        {" · ends by itself when a team is back in service"}
      </span>
    </div>
  );
}

export function CoveragePanel({ coverage, units, requests }) {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(Date.now());
  // Which operational day is being read. "Every gap ever" is not a question
  // anybody asks — the question is always about a particular day, usually one
  // somebody has just been asked about.
  const [day, setDay] = useState(() => opDayKey(opDayStart(Date.now())));

  const all = (coverage || []).slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  // The days that actually have something on them, newest first.
  const days = [];
  all.forEach((c) => {
    const k = opDayKey(opDayStart(c.startedAt));
    if (!days.some((d) => d.key === k)) {
      days.push({ key: k, label: opDayLabel(opDayStart(c.startedAt)), start: opDayStart(c.startedAt) });
    }
  });
  const list = all.filter((c) => opDayKey(opDayStart(c.startedAt)) === day);
  const live = all.filter((c) => !c.endedAt);

  useEffect(() => {
    if (!live.length) return;
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live.length]);

  // Totals per station, so a month can be summarised without counting rows.
  const totals = STATIONS.map((st) => {
    const mine = list.filter((c) => c.station === st.key);
    const ms = mine.reduce((sum, c) => sum + ((c.endedAt || tick) - c.startedAt), 0);
    return { station: st, count: mine.length, ms };
  });

  return (
    <>
      {/* The count follows the day being read, not the whole history: a header
          saying "48 on record" above a list showing one day's worth reads as a
          contradiction, which is what made it look like the filter was doing
          nothing. */}
      <FoldingSection
        title="NO COVERAGE — RECORD"
        count={list.length}
        countLabel={
          live.length
            ? `on the selected day · ${live.length} running now`
            : "on the selected day"
        }
        open={open}
        onToggle={() => setOpen((v) => !v)}
      >
        {/* One day at a time. */}
        <div style={styles.archTabs}>
          <select style={{ ...styles.input, maxWidth: 260 }} value={day} onChange={(e) => setDay(e.target.value)}>
            {days.length === 0 && <option value={day}>{opDayLabel(opDayStart(Date.now()))}</option>}
            {days.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
                {d.key === opDayKey(opDayStart(Date.now())) ? " — today" : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={{ ...styles.archTabs, marginTop: 8 }}>
          {totals.map((t) => (
            <div key={t.station.key} style={styles.coverageTotal}>
              <div style={styles.coverageTotalName}>{t.station.label}</div>
              <div style={styles.coverageTotalVal}>
                {t.count} {t.count === 1 ? "period" : "periods"}
              </div>
              <div style={styles.coverageTotalMeta}>{msDurationStr(t.ms)} total</div>
            </div>
          ))}
        </div>

        <InfoNote label="What counts as no coverage?">
          Every staffed team at that station is out with a patient. Zahrawi is not counted — it runs
          its own service, and its being free does not mean the fleet can answer a call. A period is
          declared by the desk and ends by itself the moment any team is back in service.
        </InfoNote>

        {list.length === 0 ? (
          <div style={styles.emptyState}>
            No periods recorded on {days.find((d) => d.key === day)
              ? days.find((d) => d.key === day).label
              : opDayLabel(opDayStart(Date.now()))}.
          </div>
        ) : (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {list.map((c) => (
              <div key={c.id} style={c.endedAt ? styles.coverageRowPast : styles.coverageRowLive}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.coverageRowHead}>
                    {stationLabel(c.station)}
                    <span style={styles.coverageRowWhen}>{gregDateTimeStr(c.startedAt)}</span>
                  </div>
                  <div style={styles.coverageRowMeta}>
                    {c.endedAt
                      ? `${clockStr(c.startedAt)} → ${clockStr(c.endedAt)}`
                      : `${clockStr(c.startedAt)} → still running`}
                    {c.unitsOut && c.unitsOut.length ? ` · ${c.unitsOut.join(", ")} out` : ""}
                    {c.startedBy ? ` · declared by ${c.startedBy}` : ""}
                  </div>
                </div>
                <div style={c.endedAt ? styles.coverageDur : styles.coverageDurLive}>
                  {msDurationStr((c.endedAt || tick) - c.startedAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </FoldingSection>
    </>
  );
}

// Administration's side of the checklist: what is on each list, and what came
// back today. Editing here changes what crews see on their next sign-on.
export function ChecklistAdmin({ checklists, setChecklists, checklistRuns, units, addLog, user }) {
  const [open, setOpen] = useState(false);
  const [part, setPart] = useState("medic");
  const [newCat, setNewCat] = useState("");
  const [addingTo, setAddingTo] = useState(null);
  const [newItem, setNewItem] = useState("");
  // Whether the next item is one the crew tick or one they write into.
  const [newKind, setNewKind] = useState("check");
  const items = checklistItems(checklists, part);
  const cats = checklistCategories(checklists, part);
  const groups = checklistTree(checklists, part);
  const today = shiftKeyFor(Date.now());
  const partName = part === "medic" ? "medic" : "EMT";

  async function save(next) {
    const base = { ...emptyChecklists(), ...(checklists || {}) };
    const merged = {
      ...base,
      [part]: next.items ?? items,
      categories: {
        ...emptyChecklists().categories,
        ...(base.categories || {}),
        [part]: next.categories ?? cats,
      },
    };
    setChecklists(merged);
    await writeKey(CHECKLIST_KEY, merged);
  }

  async function addCategory() {
    const name = newCat.trim();
    if (!name) return;
    await save({ categories: [...cats, { id: uid("cc"), name }] });
    setNewCat("");
    await addLog(`${user.name || "Admin"} added the section "${name}" to the ${partName} checklist`, "status");
  }

  async function renameCategory(g) {
    const asked = window.prompt("Rename this section", g.name);
    if (asked === null) return;
    const name = asked.trim();
    if (!name) return;
    await save({ categories: cats.map((c) => (c.id === g.id ? { ...c, name } : c)) });
  }

  async function removeCategory(g) {
    if (
      !window.confirm(
        `Remove the section "${g.name}"?\n\nIts ${g.items.length} item` +
          `${g.items.length === 1 ? "" : "s"} are kept — they move to "Not in a section". ` +
          `Lists already filed keep their answers.`
      )
    )
      return;
    await save({ categories: cats.filter((c) => c.id !== g.id) });
  }

  async function addItem(categoryId) {
    const text = newItem.trim();
    if (!text) return;
    await save({ items: [...items, { id: uid("ci"), text, categoryId, kind: newKind }] });
    setNewItem("");
    await addLog(
      `${user.name || "Admin"} added "${text}" to the ${partName} checklist` +
        (newKind === "write" ? " (written in by the crew)" : ""),
      "status"
    );
  }

  // Changing an item's kind after the fact. Lists already filed keep whatever
  // they were given — a tick recorded last week stays a tick.
  async function toggleKind(it) {
    const to = isWriteItem(it) ? "check" : "write";
    await save({ items: items.map((x) => (x.id === it.id ? { ...x, kind: to } : x)) });
  }

  async function renameItem(it) {
    const asked = window.prompt("Reword this item", it.text);
    if (asked === null) return;
    const text = asked.trim();
    if (!text) return;
    await save({ items: items.map((x) => (x.id === it.id ? { ...x, text } : x)) });
  }

  async function removeItem(it) {
    if (!window.confirm(`Remove "${it.text}" from the list?\n\nLists already filed keep their answers.`))
      return;
    await save({ items: items.filter((x) => x.id !== it.id) });
    await addLog(`${user.name || "Admin"} removed "${it.text}" from the ${partName} checklist`, "status");
  }

  // Order within a section. Swapping neighbours inside the group has to move
  // them in the flat array, which is where the order actually lives.
  function move(g, it, dir) {
    const within = g.items;
    const i = within.findIndex((x) => x.id === it.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= within.length) return;
    const a = items.findIndex((x) => x.id === within[i].id);
    const b = items.findIndex((x) => x.id === within[j].id);
    if (a < 0 || b < 0) return;
    const next = items.slice();
    next[a] = items[b];
    next[b] = items[a];
    save({ items: next });
  }

  // What came back today, per truck — the exceptions first, because a list
  // where everything was fine needs no attention.
  const staffed = (units || []).filter(isStaffed);
  const todayRuns = CHECKLIST_PARTS.map((pt) => ({
    part: pt,
    done: staffed.map((u) => ({
      unit: u,
      run: checklistRunFor(checklistRuns, u.id, pt.key, today),
    })),
  }));

  // Counted per person, not per truck. One member of staff owes one checklist
  // for their shift; a second list, on a truck they moved onto later, is
  // optional and must not make the department look short of one. Trucks are
  // still listed below - that is where a flagged item lives - but the figure
  // at the top is the one the department is measured on.
  const onDuty = [];
  (units || []).forEach((u) => {
    ["alpha", "bravo"].forEach((slot) => {
      const member = u[slot];
      if (member && member.accountId) onDuty.push({ unit: u, slot, member });
    });
  });
  const totalExpected = onDuty.length;
  const owing = onDuty.filter(
    (p) => !checklistDoneByPerson(checklistRuns, p.member.accountId, today)
  );
  const totalDone = totalExpected - owing.length;

  return (
    <FoldingSection
      title="VEHICLE CHECKLISTS"
      count={totalExpected ? Math.round((totalDone / totalExpected) * 100) : 0}
      countLabel={`% of crew on duty · ${totalDone} of ${totalExpected}`}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {/* The names, not just the number. A percentage tells an administrator
          the department is short of three checklists; this tells them which
          three people to ask. */}
      {owing.length > 0 && (
        <div style={styles.checkOwingRow}>
          <strong style={{ color: "var(--hold)" }}>
            {owing.length} still to file:
          </strong>{" "}
          {owing
            .map((p) => `${p.member.name || p.member.accountId} (${p.unit.name})`)
            .join(" · ")}
        </div>
      )}

      <div style={styles.archTabs}>
        {CHECKLIST_PARTS.map((pt) => (
          <button
            key={pt.key}
            style={pt.key === part ? styles.archTabOn : styles.archTab}
            onClick={() => {
              setPart(pt.key);
              setAddingTo(null);
            }}
          >
            {pt.label}
            <span style={styles.archTabCount}>{checklistItems(checklists, pt.key).length}</span>
          </button>
        ))}
      </div>

      <InfoNote label="How the checklist works">
        Each list is checked once a shift, per vehicle — the medic list by whoever is in Alpha, the
        EMT list by Bravo. Build it in sections, the way the kit is actually laid out. Every item is
        answered available, not complete or not available, and the answers appear here and in the
        statistics. Changing the list changes what crews see next time they sign on; lists already
        filed keep the answers they were given.
      </InfoNote>

      {groups.length === 0 ? (
        <div style={styles.formHint}>
          Nothing on this list yet. Add a section below — “Airway”, “Drugs bag”, “Vehicle” — then
          the items in it.
        </div>
      ) : (
        <div style={styles.catGrid}>
          {groups.map((g) => (
            <div key={g.id} style={styles.catCard}>
              <div style={styles.catCardHead}>
                <span style={styles.catCardName}>{g.name}</span>
                <span style={styles.catCardCount}>{g.items.length}</span>
              </div>

              {g.items.length === 0 ? (
                <div style={styles.catCardEmpty}>Nothing in here yet.</div>
              ) : (
                g.items.map((it, idx) => (
                  <div key={it.id} style={styles.tinyRow}>
                    <button style={styles.tinyTap} onClick={() => renameItem(it)} title="Reword">
                      <span style={styles.tinyName}>{it.text}</span>
                      {isWriteItem(it) && <span style={styles.kindTag}>WRITE</span>}
                    </button>
                    <button
                      style={styles.tinyMore}
                      onClick={() => toggleKind(it)}
                      title={
                        isWriteItem(it)
                          ? "The crew write a reading into this — tap to make it a tick instead"
                          : "The crew tick this — tap to make it something they write into"
                      }
                    >
                      {isWriteItem(it) ? "✎" : "✓"}
                    </button>
                    <button
                      style={styles.tinyMore}
                      onClick={() => move(g, it, -1)}
                      disabled={idx === 0}
                    >
                      ↑
                    </button>
                    <button
                      style={styles.tinyMore}
                      onClick={() => move(g, it, 1)}
                      disabled={idx === g.items.length - 1}
                    >
                      ↓
                    </button>
                    <button style={styles.tinyMore} onClick={() => removeItem(it)} title="Remove">
                      ×
                    </button>
                  </div>
                ))
              )}

              {g.id !== UNSORTED_CHECK &&
                (addingTo === g.id ? (
                  <div style={styles.itemAddRow}>
                    <input
                      autoFocus
                      style={styles.itemAddInput}
                      placeholder="e.g. Oxygen above half"
                      value={newItem}
                      maxLength={120}
                      onChange={(e) => setNewItem(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addItem(g.id);
                        if (e.key === "Escape") setAddingTo(null);
                      }}
                    />
                    <button
                      style={styles.primaryBtnSm}
                      onClick={() => addItem(g.id)}
                      disabled={!newItem.trim()}
                    >
                      Add
                    </button>
                    <div style={styles.kindPick}>
                      {[
                        { key: "check", label: "Crew tick it" },
                        { key: "write", label: "Crew write in it" },
                      ].map((k) => (
                        <button
                          key={k.key}
                          style={newKind === k.key ? styles.kindPickOn : styles.kindPickOff}
                          onClick={() => setNewKind(k.key)}
                        >
                          {k.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={styles.catCardFoot}>
                    <button
                      style={styles.catCardAdd}
                      onClick={() => {
                        setNewItem("");
                        setAddingTo(g.id);
                      }}
                    >
                      + Item
                    </button>
                    <button style={styles.catTool} onClick={() => renameCategory(g)}>
                      Rename
                    </button>
                    <button style={styles.catTool} onClick={() => removeCategory(g)}>
                      Remove
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}

      <div style={styles.stockAdd}>
        <div style={styles.invShortHead}>ADD A SECTION</div>
        <div style={styles.stockAddRow}>
          <input
            style={styles.invNameInput}
            placeholder="Section — e.g. Airway"
            value={newCat}
            maxLength={60}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addCategory();
            }}
          />
          <button style={styles.primaryBtnSm} onClick={addCategory} disabled={!newCat.trim()}>
            Add
          </button>
        </div>
      </div>

      <SectionBanner title="TODAY" />
      {staffed.length === 0 ? (
        <div style={styles.emptyState}>No crews signed on.</div>
      ) : (
        todayRuns.map((g) => (
          <div key={g.part.key} style={{ marginTop: 8 }}>
            <div style={styles.uhuStationHead}>{g.part.label}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {g.done.map(({ unit, run }) => {
                const flags = run ? checklistFlags(run, (checklists || {})[g.part.key] || []) : [];
                return (
                  <div key={unit.id} style={styles.checkTodayRow}>
                    <span style={styles.checkTodayUnit}>
                      {unit.name}
                      <span style={styles.checkTodayStation}>{stationShort(stationOf(unit))}</span>
                    </span>
                    {run ? (
                      <span style={flags.length ? styles.checkTodayFlag : styles.checkTodayOk}>
                        {flags.length
                          ? `${flags.length} flagged — ${flags.map((f) => f.item.text).join(", ")}`
                          : "all available"}
                      </span>
                    ) : (
                      <span style={styles.checkTodayMissing}>not done</span>
                    )}
                    {run && <span style={styles.checkTodayWho}>{run.byName}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </FoldingSection>
  );
}

// A gauge. Built as one component with a slot for a caption, because more of
// these are coming and a row of indicators only reads as a row if they are the
// same size, the same arc and the same weight.
//
// Drawn as an SVG arc rather than a bar: a target of ninety per cent is a
// position on a dial, and a dial is read without arithmetic.
// `lowerIsBetter` for a measure where a big number is the warning.
//
// Every other gauge here is a compliance figure: past the mark is good. Fleet
// UHU is not — it is how much of the fleet's time is already spoken for, and a
// service running at 85% has no capacity left for the call it has not had yet.
// Painted by the same rule as the others it read bright green at 85% and red at
// 20%, which is precisely backwards on the one dial that warns about workload.
export function Gauge({ label, pct, caption, good = 90, note, lowerIsBetter, sharp, sub }) {
  const size = 132;
  const stroke = 11;
  const r = (size - stroke) / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  // Three-quarters of a circle, opening at the bottom, as a dial does.
  const start = 135;
  const sweep = 270;
  const toXY = (deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const arc = (fromDeg, toDeg) => {
    const [x1, y1] = toXY(fromDeg);
    const [x2, y2] = toXY(toDeg);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  const has = pct !== null && pct !== undefined;
  const value = has ? Math.max(0, Math.min(100, pct)) : 0;
  // `sharp` is a dial with no middle: made or not made, and nothing in
  // between. It is for a figure whose target is a floor the department either
  // reaches or does not — an amber band there invites "nearly", and the
  // department does not grade its utilisation on nearly.
  const color = !has
    ? "var(--hair-3)"
    : sharp
    ? (lowerIsBetter ? value <= good : value >= good) ? "var(--ok)" : "var(--crit)"
    : lowerIsBetter
    ? value <= good
      ? "var(--ok)"
      : value <= good + 20
      ? "var(--hold)"
      : "var(--crit)"
    : value >= good
    ? "var(--ok)"
    : value >= good - 20
    ? "var(--hold)"
    : "var(--crit)";

  return (
    <div style={styles.gaugeCard}>
      <div style={styles.gaugeLabel}>{label}</div>
      <div style={{ position: "relative", width: size, height: size, margin: "6px auto 0" }}>
        <svg width={size} height={size}>
          <path d={arc(start, start + sweep)} stroke="var(--inset-2)" strokeWidth={stroke} fill="none" strokeLinecap="round" />
          {/* Where the target sits, so the number is read against something. */}
          <path
            d={arc(start + sweep * (good / 100) - 0.6, start + sweep * (good / 100) + 0.6)}
            stroke="var(--ink-4)"
            strokeWidth={stroke + 4}
            fill="none"
          />
          {has && (
            <path
              d={arc(start, start + sweep * (value / 100))}
              stroke={color}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              style={{ transition: "all .6s cubic-bezier(.22,1,.36,1)" }}
            />
          )}
        </svg>
        <div style={styles.gaugeCentre}>
          <div style={{ ...styles.gaugeValue, color: has ? "var(--ink)" : "var(--ink-4)" }}>
            {has ? Math.round(value) : "—"}
            {has && <span style={styles.gaugePct}>%</span>}
          </div>
          {/* On the face, under the number, and only where a second figure
              answers a different question from the percentage. A percentage
              says how often ten minutes was made; the average says what a
              patient actually waits, and it is the figure people ask for. */}
          {sub && <div style={styles.gaugeSub}>{sub}</div>}
        </div>
      </div>
      {caption && <div style={styles.gaugeCaption}>{caption}</div>}
      {note && <div style={styles.gaugeNote}>{note}</div>}
    </div>
  );
}

// The indicators, at the top of the page and never folded away.
//
// A compliance figure behind a fold is a figure nobody reads. This is what an
// administrator opens the page for, so it opens with it — with its own period
// selector, because the question "how are we doing" is asked over a month or a
// quarter, not over a shift.
// The call mix, as proportions rather than a dial.
//
// A gauge answers "are we hitting a target". Call mix has no target — nobody is
// aiming for a particular share of dialysis transfers — so a gauge would look
// impressive and say nothing. What the question actually is: what do we mostly
// get called for. That is a proportion, so it is drawn as one.
// The management report.
//
// Written as a styled document and handed to the browser to print, rather than
// built with a PDF library. Three reasons: it adds no fifth file for IT to
// vendor, it is the same print CSS anybody can later adjust, and "Save as PDF"
// is a button every person in the organisation already knows.
//
// Photographs stay on the administrator's own device. A staff portrait is
// personal data and does not belong in a board that every tablet reads.
export function buildStatisticsReport({ label, win, staff, origins, resp, mix, tops, photos, station }) {
  const esc = (v) =>
    String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const award = (title, person, figure, note) => {
    const key = person ? (person.id || person.name || "").toUpperCase() : "";
    const photo = key && photos && photos[key] ? photos[key] : null;
    return `
      <div class="award">
        <div class="portrait">${
          photo
            ? `<img src="${photo}" alt="">`
            : `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="23" r="12"/><path d="M8 62c0-13 11-21 24-21s24 8 24 21z"/></svg>`
        }</div>
        <div class="award-body">
          <div class="award-title">${esc(title)}</div>
          <div class="award-name">${person ? esc(person.name) : "—"}</div>
          ${person && person.id ? `<div class="award-id">${esc(person.id)}</div>` : ""}
          <div class="award-figure">${person ? esc(figure) : "Not enough data this period"}</div>
          ${person && note ? `<div class="award-note">${esc(note)}</div>` : ""}
        </div>
      </div>`;
  };

  const totalOrigin = origins.rows.reduce((n, r) => n + r.total, 0) || 1;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${esc(APP_NAME)} — ${esc(win.title || label)}</title>
<style>
@page { size: A4; margin: 16mm 15mm; }
*{box-sizing:border-box}
body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:#16222E;font-size:10pt;line-height:1.55;margin:0}
h1{font-size:24pt;line-height:1.08;letter-spacing:-.8pt;margin:0 0 5pt;font-weight:800}
h2{font-size:12pt;margin:19pt 0 8pt;font-weight:800;color:#0A5540;border-left:3pt solid #E9C46A;padding-left:8pt;
   page-break-after:avoid;break-after:avoid}
/* A heading stranded at the foot of a page with its table overleaf is the one
   thing that makes a printed report look unfinished. Sections are kept whole
   where they fit; where a table is too long, its header row repeats on each
   page instead. */
.section h2{break-after:avoid;page-break-after:avoid}
.section>table,.section>p,.section>div{break-before:avoid;page-break-before:avoid}
.keep{break-inside:avoid;page-break-inside:avoid}
thead{display:table-header-group}
p{margin:0 0 7pt}
.eyebrow{font-size:8pt;letter-spacing:2pt;text-transform:uppercase;color:#0A5540;font-weight:800}
.lede{font-size:11pt;color:#3B4A58}
.rule{height:2pt;background:#0A5540;margin:11pt 0 15pt}
.muted{color:#5A6B7B}
.small{font-size:8.5pt}

.stats{display:table;width:100%;border-spacing:6pt 0;margin:10pt 0 4pt}
.stat{display:table-cell;width:25%;background:#F2F6F9;border-top:2.5pt solid #0A5540;padding:8pt 9pt}
.stat .n{font-size:19pt;font-weight:800;color:#0A5540;line-height:1;letter-spacing:-.5pt}
.stat .l{font-size:7.6pt;color:#5A6B7B;margin-top:3pt;line-height:1.35}

.awards{display:table;width:100%;border-spacing:7pt 0;margin-top:4pt}
.award{display:table-cell;width:33.33%;background:#FFFDF6;border:0.8pt solid #E9C46A;border-top:2.5pt solid #E9C46A;padding:10pt;vertical-align:top;page-break-inside:avoid}
.portrait{width:46pt;height:46pt;border-radius:50%;overflow:hidden;background:#EEF3F7;border:1pt solid #DCE3E9;margin-bottom:7pt}
.portrait img{width:100%;height:100%;object-fit:cover;display:block}
.portrait svg{width:100%;height:100%;fill:#C2CFDA}
.award-title{font-size:7.6pt;letter-spacing:1.2pt;text-transform:uppercase;color:#8A6D1F;font-weight:800}
.award-name{font-size:12.5pt;font-weight:800;margin-top:3pt;letter-spacing:-.3pt}
.award-id{font-size:8pt;color:#5A6B7B}
.award-figure{font-size:10.5pt;font-weight:700;color:#0A5540;margin-top:5pt}
.award-note{font-size:8.2pt;color:#5A6B7B;margin-top:2pt;line-height:1.4}

table{width:100%;border-collapse:collapse;margin:7pt 0 10pt;font-size:8.8pt}
th{text-align:left;background:#0A5540;color:#fff;padding:5pt 6pt;font-size:7.6pt;letter-spacing:.6pt;text-transform:uppercase;font-weight:800}
td{padding:4.5pt 6pt;border-bottom:0.6pt solid #DCE3E9}
tr:nth-child(even) td{background:#F5F8FA}
tr{page-break-inside:avoid}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}

.bar{height:7pt;background:#EEF3F7;border-radius:4pt;overflow:hidden;min-width:60pt}
.bar i{display:block;height:100%;background:#0A5540}
.mixbar{display:flex;height:11pt;border-radius:6pt;overflow:hidden;margin:8pt 0 10pt}
.mixbar span{display:block;height:100%}

.callout{background:#F2F6F9;border-left:3pt solid #0A5540;padding:8pt 10pt;margin:9pt 0;font-size:9pt}
.foot{margin-top:15pt;border-top:0.8pt solid #C9D4DD;padding-top:7pt;font-size:7.8pt;color:#6C7B89}
.pb{page-break-before:always}
</style></head><body>

<div class="eyebrow">Performance report</div>
<h1>${esc(APP_NAME)}</h1>
<p class="lede">${esc(win.title || label)} · ${esc(station || "All stations")}</p>
<div class="rule"></div>

<div class="stats">
  <div class="stat"><div class="n">${resp.pct === null ? "—" : Math.round(resp.pct) + "%"}</div>
    <div class="l">Emergency response within 10 minutes</div></div>
  <div class="stat"><div class="n">${mix.total}</div><div class="l">Calls in the period</div></div>
  <div class="stat"><div class="n">${staff.length}</div><div class="l">Staff with recorded duty</div></div>
  <div class="stat"><div class="n">${resp.avg === null ? "—" : msDurationStr(resp.avg)}</div>
    <div class="l">Average dispatch to arrival</div></div>
</div>

<div class="section keep"><h2>Recognition</h2>
<div class="awards">
  ${award(
    "Workload and utilisation",
    tops.workload,
    tops.workload ? `${tops.workload.calls} calls · ${tops.workload.uhu.toFixed(1)}% UHU` : "",
    "Ranked on calls completed and time on call together"
  )}
  ${award(
    "Fastest emergency response",
    tops.fastest,
    tops.fastest ? msDurationStr(tops.fastest.avg) : "",
    tops.fastest ? `Average over ${tops.fastest.total} internal emergencies` : ""
  )}
  ${award(
    "Attendance and punctuality",
    tops.punctual,
    tops.punctual ? `${tops.punctual.pct.toFixed(0)}% on time` : "",
    tops.punctual ? `${tops.punctual.on} of ${tops.punctual.total} shifts started on time` : ""
  )}
</div>

</div>
<div class="section keep"><h2>Emergency response</h2>
<p class="small muted">Measured from the moment dispatch raises an internal emergency to the moment the
crew reaches the destination. The department's standard is ten minutes.</p>
<table>
  <tr><th>Measure</th><th class="n">Result</th></tr>
  <tr><td>Calls measured</td><td class="n">${resp.total}</td></tr>
  <tr><td>Within ten minutes</td><td class="n">${resp.within}</td></tr>
  <tr><td>Compliance</td><td class="n">${resp.pct === null ? "—" : resp.pct.toFixed(1) + "%"}</td></tr>
  <tr><td>Average response</td><td class="n">${resp.avg === null ? "—" : msDurationStr(resp.avg)}</td></tr>
  ${resp.running ? `<tr><td>Still running</td><td class="n">${resp.running}</td></tr>` : ""}
  ${resp.notCounted ? `<tr><td>Closed without a response time — called off, refused, or timeline unfinished; not counted</td><td class="n">${resp.notCounted}</td></tr>` : ""}
</table>

</div>
<div class="section"><h2>What the department is called for</h2>
<div class="mixbar">
  ${mix.rows.map((r) => `<span style="width:${r.pct}%;background:${r.colour}"></span>`).join("")}
</div>
<table>
  <tr><th>Call category</th><th class="n">Calls</th><th class="n">Share</th></tr>
  ${mix.rows
    .map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${r.n}</td><td class="n">${r.pct.toFixed(1)}%</td></tr>`)
    .join("")}
</table>


</div>
<div class="section"><h2>Where patients were collected from</h2>
<table>
  <thead><tr><th>Location</th><th class="n">Main Office</th><th class="n">CCC</th><th class="n">Total</th><th class="n">Share</th></tr></thead>
  ${origins.rows
    .map(
      (r) =>
        `<tr><td>${esc(r.origin)}</td><td class="n">${r.main}</td><td class="n">${r.ccc}</td><td class="n">${r.total}</td><td class="n">${((r.total / totalOrigin) * 100).toFixed(1)}%</td></tr>`
    )
    .join("")}
</table>
${origins.unstated ? `<p class="small muted">${origins.unstated} call(s) with no location recorded.</p>` : ""}

</div>
<div class="section"><h2>By employee</h2>
<table>
  <thead><tr><th>ID</th><th>Name</th><th>Team</th><th class="n">UHU</th><th class="n">Checklist</th><th class="n">Calls</th><th class="n">Shifts</th></tr></thead>
  ${staff
    .map(
      (p) =>
        `<tr><td>${esc(p.id)}</td><td>${esc(p.name)}</td><td>${esc(p.unitList)}</td>` +
        `<td class="n">${p.uhu.toFixed(1)}%</td><td class="n">${p.checklistCompliance.toFixed(0)}%</td>` +
        `<td class="n">${p.calls}</td><td class="n">${p.shiftsWorked}</td></tr>`
    )
    .join("")}
</table>

</div>

<div class="callout keep">
  <strong>How these figures are produced.</strong> Every timestamp is recorded by the crew who ran
  the call, on the vehicle, at the moment it happened — not entered afterwards from memory. UHU is
  time on call as a share of the twelve-hour shifts worked. Checklist compliance is daily vehicle
  checks filed against shifts worked.
</div>

<div class="foot">
  ${esc(APP_NAME)} · ${ORG_STAMP}Ambulance Services · Generated ${esc(gregDateTimeStr(Date.now()))}
</div>
</body></html>`;
}

// Shared by the panel and the report, so the two cannot disagree.
export function categoryMixOf(requests, from, to) {
  const counts = new Map();
  let total = 0;
  (requests || []).forEach((r) => {
    if (!r || r.createdAt < from || r.createdAt >= to) return;
    const c = (r.callCategory || "").trim() || "Not stated";
    counts.set(c, (counts.get(c) || 0) + 1);
    total += 1;
  });
  const colourOf = (name) => {
    const f = CATEGORY_FILLS[name];
    return f ? `#${f[0].slice(2)}` : "var(--ink-4)";
  };
  const rows = Array.from(counts.entries())
    .map(([name, n]) => ({ name, n, pct: total ? (n / total) * 100 : 0, colour: colourOf(name) }))
    .sort((a, b) => b.n - a.n);
  return { rows, total };
}

// Every category the department has, with what came in against each.
//
// The list used to be built from the calls alone, so a category with no calls
// in the period was absent altogether — and absent reads as "this list is
// incomplete", not as "none of those happened". A nought is an answer: it says
// what the department was NOT called for this month, which is half of what
// somebody opens this panel to find out.
//
// Anything the board holds that the vocabulary does not — an older category, or
// "Not stated" for a call nobody coded — is kept too. The sheet's own list is
// the starting point, never the limit.
export function categoryMixRows(requests, from, to) {
  const counts = new Map();
  let total = 0;
  (requests || []).forEach((r) => {
    if (!r || r.createdAt < from || r.createdAt >= to) return;
    const c = (r.callCategory || "").trim() || "Not stated";
    counts.set(c, (counts.get(c) || 0) + 1);
    total += 1;
  });
  CALL_CATEGORIES.forEach((name) => {
    if (name && !counts.has(name)) counts.set(name, 0);
  });
  const rows = Array.from(counts.entries())
    .map(([name, n]) => ({ name, n, pct: total > 0 ? (n / total) * 100 : 0 }))
    // Busiest first, and the ones that never came up in their own order at the
    // bottom rather than scattered through it.
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return { rows, total, ran: rows.filter((r) => r.n > 0).length };
}

// ---------- rush hours ----------
//
// Which hours of the day actually run hot, over the period the page is set to.
//
// Each bar is the average number of ambulances tied up through that hour of
// day, worked out from the calls themselves — the same merged corpus as every
// figure above it, so a month that lives in the archive has a rush profile the
// day this ships. The bars are anchored at 07:00, day shift on the left and
// the night that follows it on the right, because that is how the department
// reads a day everywhere else.
//
// One hue, because this is one measure; the peak hours wear the board's busy
// amber, which already means exactly that. The value written on the peaks is
// the NUMBER OF CALLS that landed in that hour over the period — the bars are
// still weighed by how long calls held trucks, but "0.2 ambulance" meant
// nothing to anybody, and "34 calls" is a number a reader has instantly. A
// number on all twenty-four bars would be a table pretending to be a chart.
// The sentence under the chart — guarded, because a period whose calls carry
// no usable times has a total but no peak, and a peak hour can hold zero
// RAISED calls when a long call merely ran through it, and a caption that
// assumes otherwise is a blank screen waiting to happen
// (`REQ_STATUS[status].color` taught that lesson already).
function RushFoot({ p }) {
  const peakCalls = p.peaks.reduce((sum, h) => {
    const row = p.rows.find((r) => r.hour === h);
    return sum + (row ? row.raised : 0);
  }, 0);
  // The FINDING, and not a word about how the chart works.
  //
  // "Bars weigh how long calls held trucks in each hour of the day; the seam
  // after 19 is where the day shift hands to the night" was two lines of
  // instructions under a chart somebody reads every day. The busiest hour and
  // how many calls landed in it is the answer; the rest was the app explaining
  // itself.
  if (!p.peaks.length) return null;
  return (
    <div style={styles.formHint}>
      {peakCalls > 0
        ? `Busiest ${rushHourRanges(p.peaks)} — ${peakCalls} of ${p.total} call${p.total === 1 ? "" : "s"} ` +
          `landed in ${p.peaks.length === 1 ? "this hour" : "these hours"}.`
        : `Busiest ${rushHourRanges(p.peaks)}.`}
    </div>
  );
}

export function RushHours({ requests, from, to }) {
  const p = rushHourProfile(requests, from, to);
  const peakSet = new Set(p.peaks);
  // Labels every third hour, so the axis is readable at two columns wide on a
  // phone. The 19:00 cell carries the day/night seam.
  const labelled = new Set([7, 10, 13, 16, 19, 22, 1, 4]);
  return (
    <div style={styles.mixCard}>
      <div style={styles.gaugeLabel}>Rush hours</div>
      {p.total === 0 ? (
        <div style={styles.emptyState}>No calls in this period.</div>
      ) : (
        <React.Fragment>
          <div style={styles.rushChart}>
            {p.rows.map((r) => {
              const h = p.max > 0 ? Math.max(2, (r.avg / p.max) * 78) : 2;
              const peak = peakSet.has(r.hour);
              return (
                <div
                  key={r.hour}
                  style={styles.rushBarWrap}
                  title={`${r.label}–${rushHourLabel((r.hour + 1) % 24)} — ${r.raised} call${r.raised === 1 ? "" : "s"} · about ${Math.round(r.avg * 60)} min of truck time on an ordinary day`}
                >
                  {/* A peak hour can hold zero RAISED calls — a long call
                      merely ran through it — and "0" on the busiest bar reads
                      as a broken chart, so the count only prints when there is
                      one. The tooltip still tells the whole story. */}
                  {peak && r.raised > 0 && <div style={styles.rushPeakVal}>{r.raised}</div>}
                  <div style={{ ...(peak ? styles.rushBarPeak : styles.rushBar), height: h }} />
                </div>
              );
            })}
          </div>
          <div style={styles.rushAxis}>
            {p.rows.map((r) => (
              <span
                key={r.hour}
                style={{ ...styles.rushAxisCell, ...(r.hour === 19 ? styles.rushNightMark : null) }}
              >
                {labelled.has(r.hour) ? String(r.hour).padStart(2, "0") : ""}
              </span>
            ))}
          </div>
          <RushFoot p={p} />
        </React.Fragment>
      )}
    </div>
  );
}

// ---------- the service mix: CCT, ALS, BLS ----------
//
// What LEVEL of work the period's calls were, as shares of every call
// received. The level is read the way the sheet's Svc column reads it —
// `serviceTypeFor`, the category deciding — honouring an explicit priority on
// a call not yet coded (the EMERGENCY buttons set one before anybody has had
// time to code). A call with neither is "Not stated", never quietly called
// BLS: a percentage built on an assumption is a percentage nobody can defend.
function serviceOf(r) {
  const s = serviceTypeFor(r);
  if (s) return s;
  if (!(r && r.priority)) return "";
  const k = priorityKeyOf(r);
  return k === "als" ? "ALS" : k === "cct" ? "CCT" : "BLS";
}

export function serviceMixRows(requests, from, to) {
  const inWin = (requests || []).filter((r) => r && r.createdAt >= from && r.createdAt < to);
  const counts = new Map();
  inWin.forEach((r) => {
    const s = serviceOf(r) || "Not stated";
    counts.set(s, (counts.get(s) || 0) + 1);
  });
  const total = inWin.length;
  // The three the department runs, in the order it says them — always listed,
  // zeros included, like the category mix. Anything else the board holds
  // ("NA", "Not stated") is kept alongside: the list is the starting point,
  // never the limit.
  const names = ["CCT", "ALS", "BLS"];
  counts.forEach((_, name) => { if (!names.includes(name)) names.push(name); });
  const rows = names.map((name) => ({
    name,
    n: counts.get(name) || 0,
    pct: total ? ((counts.get(name) || 0) / total) * 100 : 0,
  }));
  return { rows, total };
}

const SERVICE_COLOURS = { ALS: "var(--crit)", CCT: "var(--hold)", BLS: "var(--flow)" };

export function ServiceMix({ requests, from, to }) {
  const [open, setOpen] = useState(false);
  const { rows, total } = serviceMixRows(requests, from, to);
  return (
    <FoldingSection
      title="SERVICE TYPES — CCT · ALS · BLS"
      count={total}
      countLabel={total === 1 ? "call" : "calls"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {total === 0 ? (
        <div style={styles.emptyState}>No calls in this period.</div>
      ) : (
        <>
          <div style={styles.mixBar}>
            {rows.filter((r) => r.n > 0).map((r) => (
              <span
                key={r.name}
                title={`${r.name} — ${r.n} (${r.pct.toFixed(0)}%)`}
                style={{ width: `${r.pct}%`, background: SERVICE_COLOURS[r.name] || "var(--ink-4)", display: "block", height: "100%" }}
              />
            ))}
          </div>
          <div style={styles.mixList}>
            {rows.map((r) => (
              <div key={r.name} style={styles.mixRow}>
                <span style={{ ...styles.mixDot, background: r.n > 0 ? SERVICE_COLOURS[r.name] || "var(--ink-4)" : "var(--hair-2)" }} />
                <span style={styles.mixName}>{r.name}</span>
                <span style={styles.mixPct}>{r.pct.toFixed(0)}%</span>
                <span style={styles.mixN}>{r.n}</span>
              </div>
            ))}
            <div style={styles.formHint}>
              {total} call{total === 1 ? "" : "s"} in this period.
            </div>
          </div>
        </>
      )}
    </FoldingSection>
  );
}

export function CategoryMix({ requests, from, to }) {
  const [open, setOpen] = useState(false);
  const { rows, total, ran } = categoryMixRows(requests, from, to);

  const colourOf = (name) => {
    const f = CATEGORY_FILLS[name];
    return f ? `#${f[0].slice(2)}` : "var(--ink-4)";
  };

  return (
    <FoldingSection
      title="WHAT WE ARE CALLED FOR"
      count={total}
      countLabel={`calls · ${ran} of ${rows.length} categories`}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {total === 0 ? (
        <div style={styles.emptyState}>No calls in this period.</div>
      ) : (
        <>
          {/* One bar, in proportion. Reading a share is what eyes are good at
              and what a column of numbers is bad at. */}
          <div style={styles.mixBar}>
            {rows.map((r) => (
              <span
                key={r.name}
                title={`${r.name} — ${r.n} (${r.pct.toFixed(0)}%)`}
                style={{ width: `${r.pct}%`, background: colourOf(r.name), display: "block", height: "100%" }}
              />
            ))}
          </div>
          {/* Every category, not the top eight.
              The rest were "and 2 more categories" — a line that names the
              number of things it is hiding and then hides them, on the one
              panel whose whole job is to say what the department is called
              for. The tail is where the unusual work is, which is the part
              somebody is reading this to find. The bar above is already in
              proportion, so a long list costs a few short rows and nothing
              else. */}
          <div style={styles.mixList}>
            {rows.filter((r) => r.n > 0).map((r) => (
              <div key={r.name} style={styles.mixRow}>
                <span style={{ ...styles.mixDot, background: colourOf(r.name) }} />
                <span style={styles.mixName}>{r.name}</span>
                <span style={styles.mixPct}>{r.pct.toFixed(0)}%</span>
                <span style={styles.mixN}>{r.n}</span>
              </div>
            ))}
            {/* Still every category — but a category at nought needs one short
                chip, not a full row of columns. Eighteen zero-rows were most
                of this panel's height, one under the other, on the page the
                user called crowded; a wrapped cloud says the same "we were not
                called for these" in four lines. */}
            {rows.some((r) => r.n === 0) && (
              <div style={styles.mixNoughtWrap}>
                {rows.filter((r) => r.n === 0).map((r) => (
                  <span key={r.name} style={styles.mixNoughtChip}>{r.name} · 0</span>
                ))}
              </div>
            )}
            <div style={styles.formHint}>
              {total} call{total === 1 ? "" : "s"} in this period, across {ran} of{" "}
              {rows.length} categor{rows.length === 1 ? "y" : "ies"}.
            </div>
          </div>
        </>
      )}
    </FoldingSection>
  );
}

// The department's utilisation, as opposed to one person's.
//
// Total time trucks were tied up on calls, against the time those trucks were
// there to be tied up. A unit assisting on somebody else's call counts for the
// stretch it was out, exactly as it does on the per-person sheet, because the
// truck was working either way.
export function fleetUhu(requests, units, from, to) {
  const list = units || [];
  if (!list.length) return null;
  const end = Math.min(to, Date.now());
  if (end <= from) return null;
  let busy = 0;
  (requests || []).forEach((r) => {
    if (!r || !r.createdAt || r.createdAt < from || r.createdAt >= to) return;
    list.forEach((u) => {
      const iv = unitCallInterval(r, u.id, end);
      if (!iv) return;
      busy += Math.max(0, Math.min(iv.end, end) - Math.max(iv.start, from));
    });
  });
  const capacity = list.length * (end - from);
  return capacity > 0 ? uhuPercent(busy, capacity) : null;
}

// Every closed call should carry the name of whoever wrote its patient care
// report. Recent calls cannot close without one; older ones could, which is
// exactly what this figure is for — it says how much of the record is
// attributable, and it should climb towards 100 and stay there.
// NOT report completion. This counts calls carrying the name of whoever said
// they would write the patient care report. There is no report in this app yet,
// so nothing here can measure one — and the figure is labelled for what it
// really is rather than for what it would be nice to have.
export function pcrCompliance(requests, from, to) {
  // A call stood down before the crew reached anybody has no patient and no
  // report, so it cannot be a miss — counted, it dragged the figure down for
  // every call the desk called off. A refusal stays in: the crew assessed
  // somebody, and that is written up.
  const closed = (requests || []).filter(
    (r) => r && r.status === "completed" && r.createdAt >= from && r.createdAt < to && !stoodDownBeforeArrival(r)
  );
  const named = closed.filter((r) => pcrAuthorOf(r));
  return {
    pct: closed.length ? (named.length / closed.length) * 100 : null,
    named: named.length,
    total: closed.length,
  };
}

// What the response figure could not measure, and why.
//
// "Still open" means literally open on the board — the only part of this
// number anybody has to act on. Every CLOSED call with no response time is one
// exclusion, whatever it closed for: called off, refused, timeline unfinished,
// or closed before the reason box existed. Said as ten separate "still open"
// calls it read as a backlog of live emergencies, and most of them had been
// closed for weeks.
export function responseNote(resp) {
  if (!resp) return null;
  const bits = [];
  if (resp.running > 0) bits.push(`${resp.running} still running`);
  if (resp.notCounted > 0) bits.push(`${resp.notCounted} closed without a response time, not counted`);
  return bits.length ? bits.join(" · ") : null;
}

export function IndicatorBand({ requests: liveRequests, units, log: liveLog, checklistRuns, submissions, archives, range, setRange }) {
  const now = Date.now();
  const win = statRangeWindow(range, now);
  // The live board is not the record — see `domain/stat-source.jsx`. Every
  // figure on this band is counted over the board plus the filed shift logs,
  // deduplicated by record id, or a month older than four shifts reads as a
  // quiet month while its own PDF lists forty calls.
  const requests = statsRequests(liveRequests, submissions, win, archives);
  const log = statsLog(liveLog, submissions, win, archives);
  const filed = filedContribution({ requests: liveRequests, log: liveLog, submissions, win, archives });
  const resp = responseCompliance(requests, win.start, win.end);
  const uhu = fleetUhu(requests, units, win.start, win.end);
  const pcr = pcrCompliance(requests, win.start, win.end);
  // Checklist compliance department-wide is the same sum the per-person figures
  // are built from — lists filed against shifts actually worked — so the band
  // and the per-person table can never disagree.
  const people = staffStatsFor(log, requests, units, win, now, checklistRuns);
  // The department's UHU comes from those same people. The fleet figure sits
  // beside it as context: a wide gap between the two is trucks standing with
  // nobody in them.
  const staff = people;
  const deptUhu = departmentUhu(people);
  const shiftsWorked = people.reduce((n, p) => n + (p.shiftsWorked || 0), 0);
  const listsFiled = people.reduce((n, p) => n + (p.checklistsFiled || 0), 0);
  const checklistPct = shiftsWorked > 0 ? Math.min(100, (listsFiled / shiftsWorked) * 100) : null;

  return (
    <div style={styles.bandWrap}>
      <div style={styles.bandHead}>
        <span style={styles.bandTitle}>PERFORMANCE</span>
        <div style={styles.bandPeriods}>
          {/* All five sizes, shift included — the KPIs are read per shift as
              much as per month, and the picker below chooses WHICH one. */}
          {STAT_RANGES.map((r) => (
            <button
              key={r.key}
              style={r.key === statRangeBase(range) ? styles.bandPeriodOn : styles.bandPeriod}
              onClick={() => setRange(r.key)}
            >
              {r.label.replace("This ", "")}
            </button>
          ))}
        </div>
      </div>

      {/* Which month, which quarter, which year. The band is the first thing on
          the page, so the choice made here is the one the panels below inherit. */}
      <StatPeriodPicker range={range} setRange={setRange} now={now} />
      <ReachNote win={win} log={log} requests={requests} />
      <FiledNote filed={filed} />

      {/* The four the department is actually judged on, side by side. They are
          read together — a response figure that looks good while utilisation is
          at 60% means the trucks are flat out, and that is the sentence the row
          is here to let somebody read in one look. */}
      <div style={styles.gaugeRow}>
        <Gauge
          label="Emergency response"
          pct={resp.pct}
          good={RESPONSE_GOOD}
          // The average belongs on the FACE of this one, under the percentage.
          // They answer different questions — how often ten minutes was made,
          // and what a patient actually waits — and this is the one dial where
          // the second number is asked for as often as the first.
          sub={resp.total && resp.avg !== null ? shortDurationStr(resp.avg) : null}
          // Nothing under this one either. Every dial on the band is now its
          // number and nothing else — the counts and the exclusions moved to
          // the band's foot, which is one sentence for the whole row instead
          // of four captions nobody read.
        />
        <Gauge
          label="Department UHU"
          // Measured across the people, which is what the department set its
          // target against — not across the vehicles, which was counting hours
          // a truck sat on the forecourt with nobody in it.
          pct={deptUhu}
          // The department's own target: 45%, and it is a FLOOR. Under it is
          // red, at or over it is green, and there is no amber — the
          // department does not grade its utilisation on nearly.
          //
          // This used to read the other way (`lowerIsBetter`, darkening ABOVE
          // the target on the argument that a service past its target has no
          // slack left). That is a real reading of the number and it is not
          // the department's: 45% is what the crews are asked to reach, so a
          // fleet sitting at 1% must not be painted green for it.
          good={UHU_TARGET}
          sharp
        />
        {/* Was labelled "PCR compliance", and was not.
            It counted calls where somebody had tapped a name into the PCR
            author field — which says who agreed to write the report, not
            whether a report exists. A figure that looks like a compliance
            measure and is not one is worse than a blank space, because it gets
            reported upward. It says what it actually counts until the patient
            care report itself exists, at which point this becomes a real
            measure of a real thing. */}
        <Gauge
          label="PCR author named"
          pct={pcr.pct}
          good={PCR_GOOD}
        />
        <Gauge
          label="Checklist compliance"
          pct={checklistPct}
          good={CHECKLIST_GOOD}
        />
      </div>

      <RushHours requests={requests} from={win.start} to={win.end} />

      <CategoryMix requests={requests} from={win.start} to={win.end} />
      {/* The level of the work, beside what the work was for. */}
      <ServiceMix requests={requests} from={win.start} to={win.end} />

      {/* The one sentence the band still owes a reader.
          The dials carry no words now, and a 100% measured over thirteen of
          thirty-nine calls has to say so SOMEWHERE — a percentage with an
          unstated denominator is the thing that gets reported upward and turns
          out to have meant something else. So the counts and the exclusions
          land here, once, under the whole row, rather than as a caption on
          each dial. */}
      {resp.total > 0 && (
        <div style={styles.bandFoot}>
          Response: <strong>{resp.within} of {resp.total}</strong> within 10 minutes, average{" "}
          <strong>{msDurationStr(resp.avg)}</strong> · internal emergencies only.
          {responseNote(resp) ? ` ${responseNote(resp)}.` : ""}
        </div>
      )}
    </div>
  );
}

export function Statistics({ log: liveLog, requests: liveRequests, units, checklistRuns, submissions, archives, range, setRange }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("uhu");
  const [search, setSearch] = useState("");
  const now = Date.now();
  const win = statRangeWindow(range, now);
  // Same corpus as the band above, for the same reason: the two must never be
  // able to disagree, and neither may under-count a period the archive holds.
  const requests = statsRequests(liveRequests, submissions, win, archives);
  const log = statsLog(liveLog, submissions, win, archives);
  const resp = responseCompliance(requests, win.start, win.end);
  const allStaff = staffStatsFor(log, requests, units, win, now, checklistRuns);
  const mix = categoryMixOf(requests, win.start, win.end);
  const tops = topPerformers({ staff: allStaff, requests, units, log, win, now });

  // Portraits, for this report only.
  //
  // They were being kept on the device, so the next report reused whoever had
  // been photographed last — including for a month they had nothing to do with.
  // A portrait now belongs to the report it is attached for and is gone once it
  // is printed, which is also the safer answer for a staff photograph.
  const [photos, setPhotos] = useState({});

  async function attachPhoto(key, file) {
    if (!file) return;
    // Scaled down before it is stored: a phone photograph is several megabytes
    // and the report prints it at the size of a stamp.
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const size = 240;
          const c = document.createElement("canvas");
          c.width = size;
          c.height = size;
          const ctx = c.getContext("2d");
          const side = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
          resolve(c.toDataURL("image/jpeg", 0.82));
        };
        img.onerror = () => resolve(null);
        img.src = reader.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
    if (!dataUrl) return;
    setPhotos((prev) => ({ ...prev, [key]: dataUrl }));
  }

  // Handed to the browser to print. "Save as PDF" sits in every print dialogue,
  // so this needs no library and nothing more for IT to vendor.
  function downloadReport() {
    const html = buildStatisticsReport({
      label: win.label,
      win,
      staff: allStaff,
      origins,
      resp,
      mix,
      tops,
      photos,
      station: null,
    });
    const w = window.open("", "_blank");
    if (!w) {
      window.alert("Allow pop-ups for this site to produce the report.");
      return;
    }
    w.document.write(html);
    w.document.close();
    // A moment for the portraits to decode, or they print as empty circles.
    setTimeout(() => {
      w.focus();
      w.print();
      // Cleared once it is printed. The next report asks again, so a portrait
      // never turns up on a month it was not chosen for.
      setPhotos({});
    }, 400);
  }
  // Searching by name or ID. On a department this size the list runs past a
  // screenful within a week, and the question is usually about one person.
  const q = (search || "").trim().toLowerCase();
  const staff = q
    ? allStaff.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(q) || (p.id || "").toLowerCase().includes(q)
      )
    : allStaff;
  const origins = originStats(requests, win);
  const inWindow = (requests || []).filter((r) => r && r.createdAt >= win.start && r.createdAt < win.end);

  // The period's figures, as the department reads them: one row per employee
  // with the three measures side by side, then where the month's patients came
  // from. Marked with the period chosen, so a downloaded file is never mistaken
  // for a different month.
  function download() {
    const wb = XLSX.utils.book_new();
    const label = win.label;

    const staffRows = allStaff.map((p) => ({
      "EMPLOYEE ID": p.id,
      "FULL NAME": p.name,
      "MEDIC TEAM": p.unitList,
      "UHU %": Number(p.uhu.toFixed(1)),
      "CHECKLIST COMPLIANCE %": Number(p.checklistCompliance.toFixed(0)),
      "CALLS COMPLETED": p.calls,
      "SHIFTS WORKED": p.shiftsWorked,
      "TOTAL SHIFT (MIN)": Math.round(p.shiftMs / 60000),
      "PATIENT CARE TIME (MIN)": Math.round(p.onCallMs / 60000),
      "CHECKLISTS FILED": p.checklistsFiled,
    }));
    XLSX.utils.book_append_sheet(
      wb,
      autoFitSheet(
        XLSX.utils.aoa_to_sheet([
          [`STAFF PERFORMANCE — ${label.toUpperCase()}`],
          [`${win.label} · generated ${gregDateTimeStr(Date.now())}`],
          [],
          ...(staffRows.length
            ? [Object.keys(staffRows[0]), ...staffRows.map((r) => Object.values(r))]
            : [["No signed-on time recorded in this period."]]),
        ]),
        3
      ),
      "STAFF PERFORMANCE"
    );

    const originRows = origins.rows.map((r) => ({
      "PATIENT INITIAL LOCATION": r.origin,
      "MAIN OFFICE": r.main,
      CCC: r.ccc,
      TOTAL: r.total,
      "% OF CALLS": origins.rows.length
        ? Number(((r.total / origins.rows.reduce((n, x) => n + x.total, 0)) * 100).toFixed(1))
        : 0,
    }));
    XLSX.utils.book_append_sheet(
      wb,
      autoFitSheet(
        XLSX.utils.aoa_to_sheet([
          [`PATIENT INITIAL LOCATION — ${label.toUpperCase()}`],
          [`${win.label} · generated ${gregDateTimeStr(Date.now())}`],
          [],
          ...(originRows.length
            ? [Object.keys(originRows[0]), ...originRows.map((r) => Object.values(r))]
            : [["Nothing recorded against a location."]]),
          [],
          ...(origins.unstated
            ? [[`${origins.unstated} call(s) with no location recorded.`]]
            : []),
        ]),
        3
      ),
      "PATIENT LOCATION"
    );

    // The compliance figure the indicators show, so the file and the screen
    // cannot disagree.
    const resp = responseCompliance(requests, win.start, win.end);
    XLSX.utils.book_append_sheet(
      wb,
      autoFitSheet(
        XLSX.utils.aoa_to_sheet([
          [`EMERGENCY RESPONSE — ${label.toUpperCase()}`],
          [],
          ["Standard", "Dispatch to arrival at destination within 10 minutes"],
          ["Applies to", "EMERGENCY (INTERNAL) only"],
          ["Measured calls", resp.total],
          ["Within 10 minutes", resp.within],
          ["Compliance %", resp.pct === null ? "—" : Number(resp.pct.toFixed(1))],
          ["Average response", resp.avg === null ? "—" : msDurationStr(resp.avg)],
          ["Still running", resp.running],
          // Not a measurement the department owes: the call closed without a
          // response time — called off, refused, or the timeline was never
          // finished — so there is no response time to have, and never will be.
          ["Closed without a response time — not counted", resp.notCounted],
        ]),
        1
      ),
      "EMERGENCY RESPONSE"
    );

    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${APP_SLUG}-statistics-${String(range).replace(/:/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <FoldingSection
      title="STATISTICS"
      count={staff.length}
      countLabel="staff with recorded time"
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div style={styles.archTabs}>
        {STAT_RANGES.map((r) => (
          <button
            key={r.key}
            style={r.key === statRangeBase(range) ? styles.archTabOn : styles.archTab}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <StatPeriodPicker range={range} setRange={setRange} now={now} />
      <div style={{ ...styles.archTabs, marginTop: 8 }}>
        <button style={mode === "uhu" ? styles.archTabOn : styles.archTab} onClick={() => setMode("uhu")}>
          UHU — share of shift on a call
        </button>
        <button style={mode === "calls" ? styles.archTabOn : styles.archTab} onClick={() => setMode("calls")}>
          Calls completed
        </button>
        <button style={mode === "check" ? styles.archTabOn : styles.archTab} onClick={() => setMode("check")}>
          Checklist compliance
        </button>
      </div>

      <SectionBanner title="BY EMPLOYEE" />

      <input
        style={{ ...styles.input, marginTop: 10 }}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or ID"
      />

      <div style={styles.savedNote}>
        {inWindow.length} call{inWindow.length === 1 ? "" : "s"} raised {win.label}.
        {q && ` Showing ${staff.length} of ${allStaff.length} staff.`}
      </div>
      <InfoNote label="How this is counted">
        Per person, by name and ID, not per truck — a medic works a different unit most weeks, so a
        figure attached to a truck says nothing about anybody. UHU is time on calls measured against
        the shift: six hours on calls in a twelve-hour shift is 50%.
      </InfoNote>

      {staff.length === 0 ? (
        <div style={styles.emptyState}>No signed-on time recorded in this period.</div>
      ) : (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {staff.map((p) => (
            <div key={(p.id || p.name)} style={styles.statRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.statName}>
                  {p.name} {p.id && <span style={styles.statId}>{p.id}</span>}
                </div>
                {/* The trucks and the shifts worked, and nothing else.
                    The two minute counts — time on call and time signed on —
                    are the numerator and the denominator of the percentage
                    already printed beside them, in a unit nobody thinks in:
                    "235 min signed on" is a twelve-hour shift said the hard
                    way. The percentage is the answer; these were the working. */}
                <div style={styles.statMeta}>
                  {p.unitList || "—"} · {p.shiftsWorked}{" "}
                  {p.shiftsWorked === 1 ? "shift" : "shifts"}
                </div>
              </div>
              {mode === "uhu" ? (
                <div style={{ minWidth: 116 }}>
                  <div style={styles.statBarTrack}>
                    <div style={{ ...styles.statBarFill, width: `${Math.max(2, p.uhu)}%` }} />
                  </div>
                  <div style={styles.statValue}>{p.uhu.toFixed(1)}%</div>
                </div>
              ) : mode === "check" ? (
                <div style={{ minWidth: 116 }}>
                  <div style={styles.statBarTrack}>
                    <div
                      style={{
                        ...styles.statBarFill,
                        width: `${Math.max(2, p.checklistCompliance)}%`,
                        background:
                          p.checklistCompliance >= 80
                            ? "linear-gradient(90deg,#30D158,#2FBF82)"
                            : "linear-gradient(90deg,#FF9F0A,#FF7A86)",
                      }}
                    />
                  </div>
                  <div style={styles.statValue}>
                    {p.checklistCompliance.toFixed(0)}% · {p.checklistsFiled}/{p.shiftsWorked}
                  </div>
                </div>
              ) : (
                <div style={styles.statCalls}>{p.calls}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <SectionBanner title={`PATIENT INITIAL LOCATION — ${win.label.toUpperCase()}`} />
      {origins.rows.length === 0 ? (
        <div style={styles.emptyState}>Nothing recorded against a location yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ ...styles.statOriginRow, color: "var(--ink-4)", fontWeight: 700 }}>
            <span style={{ flex: 1 }}>LOCATION</span>
            <span style={styles.statOriginNum}>MAIN</span>
            <span style={styles.statOriginNum}>CCC</span>
            <span style={styles.statOriginNum}>TOTAL</span>
          </div>
          {origins.rows.map((r) => (
            <div key={r.origin} style={styles.statOriginRow}>
              <span style={{ flex: 1, minWidth: 0 }}>{r.origin}</span>
              <span style={styles.statOriginNum}>{r.main}</span>
              <span style={styles.statOriginNum}>{r.ccc}</span>
              <span style={{ ...styles.statOriginNum, fontWeight: 800 }}>{r.total}</span>
            </div>
          ))}
          {origins.unstated > 0 && (
            <div style={styles.formHint}>
              {origins.unstated} call{origins.unstated === 1 ? "" : "s"} with no location recorded.
            </div>
          )}
        </div>
      )}

      {/* Two audiences, two files. The spreadsheet is for working with; the
          report is for showing. */}
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button style={styles.primaryBtnSm} onClick={downloadReport}>
          📄 Management report (PDF)
        </button>
        <button style={styles.ghostBtnSm} onClick={download}>
          <Share2 size={12} /> Excel
        </button>
      </div>

      {/* Portraits for the recognition page. Held on this device only — a staff
          photograph is personal data and does not belong in a board every
          tablet reads. */}
      <InfoNote label="Add photographs to the report">
        The report has a recognition page with three portraits. Attach a photograph for anybody who
        appears there and it is used for this report only — nothing is kept afterwards, and nothing
        is written to the shared board. Without one, a plain figure is printed instead.
      </InfoNote>
      <div style={styles.photoRow}>
        {[tops.workload, tops.fastest, tops.punctual]
          .filter(Boolean)
          .filter((p, i, a) => a.findIndex((x) => (x.id || x.name) === (p.id || p.name)) === i)
          .map((p) => {
            const key = (p.id || p.name || "").toUpperCase();
            return (
              <label key={key} style={styles.photoChip}>
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => attachPhoto(key, e.target.files && e.target.files[0])}
                />
                {photos[key] ? (
                  <img src={photos[key]} alt="" style={styles.photoThumb} />
                ) : (
                  <span style={styles.photoBlank}>+</span>
                )}
                {p.name}
              </label>
            );
          })}
      </div>
    </FoldingSection>
  );
}

export function IssuesRaised({ requests, viewer, units, saveRequests, addLog, only }) {
  const [open, setOpen] = useState(false);
  // Two things are being asked of this section and they are different
  // questions: "what still needs me" and "what has this department been
  // dealing with". Split, because a list that mixes them answers neither.
  // When the section is pinned to one kind — open on the board, resolved in the
  // archive — the tabs are not offered, because there is nothing to choose.
  const [tab, setTab] = useState(only || "active");

  const rows = escalatedCalls(requests, viewer);
  const all = [];
  rows.forEach((row) => {
    (row.escalations || []).forEach((e) => all.push({ e, req: row.req }));
  });
  all.sort((a, b) => (b.e.raisedAt || 0) - (a.e.raisedAt || 0));
  const openCount = all.filter((x) => escalationIsOpen(x.e)).length;
  const resolvedCount = all.length - openCount;
  const shown = all.filter((x) =>
    tab === "active" ? escalationIsOpen(x.e) : !escalationIsOpen(x.e)
  );

  return (
    <FoldingSection
      title={only === "resolved" ? "ISSUES — RESOLVED" : "ISSUES RAISED BY CREWS"}
      count={only ? shown.length : all.length}
      countLabel={
        only === "resolved"
          ? "resolved"
          : openCount
            ? `💡 ${openCount} waiting on a reply`
            : "nothing outstanding"
      }
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {!only && (
        <div style={styles.archTabs}>
          <button
            style={tab === "active" ? styles.archTabOn : styles.archTab}
            onClick={() => setTab("active")}
          >
            Active
            <span style={styles.archTabCount}>{openCount}</span>
          </button>
          <button
            style={tab === "resolved" ? styles.archTabOn : styles.archTab}
            onClick={() => setTab("resolved")}
          >
            Resolved
            <span style={styles.archTabCount}>{resolvedCount}</span>
          </button>
        </div>
      )}

      <InfoNote label="What is kept here?">
        Every issue a crew has raised, open or resolved, with what they actually said. The inbox
        above empties as issues are dealt with — this does not, so the department can see what keeps
        going wrong. Only the crew member who raised an issue can read the reply to it; none of this
        is on the dispatch log or the shared spreadsheet.
      </InfoNote>

      {/* What is actually waiting on the administrator, with the controls to
          answer it. Only on Active, because a resolved issue needs no reply. */}
      {tab === "active" && units && (
        <EscalationInbox
          requests={requests}
          units={units}
          viewer={viewer}
          saveRequests={saveRequests}
          addLog={addLog}
          embedded
        />
      )}

      {/* The inbox above already says "Nothing waiting" on Active, so this only
          speaks when it has something different to say. */}
      {shown.length === 0 ? (
        tab === "active" ? null : (
          <div style={styles.emptyState}>Nothing resolved yet</div>
        )
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shown.slice(0, 60).map(({ e, req }) => (
            <div key={e.id} style={styles.issueRow}>
              <div style={styles.issueHead}>
                {/* No status badge on the row: the tab above already says which
                    of the two this is, and repeating it on every line is noise. */}
                <span style={styles.issueWho}>
                  {e.unitName || "Crew"}
                  {e.raisedByName ? ` · ${e.raisedByName}` : ""}
                </span>
                <span style={styles.issueWhen}>{gregDateTimeStr(e.raisedAt)}</span>
              </div>
              {/* The reason, kept whether the issue is open or long since
                  closed. This is the part that used to vanish. */}
              <div style={styles.issueText}>{e.message}</div>
              <div style={styles.issueCall}>
                on {req.nature} · {callRoute(req)} · {stationLabel(stationOf(req))}
              </div>
              {(e.replies || []).length > 0 && (
                <div style={styles.issueReply}>
                  Reply: {e.replies[e.replies.length - 1].message}
                </div>
              )}
            </div>
          ))}
          {shown.length > 60 && (
            <div style={styles.formHint}>Showing the 60 most recent of {shown.length}.</div>
          )}
        </div>
      )}
    </FoldingSection>
  );
}

// A submitted shift, as a document.
//
// The spreadsheet is for working with; this is for showing. Same house style as
// the performance report, because a manager receiving both should not have to
// work out that they came from the same department.
// A submitted shift, as a document — the whole workbook, not a summary.
//
// The first attempt put twenty-eight columns on one landscape page and made the
// type too small to read. Columns do not have to fit side by side: the calls are
// split into what the call was and when it happened, keyed by the same number,
// and every other sheet of the workbook follows as its own section. Long tables
// simply run on to the next page with their headings repeated.
export function buildShiftReport({ sub, requests, coverage }) {
  // Blank means "not applicable" on most of these columns, and the spreadsheet
  // now says so. The two files should not disagree about the same cell.
  const esc = (v) => {
    const raw = v === null || v === undefined ? "" : String(v);
    const text = raw.trim() === "" ? "NA" : raw;
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };

  const byId = new Map((requests || []).filter((r) => r && r.id).map((r) => [r.id, r]));
  const calls = (sub.requests || [])
    .map((snap) => byId.get(snap.id) || snap)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const units = sub.units || [];
  const unitOf = (r) => units.find((u) => u.id === r.assignedUnitId) || {};
  const t = (r) => r.times || {};
  // One class attribute per cell.
  //
  // The night marker was being appended as a second `class="night"` on tags
  // that already carried `class="c"`, and a duplicate attribute is ignored — so
  // every centred cell on a night row kept its alignment and silently lost its
  // shading. The classes are composed together now.
  const isNight = (r) => scheduledShiftKey(r.createdAt) === "night";
  const cellClass = (r, extra) => {
    const parts = [];
    if (extra) parts.push(extra);
    if (isNight(r)) parts.push("night");
    return parts.length ? ` class="${parts.join(" ")}"` : "";
  };

  // "Completed" used to be every closed call — which counted a call the desk
  // stood down as completed, on a sheet whose own rows called it CANCELLED.
  // The outcomes are named the way the REQUEST STATUS column names them.
  const transferred = calls.filter((r) => requestOutcomeKey(r) === "transferred").length;
  const calledOff = calls.filter((r) => ["cancelled", "notTransported"].includes(requestOutcomeKey(r))).length;
  const emergencies = calls.filter((r) => isInternalEmergency(r));
  const measured = emergencies.filter((r) => responseMsFor(r) !== null);
  const within = measured.filter((r) => responseMsFor(r) <= RESPONSE_TARGET_MS).length;
  const gaps = submissionGaps(sub, coverage);
  // A gap still running at the end of the shift is measured to the end of the
  // shift, not to its own start. Measured the old way it contributed nothing,
  // so a station that ran out of ambulances and stayed out until changeover
  // reported no time without coverage at all — the worst case reading as the
  // best one.
  const gapEnd = sub.windowEnd || sub.finalisedAt || sub.submittedAt || Date.now();
  // A gap that outlived the shift is only this shift's problem up to
  // changeover; the rest of it belongs to the shift that inherited it.
  const gapMs = gaps.reduce(
    (n, c) => n + Math.max(0, Math.min(c.endedAt || gapEnd, gapEnd) - c.startedAt),
    0
  );
  // No sentence spelling the periods out. The figure in the corner — how long
  // in total, over how many periods — is the whole answer the report needs to
  // give, and a paragraph of red under it read as an accusation rather than as
  // a number.

  // UHU by person. One row each, whatever they sat in — see personUhuRows.
  const crewIndex = medicCrewIndex(units, sub.log || [], sub.finalisedAt || sub.submittedAt);
  const uhuRows = personUhuRows(
    units,
    crewIndex,
    calls,
    sub.windowEnd || sub.submittedAt,
    sub.windowStart,
    sub.windowEnd || sub.submittedAt
  );

  const handover = buildShiftHandoverRows(sub.log || []);
  const bookings = sub.scheduled || [];
  const refusals = calls.filter((r) => r.refusal);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Dispatch log — ${esc(sub.dayLabel)} ${esc(sub.shiftLabel)}</title>
<style>
/* A3 landscape. The calls table is 17 columns of real content and would not
   fit A4 without type too small to read; on A3 it sits at a comfortable size,
   and any printer scales it down to A4 on its own if that is what is loaded. */
@page{size:A3 landscape;margin:10mm 9mm 11mm 9mm}
*{box-sizing:border-box}
body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:#16222E;font-size:8.5pt;line-height:1.45;margin:0}
h1{font-size:19pt;margin:0 0 3pt;font-weight:800;letter-spacing:-.6pt}
h2{font-size:11pt;margin:15pt 0 6pt;font-weight:800;color:#0A5540;border-left:3pt solid #E9C46A;
   padding-left:7pt;page-break-after:avoid;break-after:avoid}
h2 .sub{font-weight:600;color:#5A6B7B;font-size:8.5pt;letter-spacing:0}
.eyebrow{font-size:7.5pt;letter-spacing:2pt;text-transform:uppercase;color:#0A5540;font-weight:800}
.lede{font-size:10pt;color:#3B4A58;margin:0}
.rule{height:2pt;background:#0A5540;margin:9pt 0 12pt}
.stats{display:table;width:100%;border-spacing:5pt 0;margin-bottom:4pt}
.stat{display:table-cell;background:#F2F6F9;border-top:2.2pt solid #0A5540;padding:6pt 8pt}
.stat .n{font-size:16pt;font-weight:800;color:#0A5540;line-height:1}
.stat .l{font-size:7pt;color:#5A6B7B;margin-top:2pt;line-height:1.3}

/* Readable first. A long table runs on to the next page and repeats its
   headings; it does not shrink until nobody can read it. */
table{width:100%;border-collapse:collapse;margin:5pt 0 10pt;font-size:7.6pt}
th{background:#0A5540;color:#fff;padding:4.5pt 5pt;font-size:6.8pt;letter-spacing:.4pt;
   text-transform:uppercase;font-weight:800;text-align:left;border:0.5pt solid #063A2C}
td{padding:4pt 5pt;border:0.5pt solid #C9D4DD;vertical-align:top}
thead{display:table-header-group}
tr{page-break-inside:avoid}
tr:nth-child(even) td{background:#F7FAFB}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
td.c,th.c{text-align:center}
td.night{background:#E9E9E9 !important}
td.cat{font-weight:700;text-align:center;font-size:7pt}
td.ot{background:#FFE08A !important;color:#7A4E00;font-weight:700;text-align:center}
.gap td{background:#F8DADA !important;color:#7F0000;font-weight:700}
/* The same light yellow the spreadsheet shades a stood-down call with
   (FFF2CC / 7F6000). Red on these documents already means no coverage and must
   not also mean cancelled. */
.cancelled td{background:#FFF2CC !important;color:#7F6000 !important}
.foot{margin-top:12pt;border-top:0.7pt solid #C9D4DD;padding-top:6pt;font-size:7pt;color:#6C7B89}
.keep{break-inside:avoid;page-break-inside:avoid}
.none{font-size:8pt;color:#5A6B7B;font-style:italic;margin:4pt 0 10pt}
/* The call is named once and read twice: the nature in full, the route beneath
   it in a quieter grey. Both tables carry it, so neither has to be read with a
   finger on the other. */
.dim{color:#5A6B7B;font-size:6.9pt}
</style></head><body>

<div class="eyebrow">Dispatch log</div>
<h1>${esc(sub.dayLabel)} — ${esc(sub.shiftLabel)}</h1>
<p class="lede">${esc(stationLabel(sub.station))} · submitted ${esc(gregDateTimeStr(sub.submittedAt))}${
    sub.submittedBy ? ` by ${esc(sub.submittedBy)}` : ""
  }${sub.status === "open" ? " · still completing" : ""}</p>
<div class="rule"></div>

<div class="stats">
  <div class="stat"><div class="n">${calls.length}</div><div class="l">Calls</div></div>
  <div class="stat"><div class="n">${transferred}</div><div class="l">Transferred</div></div>
  <div class="stat"><div class="n">${calledOff}</div><div class="l">Cancelled / no transport</div></div>
  <div class="stat"><div class="n">${emergencies.length}</div><div class="l">Internal emergencies</div></div>
  <div class="stat"><div class="n">${measured.length ? Math.round((within / measured.length) * 100) + "%" : "—"}</div>
    <div class="l">Within 10 minutes</div></div>
  <div class="stat"><div class="n">${gapMs > 0 ? msDurationStr(gapMs) : "None"}</div>
    <div class="l">Time with no coverage${
      gaps.length ? ` · ${gaps.length} period${gaps.length === 1 ? "" : "s"}` : ""
    }</div></div>
</div>

<h2>Calls</h2>
<table>
  <thead><tr>
    <th class="c" style="width:2.2%">#</th>
    <th style="width:8%">Patient coming from</th>
    <!-- The same columns as the spreadsheet, in the same order, under the same
         captions. The two documents describe one shift and a reader should not
         have to work out which column of one is which of the other.
         An HTML comment, not a JSX one: this is a template literal, and a
         {/* … */} inside it is printed on the page as text. -->
    <th style="width:8.5%">From</th>
    <th style="width:8.5%">To</th>
    <th style="width:5%">MRN</th>
    <th class="c" style="width:4%">Disp.</th>
    <th class="c" style="width:4%">En route</th>
    <th class="c" style="width:4%">Scene</th>
    <th class="c" style="width:4%">Depart</th>
    <th class="c" style="width:4%">Arrived</th>
    <th class="c" style="width:4%">In svc</th>
    <th class="c" style="width:4.4%">Resp.</th>
    <th style="width:6%">Team</th>
    <th class="c" style="width:3.6%">Svc</th>
    <th class="c" style="width:3%">Km</th>
    <th style="width:7%">Call category</th>
    <th style="width:6.8%">E-PCR author</th>
    <th style="width:6.8%">Bravo</th>
    <th style="width:6.5%">Request status</th>
  </tr></thead>
  <tbody>
  ${calls
    .map((r, i) => {
      const cls = cellClass(r);
      const u = unitOf(r);
      // Same colours as the spreadsheet, from the same tables — the two files
      // should not teach a reader two sets of meanings for one column.
      const paint = (table, key) => {
        const f = table[String(key || "").trim().toUpperCase()] || table[String(key || "").trim()];
        return f ? ` style="background:#${f[0].slice(2)};color:#${f[1].slice(2)}"` : "";
      };
      // A stood-down row is yellow from edge to edge, and its cells carry NO
      // colour of their own. The row rule overrode the category cell's red
      // fill but not its white text (an inline colour beats a class), so
      // "EMERGENCY (INTERNAL)" printed white on light yellow — unreadable.
      const stoodDown = requestOutcomeKey(r) === "cancelled";
      const fill = stoodDown ? null : CATEGORY_FILLS[(r.callCategory || "").trim()];
      const catStyle = fill ? ` style="background:#${fill[0].slice(2)};color:#${fill[1].slice(2)}"` : "";
      const svcStyle = stoodDown ? "" : paint(SERVICE_FILLS, serviceTypeFor(r));
      // Cancelled reads as cancelled on both documents, in the same colour.
      // The board has no "cancelled" STATUS — a call the desk stands down is
      // closed like any other and the only record of it is the close reason —
      // so this asks `requestOutcomeKey`, which reads that reason, exactly as
      // the REQUEST STATUS column of the spreadsheet does. Asking `r.status`
      // instead answered COMPLETED for a call that was called off.
      const offRow = stoodDown ? ` class="cancelled"` : "";
      return `<tr${offRow}>
        <td class="c">${i + 1}</td>
        <td${cls}>${esc(r.patientOrigin || "")}</td>
        <td${cls}>${esc(callFrom(r))}</td>
        <td${cls}>${esc(callTo(r))}</td>
        <td${cls}>${esc(r.mrn || "")}</td>
        <td${cellClass(r, "c")}>${esc(clockStr(r.createdAt))}</td>
        <td${cellClass(r, "c")}>${esc(clockStr(t(r).enroute))}</td>
        <td${cellClass(r, "c")}>${esc(clockStr(t(r).arrival))}</td>
        <td${cellClass(r, "c")}>${esc(clockStr(t(r).departure))}</td>
        <td${cellClass(r, "c")}>${esc(clockStr(t(r).arrivalDestination))}</td>
        <td${cellClass(r, "c")}>${esc(clockStr(t(r).backInService))}</td>
        <td${cellClass(r, "c")}><strong>${esc(durationStr(r.createdAt, t(r).arrivalDestination))}</strong></td>
        <td${cls}>${esc(u.name || "")}</td>
        <td class="cat"${svcStyle}>${esc(serviceTypeFor(r))}</td>
        <td${cellClass(r, "c")}>${esc(loadedKmFor(r))}</td>
        <td class="cat"${catStyle}>${esc(r.callCategory || "")}</td>
        <td${cls}>${esc(pcrAuthorStamp(r, u))}</td>
        <td${cls}>${esc(bravoNameFor(r, u))}</td>
        <td${cls}>${esc(requestOutcomeLabel(r))}${timeSourceNote(r) ? `<br><small>${esc(timeSourceNote(r))}</small>` : ""}</td>
      </tr>`;
    })
    .join("")}
  </tbody>
</table>

<h2>UHU <span class="sub">— each person's own time on call, as a share of their shift</span></h2>
${
    uhuRows.length === 0
      ? `<p class="none">No crew signed on during this shift.</p>`
      : `<table>
  <thead><tr>
    <th style="width:30%">Name</th>
    <th style="width:16%">Employee ID</th><th class="c" style="width:12%">Signed on</th>
    <th class="c" style="width:12%">Signed off</th><th class="c" style="width:13%">Overtime</th>
    <th class="n" style="width:8%">Calls</th><th class="n" style="width:9%">UHU %</th>
  </tr></thead>
  <tbody>
  ${uhuRows
    .map(
      (r) =>
        `<tr><td>${esc(r.name)}</td><td>${esc(r.id)}</td>` +
        `<td class="c">${esc(r.on)}</td><td class="c">${esc(r.off)}</td>` +
        `<td class="${r.ot ? "ot" : "c"}">${esc(r.ot)}</td>` +
        `<td class="n">${esc(r.calls)}</td><td class="n">${esc(r.uhu)}%</td></tr>`
    )
    .join("")}
  </tbody>
</table>`
  }

<div class="foot">
  ${esc(APP_NAME)} · ${ORG_STAMP}Ambulance Services · Shaded rows are night-shift calls ·
  Amber marks overtime · Printed ${esc(gregDateTimeStr(Date.now()))}
</div>
</body></html>`;
}

export function SavedLogs({ submissions, requests, coverage }) {
  const [station, setStation] = useState(STATIONS[0].key);
  const [busy, setBusy] = useState(null);
  // Folded by default. Within a month this is sixty submissions, and it is
  // reference rather than something an administrator is watching.
  const [open, setOpen] = useState(false);
  // Somebody asking about a log is always asking about a particular day —
  // usually one they have just been telephoned about — so "which day" is the
  // question the panel answers first.
  const [dateFilter, setDateFilter] = useState("");

  const mine = (submissions || [])
    .filter((x) => x && x.station === station)
    .filter((x) => !dateFilter || x.dayKey === dateFilter)
    .sort((a, b) => (b.windowStart || 0) - (a.windowStart || 0));

  // Only dates that actually have a submission, newest first — no empty days to
  // page through.
  const availableDays = [];
  (submissions || [])
    .filter((x) => x && x.station === station)
    .sort((a, b) => (b.windowStart || 0) - (a.windowStart || 0))
    .forEach((x) => {
      if (!availableDays.some((d) => d.key === x.dayKey)) {
        availableDays.push({ key: x.dayKey, label: x.dayLabel });
      }
    });

  // Grouped by the operational day, so the day shift and the night that
  // followed it sit together under one date the way the department thinks
  // about them.
  const days = [];
  mine.forEach((sub) => {
    const found = days.find((d) => d.key === sub.dayKey);
    if (found) found.subs.push(sub);
    else days.push({ key: sub.dayKey, label: sub.dayLabel, dayStart: sub.dayStart, subs: [sub] });
  });

  function printShift(sub) {
    const html = buildShiftReport({ sub, requests, coverage });
    const w = window.open("", "_blank");
    if (!w) {
      window.alert("Allow pop-ups for this site to produce the report.");
      return;
    }
    w.document.write(html);
    w.document.close();
    setTimeout(() => {
      w.focus();
      w.print();
    }, 300);
  }

  async function download(sub) {
    setBusy(sub.id);
    try {
      await exportSubmission(sub, requests, coverage);
    } finally {
      setBusy(null);
    }
  }

  const openCount = (submissions || []).filter((x) => x && x.status === "open").length;

  return (
    <FoldingSection
      title="LOG SHEET ARCHIVE"
      count={(submissions || []).length}
      countLabel={openCount ? `submitted · ${openCount} completing` : "submitted"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >

      {/* Each station keeps its own archive, because each station submits its
          own shifts. */}
      <div style={styles.archTabs}>
        {STATIONS.map((st) => {
          const n = (submissions || []).filter((x) => x && x.station === st.key).length;
          const on = st.key === station;
          return (
            <button
              key={st.key}
              style={on ? styles.archTabOn : styles.archTab}
              onClick={() => setStation(st.key)}
            >
              {st.label}
              <span style={styles.archTabCount}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Jump to a date, or clear it to see them all. */}
      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          style={{ ...styles.input, maxWidth: 250 }}
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
        >
          <option value="">All dates ({availableDays.length})</option>
          {availableDays.map((d) => (
            <option key={d.key} value={d.key}>{d.label}</option>
          ))}
        </select>
        {dateFilter && (
          <button style={styles.ghostBtnSm} onClick={() => setDateFilter("")}>Clear</button>
        )}
      </div>

      <InfoNote label="How this works">
        Each desk submits its own shift. A day holds the day shift and the night that follows it.
        A shift submitted with a call still running is filed straight away and completes itself
        once that call closes and its crew signs out, so the overtime is counted.
      </InfoNote>

      {days.length === 0 ? (
        <div style={styles.emptyState}>
          Nothing submitted for {stationLabel(station)} yet.
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
          {days.map((d) => (
            <div key={d.key}>
              <div style={styles.archDay}>{d.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {d.subs.map((sub) => (
                  <div key={sub.id} style={styles.savedRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.savedDay}>
                        {sub.shiftLabel}
                        {sub.status === "open" && (
                          <span style={styles.archOpenTag}>completing…</span>
                        )}
                      </div>
                      <div style={styles.savedMeta}>
                        {sub.callCount} {sub.callCount === 1 ? "call" : "calls"} · submitted{" "}
                        {gregDateTimeStr(sub.submittedAt)}
                        {sub.submittedBy ? ` by ${sub.submittedBy}` : ""}
                        {sub.status === "open" && sub.openRequestIds && sub.openRequestIds.length
                          ? ` · waiting on ${sub.openRequestIds.length} call${
                              sub.openRequestIds.length === 1 ? "" : "s"
                            } to close`
                          : ""}
                        {sub.finalisedAt ? ` · completed ${gregDateTimeStr(sub.finalisedAt)}` : ""}
                      </div>
                    </div>
                    {/* Two audiences again: the spreadsheet to work with, the
                        report to hand to somebody. */}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button style={styles.ghostBtnSm} onClick={() => printShift(sub)}>
                        📄 PDF
                      </button>
                      <button
                        style={styles.primaryBtnSm}
                        disabled={busy === sub.id}
                        onClick={() => download(sub)}
                      >
                        {busy === sub.id ? "…" : "Excel"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </FoldingSection>
  );
}