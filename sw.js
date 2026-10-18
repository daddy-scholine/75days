/* Offline cache for 75 Days. Bump VERSION on every release so phones pick up the update. */
const VERSION = "75days-v1.2.1";
const SHELL = ["./", "index.html", "app.css", "app.js", "cloud.js", "firebase-config.js", "manifest.webmanifest", "privacy.html",
  "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];
const ROOT = new URL("./", self.location).pathname;   // e.g. "/75days/" or "/"

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const path = new URL(req.url).pathname;
  if (req.mode === "navigate") {
    // Only the app's own start page comes from the offline copy; other pages (privacy, /personal, /preview) load normally.
    if (path === ROOT || path === ROOT + "index.html") { e.respondWith(caches.match("index.html").then((r) => r || fetch(req))); return; }
    e.respondWith(fetch(req).catch(() => caches.match(req).then((r) => r || caches.match("index.html"))));
    return;
  }
  e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => {
    if (res.ok && path.startsWith(ROOT) && !path.startsWith(ROOT + "personal/") && !path.startsWith(ROOT + "preview/")) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  })));
});
