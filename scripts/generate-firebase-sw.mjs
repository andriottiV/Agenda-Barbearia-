import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function cleanEnvValue(value) {
  return value?.trim().replace(/^["']|["']$/g, "") ?? "";
}

function loadPublicFirebaseEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf8");

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) return;

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) return;

    const key = trimmed.slice(0, separatorIndex).trim();

    if (!key.startsWith("NEXT_PUBLIC_FIREBASE_")) return;

    const value = trimmed.slice(separatorIndex + 1);

    if (!process.env[key]) {
      process.env[key] = cleanEnvValue(value);
    }
  });
}

loadPublicFirebaseEnvFile(resolve(".env"));
loadPublicFirebaseEnvFile(resolve(".env.local"));

const firebaseConfig = {
  apiKey: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
  authDomain: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
  projectId: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
  messagingSenderId: cleanEnvValue(
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  ),
  appId: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
};

const missingKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingKeys.length) {
  console.warn(
    `[Firebase SW] Variaveis publicas ausentes: ${missingKeys.join(", ")}`,
  );
}

const file = `importScripts("https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js");

const firebaseConfig = ${JSON.stringify(firebaseConfig, null, 2)};
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
`;

writeFileSync(resolve("public/firebase-messaging-sw.js"), file);
console.log("[Firebase SW] public/firebase-messaging-sw.js gerado.");
