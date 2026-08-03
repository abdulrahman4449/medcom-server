// MEDCOM Dispatch — notification worker.
//
// Its only job is to raise and handle incoming-call notifications. On Android
// (and anywhere else `new Notification()` is off-limits to a page) a service
// worker registration is the only way to show one at all, which is exactly the
// case that matters here: a crew tablet with the board open behind another app.
//
// There is deliberately NO fetch handler. Nothing about the app is ever served
// from a cache, so a deploy is picked up on the next load like any other static
// file and this worker can never pin an old build in place.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Tapping the notification brings the board back to the front (or opens it
// again if it was closed) so the crew land straight on the acknowledge button.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of open) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })()
  );
});
