import { isAssistingUnit } from "./second-ambulance.jsx";
import { ADDED_SERVICES, CALL_CATEGORIES, CALL_TYPES, EMERGENCY_CODES, LOADED_KM, PATIENT_ORIGINS } from "./sheet-vocabulary.jsx";
import { uid } from "../lib/helpers.jsx";
import { readKey } from "../lib/offline-queue.jsx";

// ---------- constants ----------

export const STATUS = {
  available: { label: "AVAILABLE", color: "var(--ok)" },
  dispatched: { label: "DISPATCHED", color: "var(--hold)" },
  enroute: { label: "EN ROUTE", color: "var(--flow)" },
  onscene: { label: "ON SCENE", color: "var(--crit)" },
  transporting: { label: "TRANSPORTING", color: "#8B5CF6" },
  oos: { label: "OUT OF SERVICE", color: "#64748B" },
};

// What the call needs, not how it feels.
//
// Critical / urgent / routine described a desk's impression; the crew and the
// sheet both want the level of care, which is the thing that decides which
// truck and which crew. An emergency, internal or external, is an ALS run.
export const SERVICE_LEVELS = {
  als: { label: "ALS", color: "var(--crit)", desc: "Advanced life support" },
  bls: { label: "BLS", color: "var(--flow)", desc: "Basic life support" },
  cct: { label: "CCT", color: "var(--hold)", desc: "Critical care transfer" },
};

// The level of care a call needs, which is what a desk is actually choosing.
//
// Critical / urgent / routine described how a call felt to whoever took it;
// ALS / BLS / CCT describes what the patient needs, and that is the thing that
// decides which truck and which crew. It is also the vocabulary already used on
// the sheet, in the e-PCR and on the radio, so nobody has to translate.
//
// Boards written before this change hold the old words. They are kept here so
// those calls still render, and mapped to the nearest level: a critical call
// was an ALS run, a routine one was BLS.
export const PRIORITY = {
  als: { label: "ALS", color: "var(--crit)", desc: "Advanced life support" },
  cct: { label: "CCT", color: "var(--hold)", desc: "Critical care transfer" },
  bls: { label: "BLS", color: "var(--flow)", desc: "Basic life support" },
  // Retired, kept readable.
  critical: { label: "ALS", color: "var(--crit)", legacy: true },
  urgent: { label: "CCT", color: "var(--hold)", legacy: true },
  routine: { label: "BLS", color: "var(--flow)", legacy: true },
};

// The three a desk may choose. The retired words never appear in a picker.
export const PRIORITY_CHOICES = ["als", "cct", "bls"];

// The level of care follows the category of call.
//
// They were two fields saying one thing, and a desk that set one and forgot the
// other left the board and the sheet disagreeing about the same call. The
// category is what goes on the log and into the e-PCR, so it decides: A is
// advanced life support, C is critical care, everything else is basic.
//
// Where no category is set yet an explicit level is honoured, because the
// EMERGENCY buttons set one at the moment a call is raised — before anybody has
// had time to code it.
export function priorityKeyOf(req) {
  const cat = (req && req.callType) || "";
  if (cat === "A") return "als";
  if (cat === "C") return "cct";
  if (cat === "B" || cat === "D" || cat === "E") return "bls";

  const k = (req && req.priority) || "bls";
  if (k === "critical") return "als";
  if (k === "urgent") return "cct";
  if (k === "routine") return "bls";
  return PRIORITY[k] ? k : "bls";
}

export const REQUIREMENTS = [
  { key: "vent", label: "Vent" },
  { key: "infusion", label: "Infusion Pump" },
  { key: "suction", label: "Portable Suction" },
  { key: "oxygen", label: "Oxygen" },
  { key: "other", label: "Other" },
];

// "Other" is a free-text requirement: the tick puts it on the call, the text
// says what it actually is. Everywhere requirements are shown or exported we
// want the typed text rather than the bare word "Other", so the labels are
// built in one place instead of five.
export function reqLabels(req) {
  const keys = (req && req.requirements) || [];
  return keys.map((k) => {
    const meta = REQUIREMENTS.find((r) => r.key === k);
    const label = meta ? meta.label : k;
    if (k === "other") {
      const txt = (req && req.reqOther ? String(req.reqOther) : "").trim();
      return txt ? `Other: ${txt}` : label;
    }
    return label;
  });
}

