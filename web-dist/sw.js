self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
      await self.registration.unregister();
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clients.forEach(client => client.navigate(client.url));
    })()
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(fetch(event.request));
});
