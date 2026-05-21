import {
  createHoraAiProSubscription,
  getMercadoPagoConfig,
} from "../../../../lib/mercado-pago-server";
import {
  createServerSupabaseAdminClient,
  createServerSupabaseClient,
  getServerSupabaseDiagnostics,
} from "../../../../lib/supabase-server";

export const runtime = "nodejs";

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

  if (authError || !user?.email) {
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
        diagnostics: getServerSupabaseDiagnostics(),
      },
      { status: 500 },
    );
  }

  const mpConfig = getMercadoPagoConfig();

  if (!mpConfig.accessToken) {
    return Response.json(
      {
        success: false,
        error: "MERCADO_PAGO_ACCESS_TOKEN ausente.",
        diagnostics: mpConfig.diagnostics,
      },
      { status: 500 },
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
        error: "Cadastre o perfil da barbearia antes de assinar o Pro.",
      },
      { status: 403 },
    );
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ??
    new URL(request.url).origin;

  try {
    const subscription = await createHoraAiProSubscription({
      appUrl,
      payerEmail: user.email,
      userId: user.id,
    });

    const { error: upsertError } = await adminSupabase
      .from("subscriptions")
      .upsert(
        {
          mp_customer_id: subscription.payer_id
            ? String(subscription.payer_id)
            : null,
          mp_subscription_id: subscription.id,
          next_payment_date: subscription.next_payment_date ?? null,
          plan: "pro",
          status: subscription.status ?? "pending",
          updated_at: new Date().toISOString(),
          user_id: user.id,
        },
        { onConflict: "user_id" },
      );

    if (upsertError) {
      return Response.json(
        { success: false, error: upsertError.message },
        { status: 500 },
      );
    }

    return Response.json({
      success: true,
      checkoutUrl: subscription.init_point,
      subscriptionId: subscription.id,
      status: subscription.status ?? "pending",
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel iniciar a assinatura.",
      },
      { status: 502 },
    );
  }
}
