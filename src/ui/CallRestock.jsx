import { callRoute } from "../domain/call-locations.jsx";
import { inventoryTree } from "../domain/inventory.jsx";
import { clockStr } from "../domain/messages.jsx";
import { recordStockUse, undoStockUse, usedOnCall } from "../domain/restock.jsx";
import { callEndTs } from "../domain/uhu.jsx";
import { useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { FoldingSection } from "./AdminView.jsx";

// ---------- what a crew used on this call ----------
//
// Paired to the call, not to the truck. "What did we get through today" is a
// question nobody answers accurately at the end of a shift; "what did we use on
// this patient" is answerable while standing next to the trolley, which is the
// only moment the answer is reliable.
//
// Tap an item, say how many. It comes off the department's shelf carrying the
// call, the truck and the person with it.
export function CallRestock({ inventory, moves, unit, user, request, setMoves, onDone, startOpen }) {
  const [open, setOpen] = useState(!!startOpen);
  const [busy, setBusy] = useState(null);
  const [closing, setClosing] = useState(false);
  // Which categories are folded shut. Open by default: a crew at the truck
  // wants to see the list, not go looking for it.
  const [shut, setShut] = useState({});
  const groups = inventoryTree(inventory, moves);
  const mine = usedOnCall(moves, request && request.id);

  if (!request || !unit) return null;

  // How many of each item are already down against this call, and the lines
  // behind that number so one can be taken back off.
  const lines = new Map();
  mine.forEach((m) => lines.set(m.itemId, [...(lines.get(m.itemId) || []), m]));
  const countOf = (id) =>
    (lines.get(id) || []).reduce((n, m) => n + Math.abs(m.delta || 0), 0);
  const total = mine.reduce((n, m) => n + Math.abs(m.delta || 0), 0);

  // One tap is one item. No dialogue box asking how many — a crew who used
  // three taps three times, which is quicker than typing a number and cannot be
  // got wrong. The minus takes one back off.
  async function addOne(item) {
    setBusy(item.id);
    try {
      const next = await recordStockUse({ item, qty: 1, unit, user, request });
      if (next) setMoves(next);
    } finally {
      setBusy(null);
    }
  }

  async function removeOne(item) {
    const ls = lines.get(item.id) || [];
    if (!ls.length) return;
    const last = ls[ls.length - 1];
    setBusy(item.id);
    try {
      const next = await undoStockUse({ moveId: last.id });
      if (next) setMoves(next);
    } finally {
      setBusy(null);
    }
  }

  const anyItems = groups.some((g) => g.rows.length > 0);

  async function finish() {
    if (
      !window.confirm(
        total === 0
          ? `Mark this call restocked with nothing recorded?\n\nOnly do this if you genuinely used nothing.`
          : `Mark this call restocked?\n\n${total} item${total === 1 ? "" : "s"} came off the shelf ` +
            `and the truck has been made up again.`
      )
    )
      return;
    setClosing(true);
    try {
      if (onDone) await onDone();
    } finally {
      setClosing(false);
    }
  }

  return (
    <FoldingSection
      title={`RESTOCK — ${(request.nature || "call").toUpperCase()}`}
      count={total}
      countLabel={total ? "items used" : "nothing recorded"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div style={styles.restockWhen}>
        {callRoute(request)} · finished {clockStr(callEndTs(request, Date.now()))}
      </div>
      {!anyItems ? (
        <div style={styles.formHint}>Administration has not added any stock items yet.</div>
      ) : (
        <>
          <div style={styles.formHint}>
            Tick what you used on this call. Tap once per item — tap again for a second one. It comes
            off the department's stock and stays attached to this call.
          </div>

          {groups.map((g) =>
            g.rows.length === 0 ? null : (
              <div key={g.id} style={styles.todoCat}>
                <button
                  style={styles.todoCatHead}
                  onClick={() => setShut((m) => ({ ...m, [g.id]: !m[g.id] }))}
                >
                  <span style={styles.todoCatChev}>{shut[g.id] ? "▸" : "▾"}</span>
                  <span style={styles.todoCatName}>{g.name}</span>
                  {(() => {
                    const n = g.rows.reduce((a, r) => a + countOf(r.id), 0);
                    return n > 0 ? <span style={styles.todoCatTally}>{n}</span> : null;
                  })()}
                </button>

                {!shut[g.id] &&
                  g.rows.map((r) => {
                    const n = countOf(r.id);
                    return (
                      <div key={r.id} style={n ? styles.todoRowOn : styles.todoRow}>
                        <button
                          style={styles.todoTap}
                          onClick={() => addOne(r)}
                          disabled={busy === r.id}
                        >
                          <span style={n ? styles.todoBoxOn : styles.todoBox}>{n ? "✓" : ""}</span>
                          <span style={n ? styles.todoNameOn : styles.todoName}>{r.name}</span>
                        </button>
                        {n > 0 && (
                          <span style={styles.todoQtyWrap}>
                            <button
                              style={styles.todoStep}
                              onClick={() => removeOne(r)}
                              disabled={busy === r.id}
                              aria-label={`One fewer ${r.name}`}
                            >
                              −
                            </button>
                            <span style={styles.todoQty}>{n}</span>
                            <button
                              style={styles.todoStep}
                              onClick={() => addOne(r)}
                              disabled={busy === r.id}
                              aria-label={`One more ${r.name}`}
                            >
                              +
                            </button>
                          </span>
                        )}
                      </div>
                    );
                  })}
              </div>
            )
          )}

          <div style={styles.todoFoot}>
            {total === 0
              ? "Nothing ticked yet. If you used nothing on this call, say so below."
              : `${total} item${total === 1 ? "" : "s"} recorded against this call.`}
          </div>
        </>
      )}

      {onDone && (
        <button style={styles.restockDoneBtn} onClick={finish} disabled={closing}>
          {closing ? "…" : total === 0 ? "Used nothing — mark restocked" : "Truck restocked"}
        </button>
      )}
    </FoldingSection>
  );
}