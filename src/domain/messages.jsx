import { callRoute } from "./call-locations.jsx";
import { stationOf } from "./live-sheet.jsx";
import { uhuWindowStart } from "./uhu.jsx";
import { gregFmt, stopNativeAlarm } from "../lib/dates.jsx";
import { uid } from "../lib/helpers.jsx";
import { CALL_ALERT_TAG, ESCALATION_ALERT_TAG_PREFIX, alertWorker, alertsSupported, directNotification, setDirectNotification } from "../lib/notify.jsx";
import { readKey, writeList } from "../lib/offline-queue.jsx";

// ---------- messages between a truck and the desk ----------
//
// Everything a crew and the desk needed to say to each other went over the
// radio or not at all. The radio is the right tool for "we are on scene" and
// the wrong one for "which entrance", "the lift is out", "the ward says the
// patient is not ready" — questions that are not urgent, that nobody wants to
// broadcast to every truck in the department, and that are worth having written
// down afterwards.
//
// One thread per truck. Not per person: the crew changes over mid-shift and
// the conversation is about the vehicle and its calls, so a question asked by
// the crew who went off at seven is still there for the crew who came on, and
// the desk does not have to work out who they are talking to.
export const MESSAGES_KEY = "ems:messages";
// A shift's traffic is tens of lines, not thousands. This is generous, and it
// stops a year of chat from being sent up and down with every write.
export const MESSAGES_CAP = 800;
export const MESSAGE_MAX = 600;
export const CHAT_ALERT_TAG_PREFIX = "ems-chat-";

