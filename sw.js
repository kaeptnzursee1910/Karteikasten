// Service Worker: hält die App-Dateien für die Nutzung ohne Netz bereit.
// Bei Änderungen an App-Dateien CACHE hochzählen.
const CACHE = "karteikasten-v3";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/app.js", "js/ai.js", "js/docs.js", "js/store.js",
  "icons/icon.svg", "icons/icon-192.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Nur eigene GET-Anfragen; nie den Proxy zum Modellserver
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/ki/")) return;
  // Netz zuerst, damit Updates sofort ankommen; ohne Netz aus dem Cache
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});
