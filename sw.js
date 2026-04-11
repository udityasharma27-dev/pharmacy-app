const CACHE_NAME = "pharmacy-pro-v2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/app.html",
  "/checkout.html",
  "/app.css",
  "/app.js",
  "/manifest.webmanifest",
  "/qr.png"
];

function isAppShellRequest(requestUrl) {
  const pathname = requestUrl.pathname;
  return pathname === "/" || APP_SHELL.includes(pathname);
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  const isNavigation = event.request.mode === "navigate";
  const useNetworkFirst = requestUrl.origin === self.location.origin
    && (isNavigation || isAppShellRequest(requestUrl));

  event.respondWith(
    (useNetworkFirst ? fetch(event.request)
      .then(response => {
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
      : caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(response => {
          if (!response || response.status !== 200 || response.type !== "basic") return response;
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => isNavigation ? caches.match("/index.html") : null);
    }))
  );
});
