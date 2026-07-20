/* ForkCaster service worker: dose-day push notifications */
self.addEventListener("push", (e) => {
  let d = { title: "ForkCaster", body: "Dose day." };
  try { d = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(d.title || "ForkCaster", {
    body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png", tag: "forkcaster-dose",
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window" }).then((ws) => {
    for (const w of ws) { if ("focus" in w) return w.focus(); }
    return clients.openWindow("/");
  }));
});
