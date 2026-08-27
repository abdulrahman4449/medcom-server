// ---------- merging records into what the board already holds ----------
//
// Pulled out of server.js so `npm test` can exercise it. This is the piece that
// stands between a device with an old copy of the board and everybody else's
// work: get it wrong and the app is back to losing calls silently, which is
// exactly the failure it was written to end.
const RECORD_CAP_MAX = 100000;

function mergeRecordsInto(current, body) {
  const upsert = body.upsert;
  const remove = Array.isArray(body.remove) ? body.remove.map(String) : [];
  const prepend = !!body.prepend;
  const cap = Number(body.cap) > 0 ? Math.min(Number(body.cap), RECORD_CAP_MAX) : 0;

  // A list of records, keyed by id.
  if (Array.isArray(upsert)) {
    const cur = Array.isArray(current) ? current : [];
    const gone = new Set(remove);
    const out = cur.filter((x) => !(x && x.id && gone.has(String(x.id))));
    const at = new Map();
    out.forEach((x, i) => { if (x && x.id) at.set(String(x.id), i); });
    const fresh = [];
    for (const rec of upsert) {
      if (!rec || rec.id === undefined || rec.id === null) continue;
      const id = String(rec.id);
      if (gone.has(id)) continue;
      const i = at.get(id);
      // In place if it is already here, so the order the board was in survives
      // somebody a long way away changing one record in the middle of it.
      if (i === undefined) { at.set(id, out.length + fresh.length); fresh.push(rec); }
      else out[i] = rec;
    }
    const merged = prepend ? [...fresh, ...out] : [...out, ...fresh];
    // A cap always drops the oldest, and the oldest is at the far end from
    // wherever new records go. The event log grows at the front and is cut at
    // the back; the message thread grows at the back and is cut at the front.
    if (!cap || merged.length <= cap) return merged;
    return prepend ? merged.slice(0, cap) : merged.slice(-cap);
  }

  // A map, keyed by whatever its keys are.
  if (upsert && typeof upsert === "object") {
    const cur = current && typeof current === "object" && !Array.isArray(current) ? current : {};
    const out = { ...cur };
    for (const k of remove) delete out[k];
    for (const k of Object.keys(upsert)) out[k] = upsert[k];
    return out;
  }

  return null;
}

module.exports = { RECORD_CAP_MAX, mergeRecordsInto };
