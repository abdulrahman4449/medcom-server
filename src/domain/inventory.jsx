
// ---------- what the department holds ----------
//
// Stock belongs to the department, not to a truck. The store room has forty
// cannulas; which ambulance is carrying six of them at any moment is not a
// number anybody counts, and asking crews to keep eight parallel per-vehicle
// ledgers accurate was never going to work.
//
// So: one number per item, and one question — how much of it is left.
//
// A FULL COUNT is what administration counted when they last did a count. That
// number is 100 per cent by definition; there is nothing else to compare
// against, and inventing a target the department has not set would be a figure
// somebody reports upward.
//
// MOVEMENTS are what has happened since that count — what crews used, recorded
// against the call they used it on. Availability is the count minus what has
// gone, expressed against the count.
//
// The current level is deliberately not stored. Two tablets both writing
// "7 left" over each other lose the eighth with nobody able to say where it
// went; a movement log cannot lose one without somebody having written that it
// went, and it answers the question administration actually has, which is who
// used the last of something and on what call.
export const INVENTORY_KEY = "ems:inventory";
export const INVENTORY_MOVES_KEY = "ems:inventoryMoves";
export const INVENTORY_MOVES_CAP = 4000;

// The shelf has sections. "IV catheters" is the section; 18G, 20G, extension
// sets and dressings are what is in it. A flat list of eighty items is a scroll
// nobody reads, and it is not how the store room is actually arranged.
export const UNSORTED_CATEGORY = "__unsorted";

export function inventoryItems(inv) {
  const list = inv && Array.isArray(inv.items) ? inv.items : [];
  return list.filter((it) => it && it.id && it.name);
}

export function inventoryCategories(inv) {
  const list = inv && Array.isArray(inv.categories) ? inv.categories : [];
  return list.filter((c) => c && c.id && c.name);
}

// Rows arranged the way the store room is: sections in the order they were
// added, each with its items. Anything from before sections existed — or left
// behind when a section is removed — collects in one holding section at the
// end rather than disappearing from the page with the count still on it.
export function inventoryTree(inv, moves) {
  const cats = inventoryCategories(inv);
  const rows = stockLevels(inventoryItems(inv), moves);
  const known = new Set(cats.map((c) => c.id));
  const groups = cats.map((c) => ({
    id: c.id,
    name: c.name,
    rows: rows.filter((r) => r.categoryId === c.id),
  }));
  const loose = rows.filter((r) => !r.categoryId || !known.has(r.categoryId));
  if (loose.length) groups.push({ id: UNSORTED_CATEGORY, name: "Not in a category", rows: loose });
  return groups;
}

// Everything that has happened to this item since the count it is measured
// against. A movement made before the last count has already been counted —
// it is in the number administration wrote down — so counting it again would
// deduct it twice.
export function movesSinceCount(moves, item) {
  const from = item.countedAt || 0;
  return (moves || []).filter((m) => m && m.itemId === item.id && (m.ts || 0) >= from);
}

export function stockLevels(items, moves) {
  return items.map((it) => {
    const full = Math.max(0, it.full || 0);
    const used = movesSinceCount(moves, it).reduce((n, m) => n - (m.delta || 0), 0);
    const have = Math.max(0, full - Math.max(0, used));
    const pct = full > 0 ? Math.round((have / full) * 100) : null;
    return {
      ...it,
      full,
      used: Math.max(0, used),
      have,
      pct,
      // Bands rather than a single threshold: a store room at a fifth is a
      // different conversation from one at half, and one word each is quicker
      // to read across a list than eight percentages.
      band: pct === null ? "unset" : pct <= 10 ? "out" : pct <= 25 ? "low" : pct <= 50 ? "half" : "ok",
    };
  });
}

export const STOCK_BANDS = {
  ok: { label: "", color: "var(--ok)" },
  half: { label: "HALF GONE", color: "var(--hold)" },
  low: { label: "RUNNING OUT", color: "var(--hold)" },
  out: { label: "ALMOST NONE", color: "var(--crit)" },
  unset: { label: "NOT COUNTED", color: "var(--ink-4)" },
};