import { cancelMercadoPagoPreapproval } from "../../../../lib/mercado-pago-server";
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
        diagnostics: getServerSupabaseDiagnostics(),
      },
      { status: 500 },
    );
  }

  const { data: subscription, error: subscriptionError } = await adminSupabase
    .from("subscriptions")
    .select("mp_subscription_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (subscriptionError) {
    return Response.json(
      { success: false, error: subscriptionError.message },
      { status: 500 },
    );
  }

  const mpSubscriptionId =
    typeof subscription?.mp_subscription_id === "string"
      ? subscription.mp_subscription_id
      : "";

  if (!mpSubscriptionId) {
    return Response.json(
      { success: false, error: "Assinatura Mercado Pago nao encontrada." },
      { status: 404 },
    );
  }

  try {
    const cancelled = await cancelMercadoPagoPreapproval(mpSubscriptionId);

    const { error: updateError } = await adminSupabase
      .from("subscriptions")
      .update({
        next_payment_date: cancelled.next_payment_date ?? null,
        status: cancelled.status ?? "cancelled",
      })
      .eq("user_id", user.id);

    if (updateError) {
      return Response.json(
        { success: false, error: updateError.message },
        { status: 500 },
      );
    }

    await adminSupabase.rpc("sync_user_barbershop_plan", {
      p_plan: "free",
      p_user_id: user.id,
    });

    return Response.json({
      success: true,
      status: cancelled.status ?? "cancelled",
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel cancelar a assinatura.",
      },
      { status: 502 },
    );
  }
}
