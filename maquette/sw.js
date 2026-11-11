// Keeps the page and its files on the headset, so it also opens without network (the film is cached by app.js).
const CACHE = "stm-model-v1";
const FILES = ["./", "index.html", "app.js", "manifest.webmanifest", "icon.png", "terrain.bin",
  "vendor/three.module.js", "vendor/OrbitControls.js"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("stm-model-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.endsWith(".mp4")) return;
  // network first (updates arrive when online), cache when offline
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
