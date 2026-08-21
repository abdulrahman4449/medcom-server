import { opDayKey, opDayStart } from "./op-day.jsx";
import { shiftWindowAt } from "./shift-helpers.jsx";

// ---------- the daily vehicle checklist ----------
//
// Two lists, because two people check two different things: the medic goes
// through the clinical kit, the EMT goes through the vehicle. They are checked
// once a day, per truck, by whoever is in that seat — and the answer to each
// item is one of three, not a tick. "Not complete" is the one that matters:
// a tick box forces a half-restocked bag to be called either fine or broken,
// and crews will always pick fine.
//
// The items themselves are set by administration rather than written into the
// code, because the kit changes and nobody should need a new build for it.
export const CHECKLIST_KEY = "ems:checklists";
export const CHECKLIST_RUNS_KEY = "ems:checklistRuns";
export const CHECKLIST_RUNS_CAP = 2000;

export const CHECKLIST_PARTS = [
  { key: "medic", label: "Medic checklist", seat: "alpha", who: "Medic (Alpha)" },
  { key: "emt", label: "EMT checklist", seat: "bravo", who: "EMT (Bravo)" },
];

export const CHECK_ANSWERS = [
  { key: "available", label: "Available", short: "Available", color: "var(--ok)" },
  { key: "unavailable", label: "Not available", short: "Missing", color: "var(--crit)" },
  { key: "incomplete", label: "Not complete", short: "Partial", color: "var(--hold)" },
];

export function checklistPartForSeat(seat) {
  return CHECKLIST_PARTS.find((p) => p.seat === seat) || CHECKLIST_PARTS[0];
}

export function emptyChecklists() {
  return { medic: [], emt: [], categories: { medic: [], emt: [] } };
}

// The lists have sections, the way the inventory does — "Airway", "Drugs bag",
// "Vehicle" — because a flat run of thirty items is a scroll a crew stops
// reading about a third of the way down, which is the opposite of what a
// checklist is for.
//
// The items stay a flat array under `checklists[part]`, exactly as before, with
// a `categoryId` on each. Everything that already reads the list — the filed
// runs, the flags, the statistics — keeps working untouched, and an item from
// before sections existed simply has no categoryId and collects in a holding
// section at the end.
export const UNSORTED_CHECK = "__unsorted";

export function checklistItems(checklists, part) {
  const list = (checklists && checklists[part]) || [];
  return Array.isArray(list) ? list.filter((x) => x && x.id) : [];
}

export function checklistCategories(checklists, part) {
  const cats = (checklists && checklists.categories && checklists.categories[part]) || [];
  return Array.isArray(cats) ? cats.filter((c) => c && c.id && c.name) : [];
}

export function checklistTree(checklists, part) {
  const cats = checklistCategories(checklists, part);
  const items = checklistItems(checklists, part);
  const known = new Set(cats.map((c) => c.id));
  const groups = cats.map((c) => ({
    id: c.id,
    name: c.name,
    items: items.filter((it) => it.categoryId === c.id),
  }));
  const loose = items.filter((it) => !it.categoryId || !known.has(it.categoryId));
  if (loose.length) groups.push({ id: UNSORTED_CHECK, name: "Not in a section", items: loose });
  return groups;
}

// One run per truck, per list, per operational day. A crew coming on at 19:00
// does not repeat the morning's check of the same vehicle — it is a daily check
// of a vehicle, not a per-shift ritual.
// A key for one shift on one vehicle. The check was filed per operational day,
// so a medic who worked the day shift and came back for the night found the
// truck already checked — by themselves, twelve hours earlier, on a vehicle
// that had been out all afternoon since. A vehicle check belongs to the crew
// taking the vehicle, so it is asked once per shift.
export function shiftKeyFor(ts) {
  const w = shiftWindowAt(ts);
  return `${opDayKey(opDayStart(w.start))}::${w.key}`;
}

export function checklistRunFor(runs, unitId, part, shiftKey) {
  return (runs || []).find(
    (r) => r && r.unitId === unitId && r.part === part && (r.shiftKey || r.dayKey) === shiftKey
  ) || null;
}

// The checklist belongs to the person, once per shift - not to the truck.
//
// A medic works one shift and owes one checklist for it. Keying it to the
// vehicle meant somebody who moved trucks mid-shift was asked all over again,
// while a truck that changed crew was counted as done because the last lot had
// already filed. Neither is what the department measures: it measures whether
// each member of staff on duty checked their kit.
//
// So: the first list of a person's shift is the mandatory one, and it is the
// one the statistics count. If they then sign onto another medic, that truck's
// list is offered but not required - they have already done theirs.
export function personChecklistRun(runs, accountId, shiftKey) {
  if (!accountId) return null;
  return (runs || []).find(
    (r) => r && r.byAccountId === accountId && (r.shiftKey || r.dayKey) === shiftKey
  ) || null;
}

// Has this person already discharged the obligation for this shift?
export function checklistDoneByPerson(runs, accountId, shiftKey) {
  return !!personChecklistRun(runs, accountId, shiftKey);
}

// Whether the list in front of this crew member is the one they must file.
// Mandatory until they have filed one somewhere this shift; optional after,
// including the one on a truck they have only just moved onto.
export function checklistIsMandatory(runs, accountId, shiftKey, unitId, part) {
  const mine = personChecklistRun(runs, accountId, shiftKey);
  if (!mine) return true;
  // The one they already filed is still "the" mandatory list, so opening it
  // again on the same truck does not suddenly read as optional.
  return mine.unitId === unitId && mine.part === part;
}

// Anything a crew flagged. This is the reason the whole thing exists: a list
// where everything was fine tells nobody anything, and the exceptions are what
// somebody has to act on.
export function checklistFlags(run, items) {
  if (!run) return [];
  return (items || [])
    .filter(
      (it) =>
        !isWriteItem(it) &&
        run.answers &&
        run.answers[it.id] &&
        run.answers[it.id] !== "available"
    )
    .map((it) => ({ item: it, answer: run.answers[it.id] }));
}

// Two kinds of line on a list.
//
// Most are a check: available, not complete, not available. Some are a reading
// the department wants written down rather than judged — a cylinder pressure, a
// mileage, the seal number on a drugs bag. Answering those with a tick loses the
// only thing about them worth having.
//
// A written line is never a flag. "180 bar" is not a fault, and putting it
// through the flag path would report every truck as having something wrong with
// it every morning.
export function isWriteItem(it) {
  return !!(it && it.kind === "write");
}

export function checklistReadings(run, items) {
  if (!run) return [];
  return (items || [])
    .filter((it) => isWriteItem(it) && run.answers && String(run.answers[it.id] || "").trim())
    .map((it) => ({ item: it, value: String(run.answers[it.id]).trim() }));
}

// Answered means something different for each kind, and the file button waits
// on all of them either way.
export function checkItemAnswered(it, answers) {
  const v = answers && answers[it.id];
  return isWriteItem(it) ? String(v || "").trim().length > 0 : !!v;
}