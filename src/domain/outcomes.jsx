
// ---------- outcome: responded but nobody was moved ----------
//
// A crew can run the whole call and still not transport anyone: they reach the
// bedside and the patient refuses the transfer. The response itself happened —
// the truck rolled, the team assessed, the time was spent — so the call is not
// cancelled and it is not a normal transfer either. The crew mark the refusal
// on the call and then finish the timeline exactly as they always do, and the
// call carries this stamp from that point on, on the board, in the history and
// in the export.
export const NO_TRANSPORT = {
  label: "AMBULANCE RESPONDED — NO TRANSPORT",
  short: "NO TRANSPORT",
  color: "#D97706",
};

// The refusal's own time stamp. It lives alongside the TIME_STEPS stamps in
// `req.times` but isn't one of them: it doesn't move the call to another status
// and doesn't replace any of the steps the crew still have to record.
export const REFUSAL_TIME_KEY = "refusedTransfer";
export const REFUSAL_TIME_LABEL = "Patient Refused Transfer";

// The earliest point a refusal can be recorded: the crew have to have reached
// the patient to be told by them. Before arrival there is nobody to refuse.
export const REFUSAL_FROM_STATUSES = ["onscene", "transporting", "arrived"];