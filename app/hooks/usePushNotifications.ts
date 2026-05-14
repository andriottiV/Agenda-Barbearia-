"use client";

import { useCallback, useMemo, useState } from "react";
import { getToken } from "firebase/messaging";
import type { User } from "@supabase/supabase-js";
import {
  getFirebaseClientDiagnostics,
  getFirebaseMessaging,
  getFirebaseMessagingServiceWorkerUrl,
  getFirebaseVapidKey,
  isFirebaseMessagingConfigured,
} from "../lib/firebase-client";
import { supabase } from "../lib/supabase";
import { friendlySupabaseError } from "../lib/supabase-errors";

type PushPermission = NotificationPermission | "unsupported" | "unconfigured";
type PushStatus = PushPermission | "saving" | "saved" | "error";

type EnablePushResult = {
  ok: boolean;
  message: string;
};

function getInitialPermission(): PushPermission {
  if (typeof window === "undefined") {
    return "default";
  }

  if (!("Notification" in window)) {
    return "unsupported";
  }

  if (!isFirebaseMessagingConfigured()) {
    return "unconfigured";
  }

  return Notification.permission;
}

function getPlatform() {
  if (typeof navigator === "undefined") {
    return "web";
  }

  const platform = navigator.platform || "web";
  const standaloneNavigator = navigator as Navigator & {
    standalone?: boolean;
  };
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    Boolean(standaloneNavigator.standalone);

  return standalone ? `${platform} pwa` : platform;
}

export function usePushNotifications(user: User | null) {
  const [status, setStatus] = useState<PushStatus>(getInitialPermission);
  const [message, setMessage] = useState("");

  const diagnostics = useMemo(() => getFirebaseClientDiagnostics(), []);

  const enablePushNotifications = useCallback(async (): Promise<EnablePushResult> => {
    if (!user) {
      const nextMessage = "Entre na sua conta para ativar notificações.";
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (typeof window === "undefined" || !("Notification" in window)) {
      const nextMessage = "Este navegador não suporta notificações push.";
      setStatus("unsupported");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (!("serviceWorker" in navigator)) {
      const nextMessage = "Este navegador nao suporta service worker.";
      setStatus("unsupported");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (!isFirebaseMessagingConfigured()) {
      const nextMessage =
        "Configure as variáveis públicas do Firebase antes de ativar notificações.";
      setStatus("unconfigured");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    const permission = await Notification.requestPermission();
    setStatus(permission);

    if (permission !== "granted") {
      const nextMessage = "Permissão de notificação não foi concedida.";
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    setStatus("saving");

    try {
      const registration = await navigator.serviceWorker.register(
        getFirebaseMessagingServiceWorkerUrl(),
        {
          scope: "/",
          updateViaCache: "none",
        },
      );

      const messaging = await getFirebaseMessaging();

      if (!messaging) {
        const nextMessage = "Firebase Messaging nao esta disponivel neste navegador.";
        setStatus("unsupported");
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }

      const token = await getToken(messaging, {
        vapidKey: getFirebaseVapidKey(),
        serviceWorkerRegistration: registration,
      });

      if (!token) {
        const nextMessage = "Não foi possível gerar o token de notificação.";
        setStatus("error");
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }

      const now = new Date().toISOString();
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          fcm_token: token,
          platform: getPlatform(),
          updated_at: now,
        },
        { onConflict: "fcm_token" },
      );

      if (error) {
        const nextMessage = friendlySupabaseError(error);
        setStatus("error");
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }

      const nextMessage = "Notificações ativadas neste dispositivo.";
      setStatus("saved");
      setMessage(nextMessage);
      return { ok: true, message: nextMessage };
    } catch (error) {
      const nextMessage =
        error instanceof Error
          ? error.message
          : "Não foi possível ativar notificações.";

      setStatus("error");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }
  }, [user]);

  const buttonLabel = useMemo(() => {
    if (status === "saving") return "Ativando...";
    if (status === "saved" || status === "granted") return "Notificações ativas";
    return "Ativar notificações";
  }, [status]);

  return {
    buttonLabel,
    diagnostics,
    enablePushNotifications,
    isConfigured: diagnostics.isConfigured,
    isDisabled:
      status === "saving" ||
      status === "saved" ||
      status === "unsupported" ||
      status === "unconfigured",
    isLoading: status === "saving",
    message,
    status,
  };
}
