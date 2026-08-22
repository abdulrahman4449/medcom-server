import { callRoute } from "../domain/call-locations.jsx";
import { PRIORITY, priorityKeyOf } from "../domain/constants.jsx";
import { clearCallAlert } from "../domain/messages.jsx";
import { hhmm } from "../domain/shift-helpers.jsx";

// ---------- reaching the crew when the page isn't in front of them ----------
//
// The in-page overlay and the repeating tone only alert someone who is looking
// at the tab. A crew tablet is usually locked, on another app, or on another
// tab, so an assignment also has to arrive as a system notification and a buzz.
// Every one of these is best-effort: an old browser, a denied permission or an
// insecure origin must never stop the rest of the alarm from working.

export function alertsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

// The shells have no Notification API, so everything above this line is dead
// code on a phone.
//
// That is why an iPhone never showed a banner for an incoming call: the very
// first line of notifyAssignedCall asks whether notifications are supported,
// the answer on a native shell is no, and it returned. The crew got a
// full-screen alarm if they happened to be looking at the app and nothing
// whatsoever if they were not.
//
// The alarm plugin can raise one through the operating system instead. This is
// a local notification, not a push: it needs the app to be running, which while
// somebody is on duty it now is. It is looked up through window rather than
// imported so that this module stays free of the alarm module, which imports
// this one.
function alarmPlugin() {
  try {
    const cap = typeof window !== "undefined" && window.Capacitor;
    return (cap && cap.Plugins && cap.Plugins.PulseOpsAlarm) || null;
  } catch (e) {
    return null;
  }
}

export function nativeAlertsSupported() {
  const p = alarmPlugin();
  return !!(p && typeof p.notify === "function");
}

// Asked for at sign-in, which is a real tap. iOS only ever asks once; after
// that this resolves with whatever the person answered the first time.
export function requestNativeNotifications() {
  try {
    const p = alarmPlugin();
    if (!p || typeof p.requestNotifications !== "function") return;
    const asked = p.requestNotifications();
    if (asked && typeof asked.catch === "function") asked.catch(() => {});
  } catch (e) {
    // an older shell without the method
  }
}

export function nativeNotify(title, body) {
  try {
    const p = alarmPlugin();
    if (!p || typeof p.notify !== "function") return false;
    const shown = p.notify({ title: String(title || ""), body: String(body || "") });
    if (shown && typeof shown.catch === "function") shown.catch(() => {});
    return true;
  } catch (e) {
    return false;
  }
}

export const CALL_ALERT_TAG = "ems-incoming-call";
// One tag per booking, so a stack of reminders for different bookings is
// possible and none of them ever displaces the incoming-call notification.
export const SCHED_ALERT_TAG_PREFIX = "ems-booking-soon-";
// One tag per call asking for a second ambulance, for the same reason.
export const ASSIST_ALERT_TAG_PREFIX = "ems-assist-needed-";
// One tag per escalated issue, so a stack of them can sit on an admin's lock
// screen without any of them displacing a live call.
export const ESCALATION_ALERT_TAG_PREFIX = "ems-escalation-";
// The service worker registration used to raise notifications where a page
// isn't allowed to, and the plain Notification when it is. Only one of the two
// is ever in play on a given device.
export let alertWorker = null;
export let directNotification = null;
// clearCallAlert lives with the messages, not with the notification
// plumbing, so it hands the reference back through here rather than
// assigning across the boundary.
export function setDirectNotification(n) {
  directNotification = n;
}

export function registerAlertWorker() {
  try {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        alertWorker = reg;
      })
      .catch(() => {
        // no worker: fall back to page-level notifications
      });
  } catch (e) {
    // ignore
  }
}

// Browsers only grant this off the back of a real interaction, which is why it
// is asked for from the click that finishes sign-in and from the first tap on a
// session that came back from a refresh.
export function requestAlertPermission() {
  try {
    if (!alertsSupported()) return;
    if (Notification.permission === "default") {
      const result = Notification.requestPermission();
      if (result && typeof result.catch === "function") result.catch(() => {});
    }
  } catch (e) {
    // ignore
  }
}

export function notifyAssignedCall(request, unitName) {
  try {
    const priority = PRIORITY[priorityKeyOf(request)] ? PRIORITY[priorityKeyOf(request)].label : "CALL";
    const title = `${priority} — ${unitName || "your team"}`;
    // On a shell, through the operating system. This is the only banner an
    // iPhone gets, and it carries its own sound and vibration from iOS rather
    // than from the page - so it still arrives when the page's own audio has
    // been interrupted, which is the case that has been losing tones.
    if (!alertsSupported()) {
      nativeNotify(title, `${request.nature}\n${callRoute(request)}`);
      return null;
    }
    if (Notification.permission !== "granted") return null;
    const options = {
      body: `${request.nature}\n${callRoute(request)}`,
      // A crew only ever has one call at a time, so a fixed tag means a repeat
      // replaces the notification instead of stacking a pile of them up.
      tag: CALL_ALERT_TAG,
      renotify: true,
      requireInteraction: true,
    };
    // Android — and anything else that refuses `new Notification()` from a page
    // — can only raise one through a service worker registration.
    if (alertWorker && alertWorker.showNotification) {
      const shown = alertWorker.showNotification(title, options);
      if (shown && typeof shown.catch === "function") shown.catch(() => {});
      return null;
    }
    clearCallAlert();
    directNotification = new Notification(title, options);
    directNotification.onclick = () => {
      try {
        window.focus();
        directNotification.close();
      } catch (e) {
        // ignore
      }
    };
    return null;
  } catch (e) {
    return null;
  }
}

// The same delivery route, used for the quarter-hour reminder on a booking
// rather than for a call going out — so a dispatcher who has the roster on
// another tab still gets it. Deliberately unlike the call notification: its own
// tag per booking (a reminder must not replace a live call on the lock screen),
// no interaction required, and it disappears on its own.
export function notifyBookingSoon(entry, minutesOut) {
  try {
    if (!alertsSupported() || Notification.permission !== "granted") return;
    const title = `Booking due in ${minutesOut} min — ${hhmm(entry.scheduledFor)}`;
    const options = {
      body: `${entry.nature}\n${callRoute(entry)}`,
      tag: `${SCHED_ALERT_TAG_PREFIX}${entry.id}`,
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

// A crew on scene asking for a second ambulance. This one goes to the dispatch
// desk, not to a crew, and it stays on screen until someone deals with it: a
// team is standing in a room they can't clear on their own, so a notification
// that fades away by itself is no use. Its own tag per call keeps it clear of
// the incoming-call alert and of the booking reminders.
export function notifyAssistRequest(request, unitName) {
  try {
    if (!alertsSupported() || Notification.permission !== "granted") return;
    const title = `ASSISTANCE NEEDED — ${unitName || "a team"}`;
    const options = {
      body: `Second ambulance requested\n${request.nature}\n${callRoute(request)}`,
      tag: `${ASSIST_ALERT_TAG_PREFIX}${request.id}`,
      renotify: true,
      requireInteraction: true,
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