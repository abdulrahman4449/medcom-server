import { seatLabel } from "./shift-helpers.jsx";
import { crewStampText } from "../export/name-stamps.jsx";

// ---------- who writes the patient care report ----------
//
// Every call that runs to the end leaves a patient care report behind it, and a
// report belongs to a person rather than to a truck: "MEDIC 3 wrote it" is not
// an answer a supervisor can chase up two weeks later, because by then that
// medic has been worked by half a dozen people. Both seats ran the call, so
// which of the two is writing it is something only the crew can say — and the
// moment they can still say it is while the call is in front of them, not after
// the board has let go of it.
//
// So the last step of the timeline is the one that asks. The crew can name the
// author at any point from the moment the call is theirs, and they cannot go
// back in service until they have: a call closes with a name against its PCR or
// it does not close. That last step is the same gate the two billing codes hang
// off — see CLOSEOUT_REQUIREMENTS below — so the key lives here as the shared
// name for "the step that ends the call".
export const CLOSEOUT_STEP_KEY = "backInService";
export const PCR_SEATS = ["alpha", "bravo"];

// The author recorded on a call, or null. A half-written record — a seat with no
// name behind it — counts as no author rather than as one nobody can read.
export function pcrAuthorOf(req) {
  const a = req && req.pcrAuthor;
  if (!a || !a.seat || !a.name) return null;
  return a;
}

// The names the crew can pick between: whoever is holding this unit's two seats.
// The crew member doing the picking is always one of them — a tablet whose copy
// of the unit hasn't caught up with the seat they are sitting in still offers
// them their own name rather than an empty list.
export function pcrAuthorChoices(unit, session) {
  return PCR_SEATS.map((seat) => {
    const person = unit ? unit[seat] : null;
    if (person && person.name) return { seat, name: person.name, accountId: person.accountId || null };
    if (session && session.role === "team" && session.slot === seat && session.name) {
      return { seat, name: session.name, accountId: session.accountId || null };
    }
    return null;
  }).filter(Boolean);
}

// "Alpha — R. Chen": the way the crew and the desk read it on the call itself.
export function pcrAuthorText(req) {
  const a = pcrAuthorOf(req);
  if (!a) return "";
  const seat = seatLabel(a.seat);
  return seat ? `${seat} — ${a.name}` : a.name;
}

// "R. Chen (MEDIC 3 · ALPHA)": the way the export's PCR AUTHOR column reads it,
// in the same stamp shape every other name on that sheet uses.
export function pcrAuthorStamp(req, unit) {
  const a = pcrAuthorOf(req);
  if (!a) return "";
  return crewStampText(unit ? unit.name : a.unitName || "", { name: a.name, seat: a.seat });
}