// The details on a call that can be corrected after it has gone out. Dispatch
// often has to raise a call on what it is told down a phone, so the MRN can be
// missing and a ward or a nature can be wrong. The desk can correct these
// itself; a crew who finds the call is wrong at the bedside can only *propose*
// the correction, and it stays proposed until the desk verifies it. Every
// change carries the name of who made it and when.
// Everything on a call that can still be put right afterwards.
//
// A call does not stop being wrong when it goes back in service. The category is
// argued over at the destination, the kilometres are read off the truck when it
// parks, and the MRN turns up on a wristband nobody could reach earlier. Making
// the record final at "back in service" only meant the sheet kept the version
// that happened to be typed while the ambulance was moving.
//
// The rule does not change with the call closing: the desk's own corrections
// land straight away, a crew's are proposed and wait for the desk. What changes
// is that the closed call is still open to being corrected at all.
//
// Fields with a list are edited against that list, so a correction cannot put a
// word in the column that the sheet has no place for.
export const EDITABLE_FIELDS = [
  { key: "locationFrom", label: "From" },
  { key: "locationTo", label: "To" },
  { key: "nature", label: "Nature of call" },
  { key: "mrn", label: "Patient MRN" },
  { key: "patientOrigin", label: "Where the patient came from", options: () => PATIENT_ORIGINS },
  { key: "callCategory", label: "Call category", options: () => CALL_CATEGORIES },
  { key: "emergencyCode", label: "Codes and emergencies", options: () => EMERGENCY_CODES },
  {
    key: "callType",
    label: "Cat. of call",
    options: () => CALL_TYPES.map((t) => t.key),
    display: (v) => {
      const t = CALL_TYPES.find((x) => x.key === v);
      return t ? `${t.key} — ${t.name}` : v;
    },
  },
  {
    key: "loadedKm",
    label: "Kilometre band",
    options: () => LOADED_KM.map((b) => b.key),
    display: (v) => {
      const b = LOADED_KM.find((x) => x.key === v);
      return b ? `${b.key} — ${b.name}` : v;
    },
  },
  { key: "addedService", label: "Added service", options: () => ADDED_SERVICES },
];

export function editFieldLabel(key) {
  const f = EDITABLE_FIELDS.find((x) => x.key === key);
  return f ? f.label : key;
}

// A blank value should read as blank rather than as the word "undefined" —
// a missing MRN is the ordinary case, not an error.
export function editValueText(v, field) {
  const t = (v === null || v === undefined ? "" : String(v)).trim();
  if (!t) return "—";
  const f = field ? EDITABLE_FIELDS.find((x) => x.key === field) : null;
  return f && f.display ? f.display(t) : t;
}

export function callEdits(req) {
  return (req && Array.isArray(req.edits) ? req.edits : []);
}

export function pendingCallEdits(req) {
  return callEdits(req).filter((e) => e.status === "pending");
}

