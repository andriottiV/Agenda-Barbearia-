"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

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

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
const SERVICE_WORKER_URL = "/sw.js";
const BLOCKED_INSTRUCTION =
  "Abra as configuracoes do site no navegador e permita notificacoes para o HoraAi.";

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

function isSecurePushContext() {
  if (typeof window === "undefined") return false;

  return (
    window.isSecureContext ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

function getPlatform() {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return "web";
  }

  const standaloneNavigator = navigator as Navigator & {
    standalone?: boolean;
  };
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    Boolean(standaloneNavigator.standalone);

  return `${navigator.platform || "web"}${standalone ? " pwa" : ""}`;
}

function blockedMessage() {
  return "Notificacoes bloqueadas no navegador.";
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

async function authToken() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session?.access_token ?? "";
}

export function usePushNotifications(user: User | null) {
  const [currentPermission, setCurrentPermission] =
    useState<BrowserPermission>(readBrowserPermission);
  const [status, setStatus] = useState<PushStatus>(() => {
    const permission = readBrowserPermission();
    return permission === "unsupported" ? "unsupported" : permission;
  });
  const [message, setMessage] = useState("");
  const [subscriptionRegistered, setSubscriptionRegistered] = useState(false);
  const checkingRef = useRef(false);

  const diagnostics = useMemo(
    () => ({
      hasVapidPublicKey: Boolean(VAPID_PUBLIC_KEY),
      isConfigured: Boolean(VAPID_PUBLIC_KEY),
      serviceWorkerUrl: SERVICE_WORKER_URL,
    }),
    [],
  );

  const refreshPermissionState = useCallback(() => {
    const permission = readBrowserPermission();
    setCurrentPermission(permission);
    devLog("[Push Notifications] Notification.permission", permission);
    return permission;
  }, []);

  const saveSubscription = useCallback(
    async (subscription: PushSubscription): Promise<EnablePushResult> => {
      if (!user) {
        const nextMessage = "Entre na sua conta para ativar notificacoes.";
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }

      const token = await authToken();

      if (!token) {
        const nextMessage = "Sua sessao expirou. Entre novamente para ativar.";
        setStatus("error");
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }

      const response = await fetch("/api/notifications/subscribe", {
        body: JSON.stringify({
          platform: getPlatform(),
          subscription: subscription.toJSON(),
        }),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string; message?: string; success?: boolean }
        | null;

      if (!response.ok || !result?.success) {
        const nextMessage =
          result?.error || "Nao foi possivel salvar este dispositivo.";
        setStatus("error");
        setSubscriptionRegistered(false);
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }

      setCurrentPermission("granted");
      setSubscriptionRegistered(true);
      setStatus("saved");

      const nextMessage = "Notificacoes ativadas com sucesso";
      setMessage(nextMessage);
      return { ok: true, message: nextMessage };
    },
    [user],
  );

  const registerAndSaveSubscription =
    useCallback(async (): Promise<EnablePushResult> => {
      const permission = refreshPermissionState();

      if (!isPushSupported() || permission === "unsupported") {
        const nextMessage = "Este navegador nao suporta notificacoes push.";
        setStatus("unsupported");
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }

      if (permission !== "granted") {
        const nextMessage =
          permission === "denied"
            ? blockedMessage()
            : "Notificacoes ainda nao foram permitidas.";
        setStatus(permission);
        setSubscriptionRegistered(false);
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }

      if (!isSecurePushContext()) {
        const nextMessage =
          "Notificacoes push precisam de HTTPS em producao para funcionar.";
        setStatus("unsupported");
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }

      if (!VAPID_PUBLIC_KEY) {
        const nextMessage =
          "Notificacoes ainda indisponiveis. Configure NEXT_PUBLIC_VAPID_PUBLIC_KEY na Vercel e publique novamente.";
        setStatus("unconfigured");
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }

      const registration = await navigator.serviceWorker.register(
        SERVICE_WORKER_URL,
        { scope: "/", updateViaCache: "none" },
      );
      await navigator.serviceWorker.ready;

      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          userVisibleOnly: true,
        });
      }

      devLog("[Push Notifications] Subscription criada", {
        endpoint: subscription.endpoint,
      });

      return saveSubscription(subscription);
    }, [refreshPermissionState, saveSubscription]);

  const verifyPushPermission = useCallback(async (): Promise<EnablePushResult> => {
    const permission = refreshPermissionState();

    if (permission === "denied") {
      const nextMessage = blockedMessage();
      setStatus("denied");
      setSubscriptionRegistered(false);
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (permission === "default") {
      const nextMessage = "Notificacoes ainda nao foram permitidas.";
      setStatus("default");
      setSubscriptionRegistered(false);
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    setStatus("saving");
    setMessage("Salvando dispositivo para receber notificacoes...");
    return registerAndSaveSubscription();
  }, [refreshPermissionState, registerAndSaveSubscription]);

  useEffect(() => {
    function syncPermission() {
      const permission = refreshPermissionState();

      if (permission === "denied") {
        setStatus("denied");
        setSubscriptionRegistered(false);
        setMessage(blockedMessage());
      } else if (permission === "default") {
        setStatus("default");
        setSubscriptionRegistered(false);
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
        setSubscriptionRegistered(false);
        return;
      }

      checkingRef.current = true;
      setStatus("checking");
      setMessage("Verificando notificacoes neste dispositivo...");

      registerAndSaveSubscription()
        .catch((error) => {
          devError("[Push Notifications] Erro ao restaurar subscription", error);
          setSubscriptionRegistered(false);
          setStatus("error");
          setMessage(
            error instanceof Error
              ? error.message
              : "Nao foi possivel restaurar notificacoes.",
          );
        })
        .finally(() => {
          checkingRef.current = false;
        });
    }

    restorePushState();
  }, [refreshPermissionState, registerAndSaveSubscription, user]);

  const enablePushNotifications = useCallback(async (): Promise<EnablePushResult> => {
    console.info("PUBLIC_VAPID_EXISTS:", Boolean(VAPID_PUBLIC_KEY));

    if (!user) {
      const nextMessage = "Entre na sua conta para ativar notificacoes.";
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    const permission = refreshPermissionState();

    if (!isPushSupported() || permission === "unsupported") {
      const nextMessage = "Este navegador nao suporta notificacoes push.";
      setStatus("unsupported");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (permission === "denied") {
      const nextMessage = blockedMessage();
      setStatus("denied");
      setSubscriptionRegistered(false);
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (!isSecurePushContext()) {
      const nextMessage =
        "Notificacoes push precisam de HTTPS em producao para funcionar.";
      setStatus("unsupported");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (!VAPID_PUBLIC_KEY) {
      const nextMessage =
        "Notificacoes ainda indisponiveis. Configure NEXT_PUBLIC_VAPID_PUBLIC_KEY na Vercel e publique novamente.";
      setStatus("unconfigured");
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    if (permission === "default") {
      setStatus("requesting");
      setMessage("Aguardando permissao do navegador...");

      const requestedPermission = await Notification.requestPermission();
      setCurrentPermission(requestedPermission);

      if (requestedPermission !== "granted") {
        const nextMessage =
          requestedPermission === "denied"
            ? blockedMessage()
            : "Permissao de notificacao nao foi concedida.";
        setStatus(requestedPermission);
        setSubscriptionRegistered(false);
        setMessage(nextMessage);
        return { ok: false, message: nextMessage };
      }
    }

    setStatus("saving");
    setMessage("Salvando dispositivo para receber notificacoes...");
    return registerAndSaveSubscription();
  }, [refreshPermissionState, registerAndSaveSubscription, user]);

  const sendTestNotification = useCallback(async (): Promise<EnablePushResult> => {
    if (!user) {
      const nextMessage = "Entre na sua conta para enviar um teste.";
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    const token = await authToken();

    if (!token) {
      const nextMessage = "Sua sessao expirou. Entre novamente para testar.";
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    const response = await fetch("/api/notifications/send", {
      body: JSON.stringify({
        body: "Notificacoes push estao funcionando neste dispositivo.",
        link: "/dashboard",
        title: "Teste HoraAi",
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    const result = (await response.json().catch(() => null)) as
      | { error?: string; success?: boolean }
      | null;

    if (!response.ok || !result?.success) {
      const nextMessage =
        result?.error || "Nao foi possivel enviar notificacao de teste.";
      setMessage(nextMessage);
      return { ok: false, message: nextMessage };
    }

    const nextMessage = "Notificacao de teste enviada.";
    setMessage(nextMessage);
    return { ok: true, message: nextMessage };
  }, [user]);

  const buttonLabel = useMemo(() => {
    if (status === "checking") return "Verificando...";
    if (status === "requesting") return "Aguardando permissao...";
    if (status === "saving") return "Ativando...";
    if (currentPermission === "denied") return "Bloqueadas no navegador";
    if (currentPermission === "granted" && subscriptionRegistered) {
      return "Notificacoes ativadas";
    }
    if (currentPermission === "granted" && !subscriptionRegistered) {
      return "Concluir ativacao";
    }
    return "Ativar notificacoes";
  }, [currentPermission, status, subscriptionRegistered]);

  const isBlocked = currentPermission === "denied";
  const canClickPrimary =
    !["checking", "requesting", "saving", "saved", "unsupported"].includes(
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
    sendTestNotification,
    showTestButton: currentPermission === "granted" && subscriptionRegistered,
    status,
    verifyPushPermission,
  };
}
