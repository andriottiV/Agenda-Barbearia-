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

type BrowserPermission = NotificationPermission | "unsupported";
type PushStatus =
  | "checking"
  | "default"
  | "denied"
  | "error"
  | "granted"
  | "requesting"
  | "saved"
  | "saving"
  | "unconfigured"
  | "unsupported";

type EnablePushResult = {
  ok: boolean;
  message: string;
};

const BLOCKED_INSTRUCTION =
  "Clique no cadeado ao lado do endereço do site e permita notificações.";

function devLog(message: string, payload?: unknown) {
  if (process.env.NODE_ENV !== "production") {
    console.info(message, payload ?? "");
  }
}

function devError(message: string, error: unknown) {
  if (process.env.NODE_ENV !== "production") {
    console.error(message, error);
  }
}

function readBrowserPermission(): BrowserPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }

  return Notification.permission;
}

function getPlatform() {
  if (typeof navigator === "undefined") return "web";

  const standaloneNavigator = navigator as Navigator & {
    standalone?: boolean;
  };
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    Boolean(standaloneNavigator.standalone);

  return `${navigator.platform || "web"}${standalone ? " pwa" : ""}`;
}

function isSecurePushContext() {
  if (typeof window === "undefined") return false;

  return (
    window.isSecureContext ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

function blockedMessage() {
  return "Notificações bloqueadas no navegador.";
}

export function usePushNotifications(user: User | null) {
  const [currentPermission, setCurrentPermission] =
    useState<BrowserPermission>(readBrowserPermission);
  const [status, setStatus] = useState<PushStatus>(() => {
    if (!isFirebaseMessagingConfigured()) return "unconfigured";
    const permission = readBrowserPermission();
    return permission === "unsupported" ? "unsupported" : permission;
  });
  const [message, setMessage] = useState("");
  const [tokenRegistered, setTokenRegistered] = useState(false);
  const checkingRef = useRef(false);

  const diagnostics = useMemo(() => getFirebaseClientDiagnostics(), []);

  const refreshPermissionState = useCallback(() => {
    const permission = readBrowserPermission();
    setCurrentPermission(permission);
    devLog("[Push Notifications] Notification.permission", permission);
    return permission;
  }, []);

  const saveToken = useCallback(
    async (token: string): Promise<EnablePushResult> => {
      if (!user) {
        const nextMessage = "Entre na sua conta para ativar notificações.";
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }

      const { data, error } = await supabase
        .from("push_subscriptions")
        .upsert(
          {
            user_id: user.id,
            fcm_token: token,
            platform: getPlatform(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "fcm_token" },
        )
        .select("id, user_id, platform, updated_at")
        .maybeSingle();

      devLog("[Push Notifications] Resposta ao salvar token no Supabase", {
        data,
        error,
      });

      if (error) {
        const nextMessage = friendlySupabaseError(error);
        devError("[Push Notifications] Erro ao salvar token FCM", error);
        setStatus("error");
        setTokenRegistered(false);
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }

      setCurrentPermission("granted");
      setTokenRegistered(true);
      setStatus("saved");

      const nextMessage = "Notificações ativadas neste dispositivo.";
      setMessage(nextMessage);
      return { ok: true, message: nextMessage };
    },
    [user],
  );

  const registerAndSaveToken = useCallback(async (): Promise<EnablePushResult> => {
    const permission = refreshPermissionState();

    if (permission === "unsupported") {
      const nextMessage = "Este navegador não suporta notificações push.";
      setStatus("unsupported");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (permission !== "granted") {
      const nextMessage =
        permission === "denied"
          ? blockedMessage()
          : "Notificações ainda não foram permitidas.";
      setStatus(permission);
      setTokenRegistered(false);
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    const hasServiceWorker = "serviceWorker" in navigator;
    devLog("[Push Notifications] serviceWorker existe", hasServiceWorker);

    if (!hasServiceWorker) {
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

    if (!isFirebaseMessagingConfigured()) {
      const nextMessage =
        diagnostics.hasVapidKey
          ? "Configuração pública do Firebase incompleta."
          : "Chave Web Push não configurada.";
      setStatus("unconfigured");
      setMessage(nextMessage);
      devLog("[Push Notifications] Diagnóstico Firebase", diagnostics);
      return { ok: false, message: nextMessage };
    }

    devLog("[Push Notifications] VAPID KEY existe", diagnostics.hasVapidKey);

    const swResponse = await fetch("/firebase-messaging-sw.js", {
      cache: "no-store",
    }).catch((error) => {
      devError("[Push Notifications] Erro ao acessar service worker", error);
      return null;
    });

    if (!swResponse?.ok) {
      const nextMessage = "Arquivo de notificações não encontrado no servidor.";
      setStatus("error");
      setMessage(nextMessage);
      devError("[Push Notifications] Service worker inacessível", {
        status: swResponse?.status ?? null,
      });
      return { ok: false, message: nextMessage };
    }

    const registration = await navigator.serviceWorker.register(
      getFirebaseMessagingServiceWorkerUrl(),
      { scope: "/", updateViaCache: "none" },
    );

    devLog("[Push Notifications] Service worker registrado", {
      scope: registration.scope,
    });

    const messaging = await getFirebaseMessaging();
    devLog("[Push Notifications] Firebase app/messaging inicializado", Boolean(messaging));

    if (!messaging) {
      const nextMessage = "Firebase Messaging não está disponível neste navegador.";
      setStatus("unsupported");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    let token = "";

    try {
      token = await getToken(messaging, {
        vapidKey: getFirebaseVapidKey(),
        serviceWorkerRegistration: registration,
      });
      devLog("[Push Notifications] Resultado do getToken()", {
        hasToken: Boolean(token),
        tokenLength: token.length,
      });
    } catch (error) {
      const nextMessage =
        "Permissão liberada, mas não foi possível registrar o dispositivo.";
      devError("[Push Notifications] Erro ao gerar token FCM", error);
      setStatus("error");
      setTokenRegistered(false);
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (!token) {
      const nextMessage =
        "Permissão liberada, mas não foi possível registrar o dispositivo.";
      devError("[Push Notifications] Token FCM vazio", new Error(nextMessage));
      setStatus("error");
      setTokenRegistered(false);
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    return saveToken(token);
  }, [diagnostics, refreshPermissionState, saveToken]);

  const verifyPushPermission = useCallback(async (): Promise<EnablePushResult> => {
    const permission = refreshPermissionState();

    if (permission === "denied") {
      const nextMessage = blockedMessage();
      setStatus("denied");
      setTokenRegistered(false);
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (permission === "default") {
      const nextMessage = "Notificações ainda não foram permitidas.";
      setStatus("default");
      setTokenRegistered(false);
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    setStatus("saving");
    setMessage("Salvando dispositivo para receber notificações...");
    return registerAndSaveToken();
  }, [refreshPermissionState, registerAndSaveToken]);

  useEffect(() => {
    function syncPermission() {
      const permission = refreshPermissionState();

      if (permission === "denied") {
        setStatus("denied");
        setTokenRegistered(false);
        setMessage(blockedMessage());
      } else if (permission === "default") {
        setStatus("default");
        setTokenRegistered(false);
      }
    }

    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", syncPermission);

    return () => {
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", syncPermission);
    };
  }, [refreshPermissionState]);

  useEffect(() => {
    if (!user || checkingRef.current) return;

    async function restorePushState() {
      await Promise.resolve();

      const permission = refreshPermissionState();

      if (permission !== "granted") {
        if (permission === "denied") {
          setStatus("denied");
          setMessage(blockedMessage());
        } else {
          setStatus(permission);
        }
        setTokenRegistered(false);
        return;
      }

      checkingRef.current = true;
      setStatus("checking");
      setMessage("Verificando notificações neste dispositivo...");

      registerAndSaveToken()
        .catch((error) => {
          devError("[Push Notifications] Erro ao restaurar token FCM", error);
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
  }, [refreshPermissionState, registerAndSaveToken, user]);

  const enablePushNotifications = useCallback(async (): Promise<EnablePushResult> => {
    if (!user) {
      const nextMessage = "Entre na sua conta para ativar notificações.";
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    const permission = refreshPermissionState();

    if (permission === "unsupported") {
      const nextMessage = "Este navegador não suporta notificações push.";
      setStatus("unsupported");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (permission === "denied") {
      const nextMessage = blockedMessage();
      setStatus("denied");
      setTokenRegistered(false);
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (!isFirebaseMessagingConfigured()) {
      const nextMessage =
        diagnostics.hasVapidKey
          ? "Configuração pública do Firebase incompleta."
          : "Chave Web Push não configurada.";
      setStatus("unconfigured");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (permission === "default") {
      setStatus("requesting");
      setMessage("Aguardando permissão do navegador...");

      const requestedPermission = await Notification.requestPermission();
      devLog(
        "[Push Notifications] Permissão após requestPermission",
        requestedPermission,
      );
      setCurrentPermission(requestedPermission);

      if (requestedPermission !== "granted") {
        const nextMessage =
          requestedPermission === "denied"
            ? blockedMessage()
            : "Permissão de notificação não foi concedida.";
        setStatus(requestedPermission);
        setTokenRegistered(false);
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }
    }

    setStatus("saving");
    setMessage("Salvando dispositivo para receber notificações...");
    return registerAndSaveToken();
  }, [diagnostics.hasVapidKey, refreshPermissionState, registerAndSaveToken, user]);

  const buttonLabel = useMemo(() => {
    if (status === "checking") return "Verificando...";
    if (status === "requesting") return "Aguardando permissão...";
    if (status === "saving") return "Ativando...";
    if (currentPermission === "denied") return "Bloqueadas no navegador";
    if (currentPermission === "granted" && tokenRegistered) {
      return "Notificações ativadas";
    }
    if (currentPermission === "granted" && !tokenRegistered) {
      return "Concluir ativação";
    }
    return "Ativar notificações";
  }, [currentPermission, status, tokenRegistered]);

  const isBlocked = currentPermission === "denied";
  const canClickPrimary =
    !["checking", "requesting", "saving", "saved", "unsupported", "unconfigured"].includes(
      status,
    ) && !isBlocked;

  return {
    blockedInstruction: BLOCKED_INSTRUCTION,
    buttonLabel,
    diagnostics,
    enablePushNotifications,
    isBlocked,
    isConfigured: diagnostics.isConfigured,
    isDisabled: !canClickPrimary,
    isLoading:
      status === "checking" || status === "requesting" || status === "saving",
    message,
    status,
    verifyPushPermission,
  };
}
