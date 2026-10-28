/* DarkKnight Messenger — static asset cache only */
const CACHE = "dk-static-v3";
const PRECACHE = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/main.js",
  "./js/app.js",
  "./js/auth.js",
  "./js/chat.js",
  "./js/profiles.js",
  "./js/supabase-client.js",
  "./js/utils.js",
  "./config.js",
  "./assets/logo.svg",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Never cache API / auth / functions / storage
  if (
    url.hostname.includes("supabase.co") ||
    req.method !== "GET" ||
    url.pathname.includes("/auth/") ||
    url.pathname.includes("/rest/") ||
    url.pathname.includes("/functions/") ||
    url.pathname.includes("/storage/")
  ) {
    return;
  }
  // Network-first for navigations
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }
  // Cache-first for same-origin static
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        });
      })
    );
  }
});
