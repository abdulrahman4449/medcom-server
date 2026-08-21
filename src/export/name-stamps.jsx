import { seatLabel } from "../domain/shift-helpers.jsx";

// ---------- log sheet name stamps ----------
//
// Nobody is permanently attached to a medic or to the dispatch desk here: crews
// pick the unit they are working at every sign-on and the desk changes hands
// through the day. That makes "MEDIC 3 went en route" half a record — by next
// week that seat belongs to someone else, and the log sheet is what a
// supervisor reads back weeks later. So every line is stamped with the person
// who was signed in when it was written, captured at that moment and never
// recomputed from who happens to be sitting there now.
export function actorStamp(session) {
  if (!session) return null;
  const name = session.name || session.accountId || "";
  if (!name) return null;
  return {
    name,
    role: session.role || null,
    accountId: session.accountId || null,
    // Which station the person was working when they did this. It is what lets
    // a station's log sheet be its own, and it is on the stamp rather than on
    // the message so it survives into the spreadsheet as a column.
    station: session.station || null,
    unitName: session.role === "team" ? session.unitName || "" : "",
    seat: session.role === "team" ? session.slot || null : null,
  };
}

// Where the stamped person was posted: "MEDIC 3 · ALPHA" for a crew member,
// "DISPATCH" or "ADMIN" for whoever was working the desk.
export function actorPost(actor) {
  if (!actor) return "";
  if (actor.role === "team") {
    return [actor.unitName || "TEAM", seatLabel(actor.seat).toUpperCase()].filter(Boolean).join(" · ");
  }
  if (actor.role === "dispatcher") return "DISPATCH";
  if (actor.role === "admin") return "ADMIN";
  return "";
}

// "R. Chen (MEDIC 3 · ALPHA)" — the stamp as one string, for the spreadsheet.
export function actorStampText(actor) {
  if (!actor || !actor.name) return "";
  const post = actorPost(actor);
  return post ? `${actor.name} (${post})` : actor.name;
}

// The same stamp for someone who held a seat on a medic, built from a unit name
// and a crew record rather than from a live session.
export function crewStampText(unitName, person) {
  if (!person || !person.name) return "";
  return actorStampText({ role: "team", name: person.name, unitName: unitName || "", seat: person.seat || null });
}