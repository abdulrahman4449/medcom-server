
// ---------- helpers ----------

export function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}
// One record per id, in the order they were given.
//
// Every list in this app is keyed by record id and every merge is by id — the
// board write, the backup sweep, the statistics corpus. A sheet is the last
// place a duplicate can show, and it is the only place a human sees it: a call
// printed twice on the dispatch log is a call that was run twice as far as
// anybody reading the sheet is concerned, and it double-counts in whatever is
// summed off it afterwards. So the exports dedupe on the way out rather than
// trusting every path that fed them.
//
// The FIRST copy wins, because the caller has already put the list in the order
// it wants — the live record ahead of a snapshot, the newest ahead of the older.
export function dedupeById(list) {
  const seen = new Set();
  const out = [];
  (list || []).forEach((rec) => {
    if (!rec) return;
    if (!rec.id) {
      out.push(rec);
      return;
    }
    const id = String(rec.id);
    if (seen.has(id)) return;
    seen.add(id);
    out.push(rec);
  });
  return out;
}
