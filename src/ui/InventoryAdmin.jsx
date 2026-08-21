import { INVENTORY_KEY, STOCK_BANDS, UNSORTED_CATEGORY, inventoryCategories, inventoryItems, inventoryTree } from "../domain/inventory.jsx";
import { gregDateStr, gregDateTimeStr } from "../lib/dates.jsx";
import { uid } from "../lib/helpers.jsx";
import { writeKey } from "../lib/offline-queue.jsx";
import { useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { FoldingSection } from "./AdminView.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";

// ---------- inventory, as administration keeps it ----------
//
// Two jobs, and the page runs in the order they happen: read how much is left,
// and write down what a count found. Adding an item is the rare one, so it sits
// at the bottom out of the way.
export function InventoryAdmin({ inventory, moves, setInventory, user, addLog }) {
  const [open, setOpen] = useState(true);
  const [newCat, setNewCat] = useState("");
  const [addingTo, setAddingTo] = useState(null);
  const [newItem, setNewItem] = useState("");
  // Which row has its rename/remove showing. One at a time: these are rare
  // jobs and a pair of buttons on every line is what made this page enormous.
  const [manageId, setManageId] = useState(null);
  const [busy, setBusy] = useState(false);

  const items = inventoryItems(inventory);
  const cats = inventoryCategories(inventory);
  const groups = inventoryTree(inventory, moves);
  const short = groups.reduce(
    (n, g) => n + g.rows.filter((r) => r.band === "low" || r.band === "out").length,
    0
  );

  async function save(next, note) {
    setBusy(true);
    try {
      const payload = { categories: next.categories ?? cats, items: next.items ?? items };
      await writeKey(INVENTORY_KEY, payload);
      setInventory(payload);
      if (note) await addLog(note, "status");
    } finally {
      setBusy(false);
    }
  }

  async function addCategory() {
    const name = newCat.trim();
    if (!name) return;
    await save(
      { categories: [...cats, { id: uid("cat"), name }] },
      `Inventory — added the category "${name}"`
    );
    setNewCat("");
  }

  async function renameCategory(g) {
    const asked = window.prompt("Rename this category", g.name);
    if (asked === null) return;
    const name = asked.trim();
    if (!name) return;
    await save(
      { categories: cats.map((c) => (c.id === g.id ? { ...c, name } : c)) },
      `Inventory — category "${g.name}" renamed to "${name}"`
    );
  }

  async function removeCategory(g) {
    if (
      !window.confirm(
        `Remove the category "${g.name}"?\n\n` +
          `Its ${g.rows.length} item${g.rows.length === 1 ? "" : "s"} are kept — they move to ` +
          `"Not in a category" so nothing loses its count.`
      )
    )
      return;
    await save(
      { categories: cats.filter((c) => c.id !== g.id) },
      `Inventory — removed the category "${g.name}"`
    );
  }

  async function addItem(categoryId) {
    const name = newItem.trim();
    if (!name) return;
    // A name only. Inventing a number at the moment an item is named is how a
    // shelf ends up carrying a figure nobody ever counted.
    await save(
      { items: [...items, { id: uid("inv"), categoryId, name, full: 0, countedAt: null }] },
      `Inventory — added "${name}"`
    );
    setNewItem("");
  }

  // The count. Whatever number administration enters is the full shelf: it is
  // what they have just counted, so it is 100 per cent by definition, and
  // everything used before this moment is already inside it.
  async function recount(row) {
    const asked = window.prompt(
      `${row.name}\n\nHow many are there? Count what is actually on the shelf.\n\n` +
        `That number becomes 100% — anything used up to now is already inside it.`,
      row.full ? String(row.full) : ""
    );
    if (asked === null) return;
    const parsed = parseInt(String(asked).trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      window.alert("Enter a whole number — how many are on the shelf.");
      return;
    }
    await save(
      { items: items.map((it) => (it.id === row.id ? { ...it, full: parsed, countedAt: Date.now() } : it)) },
      `Inventory — ${row.name} counted at ${parsed}`
    );
  }

  async function renameItem(row) {
    const asked = window.prompt("Rename this item", row.name);
    if (asked === null) return;
    const name = asked.trim();
    if (!name) return;
    await save(
      { items: items.map((it) => (it.id === row.id ? { ...it, name } : it)) },
      `Inventory — "${row.name}" renamed to "${name}"`
    );
  }

  async function removeItem(row) {
    if (
      !window.confirm(
        `Remove "${row.name}" from the department's stock list?\n\nUse already recorded against it is kept.`
      )
    )
      return;
    await save({ items: items.filter((it) => it.id !== row.id) }, `Inventory — removed "${row.name}"`);
  }

  const recent = (moves || [])
    .slice()
    .sort((x, y) => (y.ts || 0) - (x.ts || 0))
    .slice(0, 25);

  return (
    <FoldingSection
      title="INVENTORY"
      count={short}
      countLabel={short ? "running low" : "stocked"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <InfoNote label="How this works">
        One shelf for the department, arranged in categories. Add a category, add the items in it,
        then enter what a count found — that number becomes 100%. Crews record what they use against
        the call they used it on and it comes off here.
      </InfoNote>

      {groups.length === 0 ? (
        <div style={styles.formHint}>
          Nothing here yet. Add a category below — “IV catheters”, “Airway”, “Dressings” — then the
          items that go in it.
        </div>
      ) : (
        <div style={styles.catGrid}>
          {groups.map((g) => (
            <div key={g.id} style={styles.catCard}>
              <div style={styles.catCardHead}>
                <span style={styles.catCardName}>{g.name}</span>
                <span style={styles.catCardCount}>{g.rows.length}</span>
              </div>

              {/* One line per item: name, a short bar, the percentage. About
                  24px each, so a category of a dozen sizes is a card rather
                  than a page. The whole line is the count button. */}
              {g.rows.length === 0 ? (
                <div style={styles.catCardEmpty}>Nothing in here yet.</div>
              ) : (
                g.rows.map((r) => {
                  const band = STOCK_BANDS[r.band];
                  const managing = manageId === r.id;
                  return (
                    <div key={r.id}>
                      <div style={styles.tinyRow}>
                        <button
                          style={styles.tinyTap}
                          onClick={() => recount(r)}
                          disabled={busy}
                          title="Enter what is on the shelf"
                        >
                          <span style={styles.tinyName}>{r.name}</span>
                          <span style={styles.tinyBarTrack}>
                            <span
                              style={{
                                ...styles.tinyBarFill,
                                width: `${r.pct === null ? 0 : Math.max(4, r.pct)}%`,
                                background: band.color,
                              }}
                            />
                          </span>
                          <span style={{ ...styles.tinyPct, color: band.color }}>
                            {r.pct === null ? "—" : `${r.pct}%`}
                          </span>
                        </button>
                        <button
                          style={styles.tinyMore}
                          onClick={() => setManageId(managing ? null : r.id)}
                        >
                          ⋯
                        </button>
                      </div>
                      {managing && (
                        <div style={styles.tinyManage}>
                          <span style={styles.tinyManageNote}>
                            {r.pct === null
                              ? "Never counted"
                              : `${r.have} of ${r.full}` +
                                (r.used ? ` · ${r.used} used` : "") +
                                (r.countedAt ? ` · ${gregDateStr(r.countedAt)}` : "")}
                          </span>
                          <button style={styles.catTool} onClick={() => renameItem(r)} disabled={busy}>
                            Rename
                          </button>
                          <button style={styles.catTool} onClick={() => removeItem(r)} disabled={busy}>
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {g.id !== UNSORTED_CATEGORY &&
                (addingTo === g.id ? (
                  <div style={styles.itemAddRow}>
                    <input
                      autoFocus
                      style={styles.itemAddInput}
                      placeholder="e.g. 18G"
                      value={newItem}
                      maxLength={80}
                      onChange={(e) => setNewItem(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addItem(g.id);
                        if (e.key === "Escape") setAddingTo(null);
                      }}
                    />
                    <button
                      style={styles.primaryBtnSm}
                      onClick={() => addItem(g.id)}
                      disabled={!newItem.trim() || busy}
                    >
                      Add
                    </button>
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
                    <button style={styles.catTool} onClick={() => renameCategory(g)} disabled={busy}>
                      Rename
                    </button>
                    <button style={styles.catTool} onClick={() => removeCategory(g)} disabled={busy}>
                      Remove
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}

      <div style={styles.stockAdd}>
        <div style={styles.invShortHead}>ADD A CATEGORY</div>
        <div style={styles.stockAddRow}>
          <input
            style={styles.invNameInput}
            placeholder="Category — e.g. IV catheters"
            value={newCat}
            maxLength={60}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addCategory();
            }}
          />
          <button style={styles.primaryBtnSm} onClick={addCategory} disabled={!newCat.trim() || busy}>
            Add
          </button>
        </div>
      </div>

      <div style={styles.invMovesWrap}>
        <div style={styles.invShortHead}>RECENT USE</div>
        {recent.length === 0 ? (
          <div style={styles.formHint}>Nothing recorded yet.</div>
        ) : (
          recent.map((m) => (
            <div key={m.id} style={styles.invMoveRow}>
              <span style={{ ...styles.invMoveDelta, color: "var(--crit)" }}>{m.delta}</span>
              <span style={styles.invMoveItem}>{m.itemName}</span>
              <span style={styles.invMoveWho}>
                {m.unitName || "—"}
                {m.byName ? ` · ${m.byName}` : ""}
                {m.requestNature ? ` · on ${m.requestNature}` : ""}
              </span>
              <span style={styles.invMoveWhen}>{gregDateTimeStr(m.ts)}</span>
            </div>
          ))
        )}
      </div>
    </FoldingSection>
  );
}