import { CLOSEOUT_STEP_KEY, pcrAuthorOf } from "./pcr-author.jsx";
import { callTypeOf, loadedKmOf } from "./sheet-vocabulary.jsx";

// ---------- what a call has to carry before the crew can close it ----------
//
// Three facts about a finished call are only reliably knowable by the crew who
// ran it, and all three used to be chased afterwards: who is writing the report,
// what category the call was, and how far the loaded leg went. Chasing them
// afterwards is how the dispatch log ended up with empty PCR AUTHOR, CAT. OF
// CALL and KILO METER columns — by the time anyone asks, the crew have run four
// more calls and the honest answer is a guess.
//
// So the last step of the timeline asks for all three together. Any of them can
// be answered from the moment the call is the crew's, and either the desk or the
// crew can set or correct the two codes at any point; what the crew cannot do is
// go back in service while one of them is still blank. The desk's own override
// close is deliberately left alone — that is the desk taking the call off a crew
// who can no longer answer, and it is already stamped as the desk's doing.
export const CLOSEOUT_REQUIREMENTS = [
  { key: "pcrAuthor", label: "PCR author", present: (req) => !!pcrAuthorOf(req) },
  { key: "callType", label: "call type", present: (req) => !!callTypeOf(req) },
  { key: "loadedKm", label: "loaded kilometers", present: (req) => !!loadedKmOf(req) },
];

// Which of the three a call is still missing, in the order the crew's card
// draws them. An empty list means the call is ready to close.
export function closeoutMissing(req) {
  if (!req) return [];
  return CLOSEOUT_REQUIREMENTS.filter((r) => !r.present(req));
}

// The same list, but only when it is actually standing in the way: the crew are
// on the last step and one of the three is blank. Every other step of the
// timeline is unaffected — a crew clearing a scene are never held up by a
// billing code.
export function closeoutBlockers(req, step) {
  if (!req || !step || step.timeKey !== CLOSEOUT_STEP_KEY) return [];
  return closeoutMissing(req);
}

// "the PCR author, the call type and the loaded kilometers" — the missing items
// written out the way a sentence on the card needs to read them.
export function closeoutMissingText(missing) {
  const labels = (missing || []).map((m) => m.label);
  if (labels.length === 0) return "";
  if (labels.length === 1) return `the ${labels[0]}`;
  return `the ${labels.slice(0, -1).join(", the ")} and the ${labels[labels.length - 1]}`;
}