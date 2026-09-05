// ---------- the areas of the job, for the screens ----------
//
// The server owns this list — `lib/delegation.cjs` — because the server is what
// enforces it. This is the app's copy, for drawing the tick boxes and deciding
// which panels to put on screen. `npm test` asserts the two carry the same keys
// in the same order, so a new area added on one side cannot quietly go missing
// on the other.
//
// If they ever did drift, the failure is visible rather than dangerous: a panel
// might appear that the server then refuses. It can never work the other way
// round, because the server never asks the app what somebody is allowed to do.
export const DELEGATION_AREAS = [
  { key: "dispatch", label: "The dispatch desk", sub: "Raise and assign calls, work a shift at a station" },
  { key: "teams", label: "Teams & accounts", sub: "Add and remove staff, issue sign-in codes, clear passwords" },
  { key: "overtime", label: "Overtime", sub: "Approve, part-approve and decline claims and productivity requests" },
  { key: "archive", label: "Archive & backups", sub: "The kept days, filed logs, and putting data back from a copy" },
  { key: "stats", label: "Statistics", sub: "Per-person UHU, coverage, response, checklist compliance" },
  { key: "inventory", label: "Inventory", sub: "What is on the shelf and what came off it" },
  { key: "policies", label: "Policies", sub: "The policy shelf" },
  { key: "checklists", label: "Vehicle checklists", sub: "What is on each list" },
  { key: "schedule", label: "Employees schedule", sub: "Prepare the six-week roster" },
];

export const ADMIN_AREAS = DELEGATION_AREAS.filter((a) => a.key !== "dispatch");

// THE DESK IS LENT, NOT ASSIGNED.
//
// `dispatcher` was an account role: a second kind of person to create,
// remember and remove, which turned covering the desk into a staffing
// question. An administrator who needed somebody on the desk for a fortnight
// either made them an account or handed over their own ID, and the second is
// what people did — which put the wrong name on every line of that night's
// log. Lending the `dispatch` area does the same job under the person's own
// name, with a date and a giver on it, and it is taken back in one tap.
//
// Accounts made under the old rule keep the role: they are staffed, they may
// be seated right now, and a rule introduced today must not brick them. Only
// CREATING one is refused. `lib/delegation.cjs` carries the same function for
// the server, and `npm test` asserts the two agree.
export const ASSIGNABLE_ROLES = ["crew", "admin"];

export function roleAssignable(role, existingRole) {
  if (role === "dispatcher") return existingRole === "dispatcher";
  return ASSIGNABLE_ROLES.includes(role);
}

export function areaLabel(key) {
  const a = DELEGATION_AREAS.find((x) => x.key === key);
  return a ? a.label : key;
}

// "Overtime and Archive & backups", the way a sentence needs to read them.
export function areaSentence(scopes) {
  const names = (scopes || []).map(areaLabel);
  if (!names.length) return "nothing";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// May this session touch that area?
//
// A real administrator holds all of them, and carries no list — an empty list
// would be indistinguishable from "holds nothing", and getting that the wrong
// way round would either lock an administrator out of their own app or hand a
// delegate the whole of it. So the list is present only on a borrowed session,
// and its absence means the job is theirs.
export function canArea(user, area) {
  if (!user || user.role !== "admin") return false;
  const held = user.delegatedScopes;
  if (!Array.isArray(held)) return true;
  return held.includes(area);
}

// Whether this session is administration borrowed rather than held.
export function isDelegatedAdmin(user) {
  return !!(user && user.role === "admin" && Array.isArray(user.delegatedScopes));
}