// Every call anywhere in the system that still has a correction waiting on the
// desk. A crew can report a wrong MRN and be back in service two minutes later,
// which takes the call off the active board — the report has to keep surfacing
// somewhere or the correction is lost with it.
export function callsAwaitingEditVerify(requests) {
  return (requests || [])
    .filter((r) => pendingCallEdits(r).length > 0)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function pendingCallEditCount(requests) {
  return (requests || []).reduce((n, r) => n + pendingCallEdits(r).length, 0);
}

// Can this viewer report a correction on this call? The same rule escalations
// use: the crew who ran it, or a crew who assisted on it. It deliberately does
// not care whether the call is still open — a crew who only realises the MRN
// was wrong after they are back in service still needs a way to say so.
export function canProposeEditOn(req, viewer) {
  if (!req || !viewer || viewer.role !== "team" || !viewer.unitId) return false;
  return req.assignedUnitId === viewer.unitId || isAssistingUnit(req, viewer.unitId);
}

// The three ways a correction can move, written once and shared, so a call
// corrected from the history list behaves exactly like one corrected while it
// is still running.
export async function applyCallEditsTo({ req, changes, note, who, requests, saveRequests, addLog }) {
  if (!req || !changes || !changes.length) return false;
  const now = Date.now();
  const entries = changes.map((c) => ({
    id: uid("edit"),
    field: c.field,
    from: c.from,
    to: c.to,
    by: who || "Dispatch",
    byRole: "dispatcher",
    at: now,
    note: note || "",
    status: "applied",
    verifiedBy: who || "Dispatch",
    verifiedAt: now,
  }));
  const fresh = await readKey("ems:requests", requests);
  const next = fresh.map((r) => {
    if (r.id !== req.id) return r;
    const patched = { ...r, edits: [...callEdits(r), ...entries] };
    changes.forEach((c) => {
      patched[c.field] = c.to;
    });
    if (changes.some((c) => c.field === "locationFrom")) patched.location = patched.locationFrom;
    return patched;
  });
  await saveRequests(next);
  await addLog(
    `DISPATCH (${who || "Dispatch"}) changed call information — ` +
      entries.map((e) => `${editFieldLabel(e.field)}: ${editValueText(e.from, e.field)} → ${editValueText(e.to, e.field)}`).join("; ") +
      ` — ${req.nature}` +
      (note ? ` (${note})` : ""),
    "status"
  );
  return true;
}

export async function proposeCallEditsTo({ req, changes, note, viewer, requests, saveRequests, addLog }) {
  if (!req || !changes || !changes.length || !viewer) return false;
  const now = Date.now();
  const who = viewer.name || viewer.unitName || "Crew";
  const entries = changes.map((c) => ({
    id: uid("edit"),
    field: c.field,
    from: c.from,
    to: c.to,
    by: who,
    byRole: "crew",
    unitId: viewer.unitId || null,
    unitName: viewer.unitName || "",
    at: now,
    note: note || "",
    status: "pending",
    // Whether the call had already closed when this was reported, so the desk
    // can see at a glance that it is tidying a record rather than fixing a
    // call that is still running.
    afterClose: req.status === "completed",
  }));
  const fresh = await readKey("ems:requests", requests);
  const next = fresh.map((r) =>
    r.id === req.id ? { ...r, edits: [...callEdits(r), ...entries] } : r
  );
  await saveRequests(next);
  await addLog(
    `${viewer.unitName || "CREW"} (${who}) changed call information — ` +
      entries.map((e) => `${editFieldLabel(e.field)}: ${editValueText(e.from, e.field)} → ${editValueText(e.to, e.field)}`).join("; ") +
      ` — ${req.nature} (waiting for dispatch to confirm)`,
    "status"
  );
  return true;
}

export async function verifyCallEditOn({ req, entry, accept, who, requests, saveRequests, addLog }) {
  if (!req || !entry) return false;
  const now = Date.now();
  const byWhom = who || "Dispatch";
  const fresh = await readKey("ems:requests", requests);
  const next = fresh.map((r) => {
    if (r.id !== req.id) return r;
    const patched = {
      ...r,
      edits: callEdits(r).map((e) =>
        e.id === entry.id
          ? { ...e, status: accept ? "applied" : "rejected", verifiedBy: byWhom, verifiedAt: now }
          : e
      ),
    };
    if (accept) {
      patched[entry.field] = entry.to;
      if (entry.field === "locationFrom") patched.location = entry.to;
    }
    return patched;
  });
  await saveRequests(next);
  await addLog(
    `${entry.unitName || "CREW"} (${entry.by}) changed call information ` +
      `(${accept ? "confirmed" : "turned down"} by ${byWhom}) — ` +
      `${editFieldLabel(entry.field)}: ${editValueText(entry.from, entry.field)} → ${editValueText(entry.to, entry.field)}` +
      ` — ${req.nature}`,
    "status"
  );
  return true;
}

export const REQ_STATUS = {
  pending: { label: "PENDING", color: "var(--hold)" },
  assigned: { label: "ASSIGNED", color: "var(--flow)" },
  enroute: { label: "EN ROUTE", color: "var(--flow)" },
  onscene: { label: "ON SCENE", color: "var(--crit)" },
  transporting: { label: "TRANSPORTING", color: "var(--move)" },
  arrived: { label: "ARRIVED AT DESTINATION", color: "var(--land)" },
  completed: { label: "COMPLETED", color: "var(--ink-4)" },
};

// Ordered crew timeline: each step's action button, the time field it stamps,
// the request status it moves to, and the unit status that follows.
export const TIME_STEPS = [
  { from: "assigned", to: "enroute", timeKey: "enroute", unitStatus: "enroute", buttonLabel: "En Route", timeLabel: "En Route" },
  { from: "enroute", to: "onscene", timeKey: "arrival", unitStatus: "onscene", buttonLabel: "Arrival at Scene", timeLabel: "Arrival at Scene" },
  { from: "onscene", to: "transporting", timeKey: "departure", unitStatus: "transporting", buttonLabel: "Departure from Scene", timeLabel: "Departure from Scene" },
  { from: "transporting", to: "arrived", timeKey: "arrivalDestination", unitStatus: "transporting", buttonLabel: "Arrival to Destination", timeLabel: "Arrival to Destination" },
  { from: "arrived", to: "completed", timeKey: "backInService", unitStatus: "available", buttonLabel: "Back in Service", timeLabel: "Back in Service" },
];