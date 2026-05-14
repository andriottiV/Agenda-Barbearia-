import "server-only";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import type { SupabaseClient } from "@supabase/supabase-js";

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string | number | boolean | null | undefined>;
  link?: string;
};

type PushSubscriptionRow = {
  fcm_token: string;
};

const PERMANENT_FCM_ERRORS = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

function cleanEnvValue(value: string | undefined) {
  return value?.trim().replace(/^["']|["']$/g, "");
}

function getFirebasePrivateKey() {
  return cleanEnvValue(process.env.FIREBASE_PRIVATE_KEY)?.replace(/\\n/g, "\n");
}

function getFirebaseAdminConfig() {
  const projectId =
    cleanEnvValue(process.env.FIREBASE_PROJECT_ID) ||
    cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  const clientEmail = cleanEnvValue(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = getFirebasePrivateKey();

  return {
    clientEmail,
    hasClientEmail: Boolean(clientEmail),
    hasPrivateKey: Boolean(privateKey),
    hasProjectId: Boolean(projectId),
    isConfigured: Boolean(projectId && clientEmail && privateKey),
    privateKey,
    projectId,
  };
}

export function getFirebaseAdminDiagnostics() {
  const config = getFirebaseAdminConfig();

  return {
    hasClientEmail: config.hasClientEmail,
    hasPrivateKey: config.hasPrivateKey,
    hasProjectId: config.hasProjectId,
    isConfigured: config.isConfigured,
  };
}

function getFirebaseAdminApp() {
  const config = getFirebaseAdminConfig();

  if (!config.isConfigured) {
    return null;
  }

  if (getApps().length) {
    return getApps()[0];
  }

  return initializeApp({
    credential: cert({
      clientEmail: config.clientEmail,
      privateKey: config.privateKey,
      projectId: config.projectId,
    }),
    projectId: config.projectId,
  });
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
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

async function deleteInvalidTokens(
  supabase: SupabaseClient,
  userId: string,
  tokens: string[],
) {
  if (!tokens.length) return null;

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .in("fcm_token", tokens);

  if (error) {
    console.error("[Push] Erro ao remover tokens invalidos", {
      error,
      count: tokens.length,
      userId,
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
  const diagnostics = getFirebaseAdminDiagnostics();
  const app = getFirebaseAdminApp();

  if (!app) {
    return {
      ok: false,
      diagnostics,
      error: "Firebase Admin nao configurado.",
      failureCount: 0,
      invalidTokenCount: 0,
      successCount: 0,
      tokenCount: 0,
    };
  }

  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from("push_subscriptions")
    .select("fcm_token")
    .eq("user_id", userId);

  if (subscriptionsError) {
    return {
      ok: false,
      diagnostics,
      error: subscriptionsError.message,
      failureCount: 0,
      invalidTokenCount: 0,
      successCount: 0,
      tokenCount: 0,
    };
  }

  const tokens = Array.from(
    new Set(
      ((subscriptions ?? []) as PushSubscriptionRow[])
        .map((subscription) => subscription.fcm_token)
        .filter(Boolean),
    ),
  );

  if (!tokens.length) {
    return {
      ok: false,
      diagnostics,
      error: "Nenhum dispositivo com notificacoes ativas.",
      failureCount: 0,
      invalidTokenCount: 0,
      successCount: 0,
      tokenCount: 0,
    };
  }

  const messaging = getMessaging(app);
  const invalidTokens = new Set<string>();
  let successCount = 0;
  let failureCount = 0;

  for (const tokenChunk of chunk(tokens, 500)) {
    const response = await messaging.sendEachForMulticast({
      tokens: tokenChunk,
      notification: {
        body: payload.body,
        title: payload.title,
      },
      data: normalizeData(payload.data),
      webpush: {
        fcmOptions: {
          link: payload.link ?? "/dashboard",
        },
      },
    });

    successCount += response.successCount;
    failureCount += response.failureCount;

    response.responses.forEach((item, index) => {
      const errorCode = item.error?.code;

      if (errorCode && PERMANENT_FCM_ERRORS.has(errorCode)) {
        invalidTokens.add(tokenChunk[index]);
      }
    });
  }

  await deleteInvalidTokens(supabase, userId, Array.from(invalidTokens));

  return {
    ok: successCount > 0,
    diagnostics,
    failureCount,
    invalidTokenCount: invalidTokens.size,
    successCount,
    tokenCount: tokens.length,
  };
}
