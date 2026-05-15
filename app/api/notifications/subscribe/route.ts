import {
  createServerSupabaseAdminClient,
  createServerSupabaseClient,
  getServerSupabaseDiagnostics,
} from "../../../lib/supabase-server";
import { getWebPushDiagnostics } from "../../../lib/web-push-server";

export const runtime = "nodejs";

type PushSubscriptionBody = {
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: {
    auth?: unknown;
    p256dh?: unknown;
  };
};

type SubscribeBody = {
  platform?: unknown;
  subscription?: PushSubscriptionBody;
};

function textField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const [type, token] = authorization.split(" ");

  if (type.toLowerCase() !== "bearer" || !token) {
    return "";
  }

  return token.trim();
}

export async function POST(request: Request) {
  const token = bearerToken(request);

  if (!token) {
    return Response.json(
      { success: false, error: "Authorization Bearer token ausente." },
      { status: 401 },
    );
  }

  const supabase = createServerSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const user = authData.user;

  if (authError || !user) {
    return Response.json(
      { success: false, error: "Usuario nao autenticado." },
      { status: 401 },
    );
  }

  const adminSupabase = createServerSupabaseAdminClient();

  if (!adminSupabase) {
    return Response.json(
      {
        success: false,
        error: "SUPABASE_SERVICE_ROLE_KEY ausente.",
        diagnostics: {
          supabase: getServerSupabaseDiagnostics(),
          webPush: getWebPushDiagnostics(),
        },
      },
      { status: 500 },
    );
  }

  let body: SubscribeBody = {};

  try {
    body = (await request.json()) as SubscribeBody;
  } catch {
    return Response.json(
      { success: false, error: "JSON invalido." },
      { status: 400 },
    );
  }

  const subscription = body.subscription;
  const endpoint = textField(subscription?.endpoint);
  const p256dh = textField(subscription?.keys?.p256dh);
  const auth = textField(subscription?.keys?.auth);
  const platform = textField(body.platform) || "web";

  if (!endpoint || !p256dh || !auth) {
    return Response.json(
      {
        success: false,
        error: "Subscription Web Push incompleta.",
      },
      { status: 400 },
    );
  }

  const { data: shops, error: shopError } = await adminSupabase
    .from("barbershops")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1);

  if (shopError) {
    return Response.json(
      { success: false, error: shopError.message },
      { status: 500 },
    );
  }

  if (!shops?.length) {
    return Response.json(
      {
        success: false,
        error: "Crie ou acesse sua barbearia antes de ativar notificacoes.",
      },
      { status: 403 },
    );
  }

  const serializedSubscription = {
    endpoint,
    expirationTime:
      typeof subscription?.expirationTime === "number"
        ? subscription.expirationTime
        : null,
    keys: {
      auth,
      p256dh,
    },
  };

  const { data, error } = await adminSupabase
    .from("push_subscriptions")
    .upsert(
      {
        auth_key: auth,
        endpoint,
        fcm_token: endpoint,
        p256dh,
        platform,
        subscription: serializedSubscription,
        updated_at: new Date().toISOString(),
        user_id: user.id,
      },
      { onConflict: "endpoint" },
    )
    .select("id, user_id, endpoint, platform, updated_at")
    .maybeSingle();

  if (error) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }

  return Response.json({
    success: true,
    message: "Notificacoes ativadas com sucesso",
    subscription: data,
  });
}
