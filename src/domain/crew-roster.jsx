// ---------- who could have been on that truck ----------
//
// A call written up by hand ran while the board was not there, so nothing on
// the board knows who crewed it. It used to be typed — two free-text boxes —
// and a name typed at eight in the morning about a call at two is a name spelt
// three different ways across three entries, which is no use to anybody
// searching for it later and no use at all on a sheet.
//
// So the names are picked. The list is everybody the board has seen work,
// taken from the sign-on and sign-off lines in the event log rather than from
// the accounts table: a dispatcher cannot read the accounts table — that is
// administration's — and in any case the question here is not "who works here"
// but "who has actually been on a truck", which is what the log answers.
//
// Most recent first, because the crew that ran a call during an outage is
// almost always one that has been on lately.
export function knownCrew(log, units) {
  const seen = new Map();
  const note = (accountId, name, ts) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    const key = String(accountId || clean).trim().toUpperCase();
    const held = seen.get(key);
    if (held) {
      if ((ts || 0) > held.lastSeen) {
        held.lastSeen = ts || 0;
        held.name = clean;
      }
      if (!held.accountId && accountId) held.accountId = accountId;
      return;
    }
    seen.set(key, { accountId: accountId || "", name: clean, lastSeen: ts || 0 });
  };

  // Anyone sitting in a seat right now. First, and with the clock, so a crew
  // that is on duty as the form is opened sorts to the top.
  (units || []).forEach((u) => {
    if (!u) return;
    ["alpha", "bravo"].forEach((slot) => {
      const m = u[slot];
      if (m && m.name) note(m.accountId, m.name, Date.now());
    });
  });

  // Everybody the log has a shift line for. `role: "team"` is the same test the
  // statistics use to decide who is crew — a dispatcher signing on is not
  // somebody who could have been in the back of a truck.
  (log || []).forEach((l) => {
    if (!l || l.role !== "team") return;
    note(l.accountId, l.name, l.ts || l.shiftStart || 0);
  });

  return [...seen.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

// The value a picker holds for one person: their employee ID when the board
// knows it, and their name when it does not. Names are not unique and IDs are,
// so the ID is what the record should carry — but a person the log only ever
// saw as a name still has to be selectable.
export function crewOptionValue(p) {
  return p && (p.accountId || p.name) ? String(p.accountId || p.name) : "";
}

export function crewByValue(list, value) {
  if (!value) return null;
  return (list || []).find((p) => crewOptionValue(p) === value) || null;
}
