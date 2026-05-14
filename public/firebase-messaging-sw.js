importScripts("https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js");

const firebaseConfig = {
  "apiKey": "",
  "authDomain": "",
  "projectId": "",
  "messagingSenderId": "",
  "appId": ""
};
const isConfigured = Object.values(firebaseConfig).every(Boolean);

if (isConfigured) {
  firebase.initializeApp(firebaseConfig);

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const notification = payload.notification || {};
    const data = payload.data || {};
    const title = notification.title || data.title || "Novo agendamento";
    const options = {
      body: notification.body || data.body || "Voce tem uma nova atualizacao.",
      data: {
        url: data.url || "/dashboard",
      },
      icon: data.icon || "/icon-192.png?v=3",
      badge: data.badge || "/icon-192.png?v=3",
    };

    self.registration.showNotification(title, options);
  });
}

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
