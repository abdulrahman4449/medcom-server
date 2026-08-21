import { NO_TRANSPORT } from "./outcomes.jsx";
import { assistTeams, isNoTransport } from "./second-ambulance.jsx";
import { readKey } from "../lib/offline-queue.jsx";

// ---------- how the call is coded: category, and loaded distance ----------
//
// Two codes travel with every call to the billing and activity sheets, and both
// of them used to be written on paper afterwards: the exported dispatch log has
// carried empty CAT. OF CALL and KILO METER columns since it was first built,
// filled in by hand from memory hours later. They are recorded on the call
// itself now, by whoever knows the answer first.
//
// That is deliberately not one fixed role. The desk usually knows the category
// at intake — an ALS crew was asked for, or the ward said critical care — while
// the distance is only known once the truck has run it, so the crew are usually
// the ones who can say. Either side can set either code, and either side can
// correct the other's, because the alternative is a code that is right in
// somebody's head and wrong on the sheet.
//
// Whoever gets there first, both codes have to be on the call before the crew
// running it can go back in service — see CLOSEOUT_REQUIREMENTS below. Open to
// either side, mandatory for the one holding the call at the end.
// ---------- the sheet's own vocabulary ----------
//
// Taken verbatim from the department's dispatch log so what a crew picks here
// is the same word that lands in the column, rather than free text somebody has
// to translate at the end of the month.
//
// The sheet's lists carry rows of underscores as visual dividers between groups.
// They are spacing, not choices, and they are stripped here — left in, they
// would appear in the app as selectable options and end up written against real
// calls.
export function fromSheetList(items) {
  return items.filter((x) => x && x.trim() && !/^_+$/.test(x.trim()));
}

// Column B — where the patient is collected. Grouped as the sheet groups them:
// the main campus, then CCC, then everything off-site.
export const PATIENT_ORIGINS = fromSheetList([
  "KACOLD Bldg.",
  "EAST WING Bldg.",
  "MAIN HOSPITAL Bldg.",
  "EMERGENCY Bldg.",
  "HEART CENTER Bldg.",
  "OLD OUTPATIENT Bldg.",
  "ALZAHRAWI Bldg.",
  "MAIN HOUSING FACILITY",
  "MAIN WORK FACILITIES",
  "HOSPITAL GROUNDS",
  "CSSD BLOODBANK Bldg.",
  "________________________",
  "CCC MAIN Bldg.",
  "CCC HOUSING FACILITY",
  "CCC WORK FACILITIES",
  "CCC GROUNDS",
  "_______________________",
  "MEDEVAC",
  "PROTOCOL HOME",
  "PATIENT HOME",
  "OTHER HOSPITALS",
  "KKIA",
  "OTHERS",
]);

// Which station an origin belongs to, so the statistics can be read per station
// without anyone tagging them by hand.
export function originStation(origin) {
  return /^CCC /.test(origin || "") ? "ccc" : "main";
}

// Column R — CALL CATEGORY.
export const CALL_CATEGORIES = fromSheetList([
  // Internal and external emergencies are the same word for two different jobs,
  // and only one of them is ours to answer inside ten minutes. A call from a
  // ward is a corridor away; one from outside the campus is a drive. Measuring
  // them together produced a response figure that meant nothing, so the sheet's
  // single EMERGENCY becomes two.
  "EMERGENCY (INTERNAL)", "EMERGENCY (EXTERNAL)", "CANCELLED", "CCC ROUTINE", "CHEST PAIN PROGRAM", "CODE",
  "COMMERCIAL FLIGHT", "DEM ADMISSION", "DIRECT ADMISSION", "DISCHARGE",
  "ADMINISTRATIVE", "FLIGHT ASSESSMENT", "HOME HEALTH CARE", "HOME VENT PROGRAM",
  "MEDEVAC", "MOBILE STROKE UNIT", "NO COVERAGE", "PROTOCOL EMERGENCY", "ROUTINE",
  "RRT TRANSPORT", "STAT PROCEDURE", "TRANSPLANT", "NA",
]);

// Column S — CODES AND EMERGENCIES. The emergencies come first, then the colour
// codes, exactly as the sheet has them.
export const EMERGENCY_CODES = fromSheetList([
  "CARDIAC EMERGENCY", "RESPIRATORY EMERGENCY", "NEUROLOGICAL EMERGENCY",
  "TRAUMA EMERGENCY", "OBSTETRIC GYNECOLOGICAL", "PEDIATRIC EMERGENCY",
  "TOXICOLOGY EMERGENCY", "ENVIRONMENTAL EXPOSURE", "MEDICAL EMERGENCY",
  "HOME VENTILATOR EMERGENCY",
  "____________________________",
  "CODE GREEN", "CODE BLUE", "CODE WHITE", "CODE ORANGE", "CODE YELLOW",
  "CODE RED", "CODE PINK", "CODE BLACK", "CODE SILVER", "CODE 5", "NA",
]);

