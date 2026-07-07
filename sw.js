const CACHE_NAME = "palestra-v10";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];
const scheduledRestAlerts = new Map();

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(ASSETS.map((asset) => cache.add(new Request(asset, { cache: "reload" })).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
        return Response.error();
      });
    })
  );
});

self.addEventListener("message", (event) => {
  const message = event.data || {};
  const { type, payload = {} } = message;
  if (type === "clear-rest-alert") {
    clearRestAlert(payload.tag);
    return;
  }
  if (type !== "schedule-rest-alert" || !payload.tag || !payload.endAt) return;
  clearRestAlert(payload.tag);
  const delay = Math.max(0, payload.endAt - Date.now());
  const timeoutId = setTimeout(() => {
    scheduledRestAlerts.delete(payload.tag);
    self.registration.showNotification(payload.title || "Riposo finito", {
      body: payload.body || "Riprendi l'allenamento.",
      tag: payload.tag,
      renotify: true,
      requireInteraction: true,
      vibrate: [450, 180, 450],
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      data: { url: payload.url || "./" }
    }).catch(() => {});
  }, delay);
  scheduledRestAlerts.set(payload.tag, timeoutId);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.split("#")[0] === targetUrl.split("#")[0]);
      if (existing) {
        if (existing.navigate) {
          return existing.navigate(targetUrl).then((client) => client?.focus());
        }
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

function clearRestAlert(tag) {
  if (!tag) return;
  const timeoutId = scheduledRestAlerts.get(tag);
  if (timeoutId) clearTimeout(timeoutId);
  scheduledRestAlerts.delete(tag);
  self.registration.getNotifications?.({ tag })
    .then((notifications) => notifications.forEach((notification) => notification.close()))
    .catch(() => {});
}
