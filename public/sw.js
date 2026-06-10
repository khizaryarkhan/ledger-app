// Kill-switch service worker.
//
// Prime Accountax does not use a service worker. This file exists only to
// neutralise an ORPHANED service worker that a previous site/template left on
// some visitors' devices (it was intercepting requests and serving its own
// cached "This Page Does Not Exist" 404).
//
// When a browser that still has the old SW registered re-checks /sw.js (which
// it does on navigation / every 24h), it receives this script instead, installs
// it, and on activation we wipe all caches, unregister ourselves, and reload any
// open tabs so they load the real app straight from the network.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {
        /* ignore */
      }
      try {
        await self.registration.unregister();
      } catch (e) {
        /* ignore */
      }
      try {
        const clients = await self.clients.matchAll({ type: "window" });
        for (const client of clients) {
          client.navigate(client.url);
        }
      } catch (e) {
        /* ignore */
      }
    })()
  );
});

// No fetch handler — all requests go straight to the network.