// One shift's traffic, not the truck's whole history.
//
// A thread belongs to the vehicle, so with no window on it a crew coming on at
// seven opened the box and read yesterday's conversation about a patient they
// never met. What is useful is what has been said since this shift started;
// anything older is finished business and lives in the log.
export function threadFor(messages, unitId, from) {
  const cutoff = typeof from === "number" ? from : uhuWindowStart(Date.now());
  return (messages || [])
    .filter((m) => m && m.unitId === unitId && (m.ts || 0) >= cutoff)
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

// What this device has already seen, held locally rather than on the board.
//
// Read receipts written into the shared store would mean every tablet writing
// the whole message list back on every glance — a lot of traffic, and a lot of
// chances for two devices to overwrite each other — to answer a question that
// is only ever about this screen. So each device remembers for itself.
export const CHAT_SEEN_KEY = "ems:chatSeen";

export function readChatSeen() {
  try {
    return JSON.parse(window.localStorage.getItem(CHAT_SEEN_KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
}

export function markThreadSeen(unitId, ts) {
  if (!unitId) return;
  try {
    const seen = readChatSeen();
    if ((seen[unitId] || 0) >= ts) return;
    seen[unitId] = ts;
    window.localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify(seen));
  } catch (e) {
    // a device that cannot remember simply shows everything as unread
  }
}

export function unreadIn(messages, unitId, mine, from) {
  const seen = readChatSeen()[unitId] || 0;
  const cutoff = typeof from === "number" ? from : uhuWindowStart(Date.now());
  return (messages || []).filter(
    (m) =>
      m && m.unitId === unitId && (m.ts || 0) >= cutoff && (m.ts || 0) > seen && m.from !== mine
  ).length;
}

export function unreadForRole(messages, units, station, mine, myUnitId) {
  const from = uhuWindowStart(Date.now());
  const list = myUnitId
    ? (units || []).filter((u) => u.id === myUnitId)
    : (units || []).filter((u) => !station || stationOf(u) === station);
  return list.reduce((n, u) => n + unreadIn(messages, u.id, mine, from), 0);
}

export async function postMessage({ unit, from, byName, byAccountId, text, station }) {
  const body = String(text || "").trim().slice(0, MESSAGE_MAX);
  if (!body || !unit) return false;
  const entry = {
    id: uid("msg"),
    ts: Date.now(),
    station: station || stationOf(unit),
    unitId: unit.id,
    unitName: unit.name || "",
    from,
    byName: byName || "",
    byAccountId: byAccountId || null,
    text: body,
  };
  const existing = (await readKey(MESSAGES_KEY, [])) || [];
  // Newest last in the thread, but the cap trims the oldest.
  const next = [...existing, entry].slice(-MESSAGES_CAP);
  // writeList, not writeKey.
  //
  // writeKey posts and gives up. Only writeList queues what did not land, so a
  // message typed in a lift or a basement — which is most of where this will be
  // typed — went nowhere at all, while the comment here claimed the opposite.
  // Now it is held on the device and drains on the next poll with signal, like
  // every other record on the board.
  await writeList(MESSAGES_KEY, next, existing);
  return next;
}

export function notifyMessage(msg) {
  try {
    if (!alertsSupported() || Notification.permission !== "granted") return;
    const who = msg.from === "crew" ? msg.unitName || "A team" : msg.byName || "Dispatch";
    const title = `${who} — message`;
    const options = {
      body: msg.text,
      // Tagged per thread, so a run of messages from one truck replaces itself
      // rather than burying the screen. The count is in the app.
      tag: `${CHAT_ALERT_TAG_PREFIX}${msg.unitId}`,
      renotify: true,
      requireInteraction: false,
    };
    if (alertWorker && alertWorker.showNotification) {
      const shown = alertWorker.showNotification(title, options);
      if (shown && typeof shown.catch === "function") shown.catch(() => {});
      return;
    }
    const n = new Notification(title, options);
    n.onclick = () => {
      try {
        window.focus();
        n.close();
      } catch (e) {}
    };
  } catch (e) {
    // ignore
  }
}

export function notifyEscalation(request, esc) {
  try {
    if (!alertsSupported() || Notification.permission !== "granted") return;
    const title = `ISSUE ESCALATED — ${(esc && esc.unitName) || "a team"}`;
    const options = {
      body: `${request.nature}\n${callRoute(request)}\nOpen the admin board to read and reply.`,
      tag: `${ESCALATION_ALERT_TAG_PREFIX}${esc ? esc.id : request.id}`,
      renotify: false,
      requireInteraction: false,
    };
    if (alertWorker && alertWorker.showNotification) {
      const shown = alertWorker.showNotification(title, options);
      if (shown && typeof shown.catch === "function") shown.catch(() => {});
      return;
    }
    const n = new Notification(title, options);
    n.onclick = () => {
      try {
        window.focus();
        n.close();
      } catch (e) {
        // ignore
      }
    };
  } catch (e) {
    // ignore
  }
}


// Takes down whatever is on screen, whichever route put it there.
export function clearCallAlert() {
  // A tone playing on the native alarm stream has to be stopped there; it is
  // not a Notification and closing one does not touch it.
  stopNativeAlarm();
  try {
    if (directNotification) directNotification.close();
  } catch (e) {
    // ignore
  }
  setDirectNotification(null);
  try {
    if (alertWorker && alertWorker.getNotifications) {
      alertWorker
        .getNotifications({ tag: CALL_ALERT_TAG })
        .then((list) => {
          list.forEach((n) => {
            try {
              n.close();
            } catch (e) {
              // ignore
            }
          });
        })
        .catch(() => {});
    }
  } catch (e) {
    // ignore
  }
}

export function buzz(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (e) {
    // ignore
  }
}

export const BASE_TITLE = typeof document !== "undefined" ? document.title : "";

// Hours and minutes, 24-hour, midnight written as 00:00.
//
// Seconds are false precision on a stamp made with a thumb on a tablet, and a
// column of 14:32:07 is harder to read than 14:32. Some locales also render
// midnight as 24:00, which on a log running 07:00 to 07:00 reads as the end of
// the wrong day, so it is forced back to 00:00 wherever it appears.
export function forceMidnight(text) {
  return typeof text === "string" ? text.replace(/(^|[\s,])24:/, "$100:") : text;
}

export function clockStr(ts) {
  if (!ts) return "";
  return forceMidnight(gregFmt(ts, { hour: "2-digit", minute: "2-digit", hour12: false }));
}

export function msDurationStr(ms) {
  if (!ms || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

// Overtime is claimed, approved and paid in hours, so it is written in hours
// everywhere it appears. HH:MM:SS is the right shape for a call — a response
// time of four and a half minutes is a real thing somebody reads — but nobody
// has ever been paid 02:45:00, and a payroll clerk reading it had to do the
// division themselves. Two decimals, because a quarter of an hour is the
// smallest unit anybody argues about.
export function otHoursStr(ms) {
  const h = Math.max(0, ms || 0) / 3600000;
  return `${(Math.round(h * 100) / 100).toFixed(2)} h`;
}

export function durationStr(startTs, endTs) {
  if (!startTs || !endTs) return "";
  return msDurationStr(endTs - startTs);
}

// Compact form for badges, where HH:MM:SS is more precision than anyone needs.
export function shortDurationStr(ms) {
  if (!ms || ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}