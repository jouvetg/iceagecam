// Keeps the page and its data on the headset, so it also opens without network (the film is cached by app.js).
const CACHE = "stm-model-v3";
const FILES = ["./", "index.html", "app.js", "manifest.webmanifest", "icon.png", "terrain.bin", "heights.json",
  "film_years.json", "vendor/three.module.js", "vendor/OrbitControls.js"];
self.addEventListener("install", (e) => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  await c.addAll(FILES);                                  // the relief parts are cached by app.js (stm-relief-v1)
  await self.skipWaiting();
})()));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("stm-model-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.endsWith(".mp4") || url.pathname.endsWith(".bin.gz")) return;
  // network first (updates arrive when online), cache when offline
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
