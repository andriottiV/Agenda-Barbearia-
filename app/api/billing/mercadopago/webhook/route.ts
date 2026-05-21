import {
  getMercadoPagoAuthorizedPayment,
  getMercadoPagoPayment,
  getMercadoPagoPreapproval,
  verifyMercadoPagoWebhookSignature,
} from "../../../../lib/mercado-pago-server";
import {
  createServerSupabaseAdminClient,
  getServerSupabaseDiagnostics,
} from "../../../../lib/supabase-server";

export const runtime = "nodejs";

type MercadoPagoWebhookBody = {
  action?: string;
  data?: {
    id?: string | number;
  };
  type?: string;
};

function textField(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function subscriptionStatusToPlan(status: string) {
  return status === "authorized" ? "pro" : "free";
}

function paymentStatusToPlan(status: string) {
  return status === "approved" ? "pro" : "free";
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const xSignature = request.headers.get("x-signature") ?? "";
  const xRequestId = request.headers.get("x-request-id") ?? "";
  let body: MercadoPagoWebhookBody = {};

  try {
    body = (await request.json()) as MercadoPagoWebhookBody;
  } catch {
    body = {};
  }

  const dataId =
    url.searchParams.get("data.id") ??
    textField(body.data?.id) ??
    url.searchParams.get("id") ??
    "";

  if (
    !verifyMercadoPagoWebhookSignature({
      dataId,
      requestId: xRequestId,
      signature: xSignature,
    })
  ) {
    return Response.json(
      { success: false, error: "Assinatura Mercado Pago invalida." },
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

  const type = url.searchParams.get("type") ?? body.type ?? "";

  try {
    if (type === "subscription_preapproval") {
      const preapproval = await getMercadoPagoPreapproval(dataId);
      const userId = preapproval.external_reference ?? "";
      const status = preapproval.status ?? "pending";
      const plan = subscriptionStatusToPlan(status);

      if (!userId) {
        return Response.json({ success: true, skipped: "external_reference ausente" });
      }

      await adminSupabase
        .from("subscriptions")
        .upsert(
          {
            mp_customer_id: preapproval.payer_id
              ? String(preapproval.payer_id)
              : null,
            mp_subscription_id: preapproval.id,
            next_payment_date: preapproval.next_payment_date ?? null,
            plan: "pro",
            status,
            updated_at: new Date().toISOString(),
            user_id: userId,
          },
          { onConflict: "user_id" },
        );

      await adminSupabase.rpc("sync_user_barbershop_plan", {
        p_plan: plan,
        p_user_id: userId,
      });

      return Response.json({ success: true, plan, status });
    }

    if (type === "subscription_authorized_payment") {
      const authorizedPayment = await getMercadoPagoAuthorizedPayment(dataId);
      const status =
        authorizedPayment.payment?.status ??
        authorizedPayment.status ??
        "pending";
      const plan = paymentStatusToPlan(status);
      const mpSubscriptionId = authorizedPayment.preapproval_id ?? "";

      if (!mpSubscriptionId) {
        return Response.json({ success: true, skipped: "preapproval_id ausente" });
      }

      const preapproval = await getMercadoPagoPreapproval(mpSubscriptionId);
      const userId = preapproval.external_reference ?? "";

      if (!userId) {
        return Response.json({ success: true, skipped: "external_reference ausente" });
      }

      await adminSupabase
        .from("subscriptions")
        .upsert(
          {
            mp_customer_id: preapproval.payer_id
              ? String(preapproval.payer_id)
              : null,
            mp_subscription_id: preapproval.id,
            next_payment_date: preapproval.next_payment_date ?? null,
            plan: "pro",
            status,
            updated_at: new Date().toISOString(),
            user_id: userId,
          },
          { onConflict: "user_id" },
        );

      await adminSupabase.rpc("sync_user_barbershop_plan", {
        p_plan: plan,
        p_user_id: userId,
      });

      return Response.json({ success: true, plan, status });
    }

    if (type === "payment") {
      const payment = await getMercadoPagoPayment(dataId);
      const status = payment.status ?? "pending";
      const plan = paymentStatusToPlan(status);
      const mpSubscriptionId = payment.preapproval_id ?? "";

      if (!mpSubscriptionId) {
        return Response.json({ success: true, skipped: "preapproval_id ausente" });
      }

      const preapproval = await getMercadoPagoPreapproval(mpSubscriptionId);
      const userId = preapproval.external_reference ?? "";

      if (!userId) {
        return Response.json({ success: true, skipped: "external_reference ausente" });
      }

      await adminSupabase
        .from("subscriptions")
        .upsert(
          {
            mp_customer_id: preapproval.payer_id
              ? String(preapproval.payer_id)
              : payment.payer?.id
                ? String(payment.payer.id)
                : null,
            mp_subscription_id: preapproval.id,
            next_payment_date: preapproval.next_payment_date ?? null,
            plan: "pro",
            status,
            updated_at: new Date().toISOString(),
            user_id: userId,
          },
          { onConflict: "user_id" },
        );

      await adminSupabase.rpc("sync_user_barbershop_plan", {
        p_plan: plan,
        p_user_id: userId,
      });

      return Response.json({ success: true, plan, status });
    }

    return Response.json({ success: true, skipped: type || "tipo ausente" });
  } catch (error) {
    console.error("[MercadoPago Webhook] Erro ao processar evento", error);
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel processar webhook.",
      },
      { status: 500 },
    );
  }
}
