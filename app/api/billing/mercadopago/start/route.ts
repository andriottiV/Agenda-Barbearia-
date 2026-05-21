import { getMercadoPagoConfig } from "../../../../lib/mercado-pago-server";
import {
  createServerSupabaseClient,
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

  const mpConfig = getMercadoPagoConfig();

  if (!mpConfig.proPlanId) {
    return Response.json(
      {
        success: false,
        error: "MERCADO_PAGO_PRO_PLAN_ID ausente.",
        diagnostics: mpConfig.diagnostics,
      },
      { status: 500 },
    );
  }

  const checkoutUrl = `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=${encodeURIComponent(
    mpConfig.proPlanId,
  )}`;

  /*
   * Checkout hospedado do plano nao recebe card_token_id no HoraAi e tambem nao
   * cria uma preapproval no nosso backend antes do pagamento.
   *
   * Limitacao atual: neste fluxo direto pelo init_point do plano, o webhook pode
   * nao receber um external_reference confiavel para vincular automaticamente a
   * assinatura ao usuario. A proxima etapa segura e criar um vinculo
   * pending_subscription antes do redirect ou usar uma back_url assinada com um
   * identificador seguro para reconciliar usuario <-> assinatura.
   */
  return Response.json({
    success: true,
    checkoutUrl,
    planId: mpConfig.proPlanId,
    reason: "HoraAi PRO",
    status: "checkout_hosted",
  });
}
