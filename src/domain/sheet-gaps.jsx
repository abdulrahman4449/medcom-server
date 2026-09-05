import { callTo } from "./call-locations.jsx";
import { callWasCancelled } from "./close-reasons.jsx";
import { isNoTransport } from "./second-ambulance.jsx";
import { callTypeOf, loadedKmOf } from "./sheet-vocabulary.jsx";

// ---------- what the sheet still needs ----------
//
// A call going back in service is not the same as its record being finished. The
// category gets argued over at the destination, the kilometres are read when the
// truck parks, the MRN turns up later. Left alone these gaps are only discovered
// at the end of the month, by somebody reading 400 rows looking for blanks.
//
// So the desk is told while the shift is still in living memory: which calls are
// short, and of what.
export const LOG_COMPLETENESS = [
  { key: "patientOrigin", label: "where the patient came from", has: (r) => !!r.patientOrigin },
  { key: "locationTo", label: "destination", has: (r) => !!callTo(r) },
  { key: "mrn", label: "MRN", has: (r) => !!(r.mrn && String(r.mrn).trim()) },
  { key: "callType", label: "cat. of call", has: (r) => !!callTypeOf(r) },
  { key: "callCategory", label: "call category", has: (r) => !!r.callCategory },
  { key: "loadedKm", label: "kilometre band", has: (r) => !!loadedKmOf(r) },
  // Both go on the sheet, and both were being left blank without anything
  // saying so — the desk only found out at month end.
  { key: "emergencyCode", label: "codes and emergencies", has: (r) => !!r.emergencyCode },
  {
    key: "addedService",
    label: "added service",
    has: (r) => !!(r.addedService && String(r.addedService).trim()),
  },
  {
    key: "receiver",
    label: "who received the patient",
    // Only asked of a call where somebody was actually handed over.
    applies: (r) => !isNoTransport(r) && !!(r.times || {}).arrivalDestination,
    has: (r) => !!(r.receiver && r.receiver.name),
  },
  // The five stamps. A truck whose phone died mid-call leaves gaps the desk
  // fills by radio while the call runs, or after the fact with a reason
  // (stamping.jsx) — and a gap has to COUNT as missing, or the record locks
  // with a blank timeline nobody may fill. Not asked of a call that moved
  // nobody: a refusal or a call called off legitimately stops short, and
  // demanding five stamps of it would keep it open for ever.
  ...["enroute", "arrival", "departure", "arrivalDestination", "backInService"].map((k, i) => ({
    key: `time.${k}`,
    label: ["en route time", "on-scene time", "departure time", "arrival at destination time", "back in service time"][i],
    applies: (r) => !isNoTransport(r) && !callWasCancelled(r),
    has: (r) => !!(r.times || {})[k],
  })),
];

export function missingLogFields(req) {
  if (!req || req.status !== "completed") return [];
  return LOG_COMPLETENESS.filter((f) => (!f.applies || f.applies(req)) && !f.has(req));
}

export function callsNeedingDetail(requests) {
  return (requests || [])
    .filter((r) => r.status === "completed" && missingLogFields(r).length)
    .sort((a, b) => b.createdAt - a.createdAt);
}