import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import webpush, { type PushSubscription } from "web-push";

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string | number | boolean | null | undefined>;
  icon?: string;
  link?: string;
};

type PushSubscriptionRow = {
  endpoint: string | null;
  fcm_token?: string | null;
  id: string;
  subscription: PushSubscription | string | null;
};

function cleanEnvValue(value: string | undefined) {
  return value?.trim().replace(/^["']|["']$/g, "");
}

function getVapidConfig() {
  const publicKey = cleanEnvValue(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const privateKey = cleanEnvValue(process.env.VAPID_PRIVATE_KEY);
  const configuredSubject = cleanEnvValue(process.env.VAPID_SUBJECT);
  const subject = configuredSubject?.startsWith("mailto:")
    ? configuredSubject
    : configuredSubject
      ? configuredSubject
      : "mailto:suporte@horaai.app";

  return {
    hasPrivateKey: Boolean(privateKey),
    hasPublicKey: Boolean(publicKey),
    isConfigured: Boolean(publicKey && privateKey),
    privateKey,
    publicKey,
    subject,
  };
}

export function getWebPushDiagnostics() {
  const config = getVapidConfig();

  return {
    hasPrivateKey: config.hasPrivateKey,
    hasPublicKey: config.hasPublicKey,
    isConfigured: config.isConfigured,
    subject: config.subject,
  };
}

function configureWebPush() {
  const config = getVapidConfig();

  if (!config.isConfigured || !config.publicKey || !config.privateKey) {
    return null;
  }

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  return config;
}

function normalizeData(data: PushPayload["data"]) {
  return Object.entries(data ?? {}).reduce<Record<string, string>>(
    (accumulator, [key, value]) => {
      if (value === null || value === undefined) return accumulator;

      accumulator[key] = String(value);
      return accumulator;
    },
    {},
  );
}

function parseSubscription(row: PushSubscriptionRow) {
  if (row.subscription && typeof row.subscription === "object") {
    return row.subscription;
  }

  if (typeof row.subscription === "string") {
    try {
      return JSON.parse(row.subscription) as PushSubscription;
    } catch {
      return null;
    }
  }

  if (row.fcm_token?.startsWith("{")) {
    try {
      return JSON.parse(row.fcm_token) as PushSubscription;
    } catch {
      return null;
    }
  }

  return null;
}

async function deleteInvalidSubscriptions(
  supabase: SupabaseClient,
  ids: string[],
) {
  if (!ids.length) return null;

  const { error } = await supabase.from("push_subscriptions").delete().in("id", ids);

  if (error) {
    console.error("[Push] Erro ao remover subscriptions invalidas", {
      count: ids.length,
      error,
    });
  }

  return error;
}

export async function sendPushToUser({
  payload,
  supabase,
  userId,
}: {
  payload: PushPayload;
  supabase: SupabaseClient;
  userId: string;
}) {
  const diagnostics = getWebPushDiagnostics();
  const config = configureWebPush();

  if (!config) {
    return {
      ok: false,
      diagnostics,
      error: "VAPID_PRIVATE_KEY ou NEXT_PUBLIC_VAPID_PUBLIC_KEY ausente.",
      failureCount: 0,
      invalidSubscriptionCount: 0,
      successCount: 0,
      subscriptionCount: 0,
    };
  }

  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, subscription, fcm_token")
    .eq("user_id", userId);

  if (subscriptionsError) {
    return {
      ok: false,
      diagnostics,
      error: subscriptionsError.message,
      failureCount: 0,
      invalidSubscriptionCount: 0,
      successCount: 0,
      subscriptionCount: 0,
    };
  }

  const rows = ((subscriptions ?? []) as PushSubscriptionRow[])
    .map((row) => ({ row, subscription: parseSubscription(row) }))
    .filter((item): item is { row: PushSubscriptionRow; subscription: PushSubscription } =>
      Boolean(item.subscription?.endpoint),
    );

  if (!rows.length) {
    return {
      ok: false,
      diagnostics,
      error: "Nenhum dispositivo com notificacoes ativas.",
      failureCount: 0,
      invalidSubscriptionCount: 0,
      successCount: 0,
      subscriptionCount: 0,
    };
  }

  const body = JSON.stringify({
    body: payload.body,
    data: {
      ...normalizeData(payload.data),
      url: payload.link ?? payload.data?.url ?? "/dashboard",
    },
    icon: payload.icon ?? "/icon-192.png?v=3",
    title: payload.title,
  });
  const invalidIds: string[] = [];
  let successCount = 0;
  let failureCount = 0;

  await Promise.all(
    rows.map(async ({ row, subscription }) => {
      try {
        await webpush.sendNotification(subscription, body);
        successCount += 1;
      } catch (error) {
        failureCount += 1;

        const statusCode =
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          typeof error.statusCode === "number"
            ? error.statusCode
            : 0;

        if (statusCode === 404 || statusCode === 410) {
          invalidIds.push(row.id);
        } else {
          console.error("[Push] Erro ao enviar Web Push", {
            endpoint: row.endpoint ?? subscription.endpoint,
            error,
            statusCode,
          });
        }
      }
    }),
  );

  await deleteInvalidSubscriptions(supabase, invalidIds);

  return {
    ok: successCount > 0,
    diagnostics,
    failureCount,
    invalidSubscriptionCount: invalidIds.length,
    successCount,
    subscriptionCount: rows.length,
  };
}
