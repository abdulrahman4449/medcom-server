
// ---------- going out of service ----------
//
// A truck leaving the run is a decision about the department's cover, not about
// one crew's afternoon. Taken silently it removed an ambulance from the board
// with no reason recorded and nobody told — and the desk found out by noticing
// a gap. So a crew asks, with a reason, and the desk answers.
//
// The truck stays available while the request is pending. It is still a working
// ambulance until somebody says otherwise, and a crew who cannot roll is a
// different thing from a crew who has asked not to be sent.
export const OOS_REASONS = [
  "Vehicle fault",
  "Equipment missing or broken",
  "Restocking",
  "Cleaning or decontamination",
  "Fuel",
  "Crew break",
  "Crew unwell",
  "Other",
];

export function oosRequestOf(unit) {
  const r = unit && unit.oosRequest;
  return r && r.status === "pending" ? r : null;
}