// Column Q — ADDED SERVICE.
export const ADDED_SERVICES = fromSheetList(["D", "5", "NA"]);

// Column DG — ADMITTED UNDER.
export const ADMITTED_UNDER = fromSheetList([
  "Home Health Care", "Home Mechanical Ventilation Program", "Protocol",
  "Neuroscience Center of Excellence", "Genomics Center of Excellence",
  "Pediatrics & Women's Health Center of Excellence", "Medical Center of Excellence",
  "Transplant Center of Excellence", "Heart Center of Excellence",
  "Cancer Center of Excellence", "Surgical Center of Excellence",
  "RADIOLOGY", "GENERIC MRN",
]);

export const CALL_TYPES = [
  { key: "A", name: "ALS", desc: "Advanced life support", color: "var(--crit)" },
  { key: "B", name: "BLS", desc: "Basic life support", color: "var(--flow)" },
  { key: "C", name: "CRITICAL", desc: "Critical care", color: "var(--crit)" },
  { key: "D", name: "AUXILIARY", desc: "Additional ambulance (auxiliary)", color: "#8B5CF6" },
  { key: "E", name: "NO TRANSPORT", desc: "Ambulance responded — no transport", color: NO_TRANSPORT.color },
  { key: "NA", name: "N/A", desc: "Not applicable", color: "#64748B" },
];

// Bands rather than a distance: the service is billed on which band the loaded
// leg falls into, so a band is the fact worth recording and a reading off the
// odometer is not. Band 5 is the open-ended one — everything past 400 km, in
// further 200 km steps.
export const LOADED_KM = [
  { key: "1", name: "≤ 50 km", desc: "50 km or less" },
  { key: "2", name: "51–150 km", desc: "51 km up to 150 km" },
  { key: "3", name: "151–250 km", desc: "151 km up to 250 km" },
  { key: "4", name: "251–400 km", desc: "251 km up to 400 km" },
  { key: "5", name: "400 km +", desc: "each additional 200 km after 400 km" },
  { key: "NA", name: "N/A", desc: "Not applicable" },
];

export const LOADED_KM_COLOR = "#14B8A6";

export function callTypeMeta(key) {
  return CALL_TYPES.find((t) => t.key === key) || null;
}

export function loadedKmMeta(key) {
  return LOADED_KM.find((k) => k.key === key) || null;
}

// The code on a call, or null. An unrecognised code — a record written by a
// build that knew a letter this one doesn't — reads as unset rather than
// throwing the card that draws it.
export function callTypeOf(req) {
  return req ? callTypeMeta(req.callType) : null;
}

export function loadedKmOf(req) {
  return req ? loadedKmMeta(req.loadedKm) : null;
}

// What the call already says about itself. A refusal recorded on it is an E; a
// team that came out as the second ambulance is a D. Offered as a suggestion on
// the picker and never applied on its own — the code has to be somebody's
// answer, because it is somebody's answer that gets billed.
export function suggestedCallType(req) {
  if (!req) return null;
  if (isNoTransport(req)) return "E";
  if (assistTeams(req).length > 0) return "D";
  return null;
}

// One writer for both codes, shared by the desk, the crew, the admin monitor and
// the history list, so a code set from any of the four is stamped, logged and
// saved the same way. Reads fresh first for the same reason every other write on
// this board does: two tablets and a desk are often looking at the same call.
export async function applyCallCoding({ reqId, field, value, requests, saveRequests, addLog, actor }) {
  const isType = field === "callType";
  const meta = isType ? callTypeMeta(value) : loadedKmMeta(value);
  if (!meta) return;
  const now = Date.now();
  const freshRequests = await readKey("ems:requests", requests);
  const target = freshRequests.find((r) => r.id === reqId);
  if (!target) return;
  const previous = isType ? callTypeOf(target) : loadedKmOf(target);
  // Tapping the code that is already on the call is a no-op rather than a
  // second log line saying nothing changed.
  if (previous && previous.key === meta.key) return;
  const by = actor && actor.name ? actor.name : "";
  const patch = isType
    ? { callType: meta.key, callTypeBy: by, callTypeAt: now }
    : { loadedKm: meta.key, loadedKmBy: by, loadedKmAt: now };
  await saveRequests(freshRequests.map((r) => (r.id === reqId ? { ...r, ...patch } : r)));
  const label = isType ? "Call type" : "Loaded km";
  await addLog(
    `${label} ${meta.key} (${meta.name}) set on ${target.nature}` +
      `${previous ? ` — was ${previous.key}` : ""}${by ? ` — ${by}` : ""}`,
    "status"
  );
}