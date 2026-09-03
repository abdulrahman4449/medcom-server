// ---------- what an administrator can lend, one area at a time ----------
//
// Lending the whole job was too much. "Cover the overtime approvals while I am
// away" should not also hand over the accounts, the policy shelf and the
// ability to restore the board from a backup — an administrator delegating one
// evening's work is not making somebody an administrator.
//
// So authority is lent by AREA. Each of these is one thing an administrator
// does, and the person is given exactly the ones they are named for.
//
// This list is the server's, because the server is what enforces it. The app
// has its own copy of the same keys for the screens; `npm test` asserts the two
// cannot drift apart.
const DELEGATION_SCOPES = [
  {
    key: "dispatch",
    label: "The dispatch desk",
    sub: "Raise and assign calls, work a shift at a station",
  },
  {
    key: "teams",
    label: "Teams & accounts",
    sub: "Add and remove staff, issue sign-in codes, clear passwords",
  },
  {
    key: "overtime",
    label: "Overtime",
    sub: "Approve, part-approve and decline claims",
  },
  {
    key: "archive",
    label: "Archive & backups",
    sub: "The kept days, filed logs, and putting data back from a copy",
  },
  {
    key: "stats",
    label: "Statistics",
    sub: "Per-person UHU, coverage, response, checklist compliance",
  },
  { key: "inventory", label: "Inventory", sub: "What is on the shelf and what came off it" },
  { key: "policies", label: "Policies", sub: "The policy shelf" },
  { key: "checklists", label: "Vehicle checklists", sub: "What is on each list" },
  { key: "schedule", label: "Employees schedule", sub: "Prepare the six-week roster" },
];

const SCOPE_KEYS = new Set(DELEGATION_SCOPES.map((s) => s.key));

// Which board key each area is allowed to write. A key not named here is not
// writable by any delegate — only by a real administrator.
const SCOPE_WRITES = {
  overtime: ["ems:overtime"],
  inventory: ["ems:inventory"],
  policies: ["ems:policies"],
  checklists: ["ems:checklists"],
  schedule: ["ems:schedule"],
};

// Areas that are administration rather than the desk. Holding any one of these
// is what lets somebody sign in on the administrator's side of the app at all.
const ADMIN_SCOPES = DELEGATION_SCOPES.map((s) => s.key).filter((k) => k !== "dispatch");

function cleanScopes(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  for (const s of list) {
    const k = String(s || "");
    if (SCOPE_KEYS.has(k)) seen.add(k);
  }
  // Kept in the order they are defined, so a stored delegation and a fresh one
  // read the same way wherever they are shown.
  return DELEGATION_SCOPES.map((s) => s.key).filter((k) => seen.has(k));
}

function scopeAllowsKey(scopes, key) {
  return (scopes || []).some((s) => (SCOPE_WRITES[s] || []).includes(key));
}

function hasScope(scopes, scope) {
  return (scopes || []).includes(scope);
}

function scopeLabel(key) {
  const s = DELEGATION_SCOPES.find((x) => x.key === key);
  return s ? s.label : key;
}

// "Overtime and Archive & backups", the way a sentence needs to read them.
function scopeSentence(scopes) {
  const names = cleanScopes(scopes).map(scopeLabel);
  if (!names.length) return "nothing";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

module.exports = {
  DELEGATION_SCOPES,
  ADMIN_SCOPES,
  SCOPE_WRITES,
  cleanScopes,
  scopeAllowsKey,
  hasScope,
  scopeLabel,
  scopeSentence,
};
