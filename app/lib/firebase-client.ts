"use client";

import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getMessaging, isSupported, type Messaging } from "firebase/messaging";

function cleanEnvValue(value: string | undefined) {
  return value?.trim().replace(/^["']|["']$/g, "");
}

const firebaseConfig: FirebaseOptions = {
  apiKey: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
  authDomain: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
  projectId: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
  messagingSenderId: cleanEnvValue(
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  ),
  appId: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
};

const firebaseVapidKey = cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY);

export function getFirebaseClientDiagnostics() {
  return {
    hasApiKey: Boolean(firebaseConfig.apiKey),
    hasAuthDomain: Boolean(firebaseConfig.authDomain),
    hasProjectId: Boolean(firebaseConfig.projectId),
    hasMessagingSenderId: Boolean(firebaseConfig.messagingSenderId),
    hasAppId: Boolean(firebaseConfig.appId),
    hasVapidKey: Boolean(firebaseVapidKey),
    isConfigured: isFirebaseMessagingConfigured(),
  };
}

export function isFirebaseMessagingConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.messagingSenderId &&
      firebaseConfig.appId &&
      firebaseVapidKey,
  );
}

export function getFirebaseVapidKey() {
  return firebaseVapidKey ?? "";
}

export function getFirebaseMessagingServiceWorkerUrl() {
  const params = new URLSearchParams();

  Object.entries(firebaseConfig).forEach(([key, value]) => {
    if (value) params.set(key, String(value));
  });

  return `/firebase-messaging-sw.js?${params.toString()}`;
}

export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (typeof window === "undefined" || !isFirebaseMessagingConfigured()) {
    return null;
  }

  const supported = await isSupported().catch(() => false);

  if (!supported) {
    return null;
  }

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

  return getMessaging(app);
}
