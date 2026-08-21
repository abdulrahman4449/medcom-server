
// ---------- call locations ----------
//
// A call has two places in it: where the patient is picked up and where they
// are taken. The board originally recorded only one ("location"), which is why
// the FROM column of the exported dispatch log was filled in and TO was always
// left blank. Calls are now raised with both, and everything below reads them
// through these helpers so a call logged before the split still displays and
// exports correctly — its single location is treated as the pickup point.
export function callFrom(req) {
  if (!req) return "";
  return String(req.locationFrom || req.location || "").trim();
}

export function callTo(req) {
  if (!req) return "";
  return String(req.locationTo || "").trim();
}

// "Ward 4B → CT Suite", or just the pickup point when there is no destination
// on the record (an older call, or one raised before the destination was known).
export function callRoute(req) {
  const from = callFrom(req);
  const to = callTo(req);
  if (from && to) return `${from} → ${to}`;
  return from || to || "—";
}