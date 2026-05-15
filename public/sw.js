self.addEventListener("push", (event) => {
  let payload = {
    body: "Voce tem uma nova atualizacao.",
    data: {
      url: "/dashboard",
    },
    icon: "/icon-192.png?v=3",
    title: "HoraAi",
  };

  if (event.data) {
    try {
      payload = {
        ...payload,
        ...event.data.json(),
      };
    } catch {
      payload.body = event.data.text();
    }
  }

  const options = {
    badge: payload.badge || "/icon-192.png?v=3",
    body: payload.body,
    data: {
      ...(payload.data || {}),
      url: payload.data?.url || payload.url || "/dashboard",
    },
    icon: payload.icon || "/icon-192.png?v=3",
    tag: payload.tag || "horaai-notification",
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    clients
      .matchAll({
        includeUncontrolled: true,
        type: "window",
      })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client && client.url.includes(url)) {
            return client.focus();
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(url);
        }

        return undefined;
      }),
  );
});
