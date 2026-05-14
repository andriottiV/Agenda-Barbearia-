"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type PushStatus =
  | PushPermission
  | "checking"
  | "requesting"
  | "saving"
  | "saved"
  | "error";

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

function isSecurePushContext() {
  if (typeof window === "undefined") return false;

  return (
    window.isSecureContext ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

function permissionBlockedMessage() {
  return "Permissão bloqueada. Libere as notificações nas configurações do navegador e tente novamente.";
}

export function usePushNotifications(user: User | null) {
  const [status, setStatus] = useState<PushStatus>(getInitialPermission);
  const [message, setMessage] = useState("");
  const [tokenRegistered, setTokenRegistered] = useState(false);
  const checkingRef = useRef(false);

  const diagnostics = useMemo(() => getFirebaseClientDiagnostics(), []);

  const saveToken = useCallback(
    async (token: string): Promise<EnablePushResult> => {
      if (!user) {
        const nextMessage = "Entre na sua conta para ativar notificações.";
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
        console.error("[Push Notifications] Erro ao salvar token FCM", error);
        setStatus("error");
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }

      setTokenRegistered(true);
      setStatus("saved");
      const nextMessage = "Notificações ativadas neste dispositivo.";
      setMessage(nextMessage);
      return { ok: true, message: nextMessage };
    },
    [user],
  );

  const registerAndSaveToken = useCallback(async (): Promise<EnablePushResult> => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      const nextMessage = "Este navegador não suporta notificações push.";
      setStatus("unsupported");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (!("serviceWorker" in navigator)) {
      const nextMessage = "Este navegador não suporta service worker.";
      setStatus("unsupported");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (!isSecurePushContext()) {
      const nextMessage =
        "Notificações push precisam de HTTPS em produção para funcionar.";
      setStatus("unsupported");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    const registration = await navigator.serviceWorker.register(
      getFirebaseMessagingServiceWorkerUrl(),
      {
        scope: "/",
        updateViaCache: "none",
      },
    );

    const messaging = await getFirebaseMessaging();

    if (!messaging) {
      const nextMessage = "Firebase Messaging não está disponível neste navegador.";
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

    return saveToken(token);
  }, [saveToken]);

  useEffect(() => {
    if (!user || checkingRef.current) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    async function restorePushState() {
      await Promise.resolve();

      if (!isFirebaseMessagingConfigured()) {
        setStatus("unconfigured");
        setTokenRegistered(false);
        return;
      }

      if (Notification.permission !== "granted") {
        setStatus(Notification.permission);
        setTokenRegistered(false);
        if (Notification.permission === "denied") {
          setMessage(permissionBlockedMessage());
        }
        return;
      }

      checkingRef.current = true;
      setStatus("checking");
      setMessage("Verificando notificações neste dispositivo...");

      registerAndSaveToken()
        .catch((error) => {
          console.error("[Push Notifications] Erro ao restaurar token FCM", error);
          setTokenRegistered(false);
          setStatus("error");
          setMessage(
            error instanceof Error
              ? error.message
              : "Não foi possível restaurar notificações.",
          );
        })
        .finally(() => {
          checkingRef.current = false;
        });
    }

    restorePushState();
  }, [registerAndSaveToken, user]);

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

    if (Notification.permission === "denied") {
      const nextMessage = permissionBlockedMessage();
      setStatus("denied");
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

    setStatus("requesting");
    setMessage("Aguardando permissão do navegador...");

    const permission = await Notification.requestPermission();
    setStatus(permission);

    if (permission !== "granted") {
      const nextMessage =
        permission === "denied"
          ? permissionBlockedMessage()
          : "Permissão de notificação não foi concedida.";
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    setStatus("saving");
    setMessage("Salvando dispositivo para receber notificações...");

    try {
      return await registerAndSaveToken();
    } catch (error) {
      console.error("[Push Notifications] Erro ao ativar notificações", error);
      const nextMessage =
        error instanceof Error
          ? error.message
          : "Não foi possível ativar notificações.";

      setStatus("error");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }
  }, [registerAndSaveToken, user]);

  const buttonLabel = useMemo(() => {
    if (status === "checking") return "Verificando...";
    if (status === "requesting") return "Aguardando permissão...";
    if (status === "saving") return "Ativando...";
    if (status === "saved" || tokenRegistered) return "Notificações ativadas";
    if (status === "denied") return "Permissão bloqueada";
    return "Ativar notificações";
  }, [status, tokenRegistered]);

  return {
    buttonLabel,
    diagnostics,
    enablePushNotifications,
    isConfigured: diagnostics.isConfigured,
    isDisabled:
      status === "checking" ||
      status === "requesting" ||
      status === "saving" ||
      status === "saved" ||
      status === "unsupported" ||
      status === "unconfigured",
    isLoading:
      status === "checking" || status === "requesting" || status === "saving",
    message,
    status,
  };
}
