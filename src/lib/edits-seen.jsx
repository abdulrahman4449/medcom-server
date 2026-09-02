// Which desk edits this DEVICE has shown the crew and had acknowledged, per
// call. Local on purpose: "seen" is a fact about this phone's screen, not
// about the call. Capped so a year of calls does not accumulate.
const KEY = "ems:callEditsSeen";
const CAP = 60;

function readAll() {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
}

export function readEditsSeen(reqId) {
  const m = readAll();
  return Number(m[reqId] || 0) || 0;
}

export function markEditsSeen(reqId, ts) {
  try {
    const m = readAll();
    m[reqId] = ts;
    const keys = Object.keys(m);
    if (keys.length > CAP) {
      keys.sort((a, b) => m[a] - m[b]).slice(0, keys.length - CAP).forEach((k) => delete m[k]);
    }
    window.localStorage.setItem(KEY, JSON.stringify(m));
  } catch (e) {
    /* a full or blocked store must never break the card */
  }
}
