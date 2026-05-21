import "server-only";

import crypto from "crypto";

const MP_API_BASE = "https://api.mercadopago.com";

function cleanEnvValue(value: string | undefined) {
  return value?.trim().replace(/^["']|["']$/g, "");
}

export function getMercadoPagoConfig() {
  const accessToken = cleanEnvValue(process.env.MERCADO_PAGO_ACCESS_TOKEN);
  const webhookSecret = cleanEnvValue(process.env.MERCADO_PAGO_WEBHOOK_SECRET);
  const proPlanId = cleanEnvValue(process.env.MERCADO_PAGO_PRO_PLAN_ID);

  return {
    accessToken,
    proPlanId,
    webhookSecret,
    diagnostics: {
      hasAccessToken: Boolean(accessToken),
      hasProPlanId: Boolean(proPlanId),
      hasWebhookSecret: Boolean(webhookSecret),
    },
  };
}

async function mercadoPagoRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const { accessToken } = getMercadoPagoConfig();

  if (!accessToken) {
    throw new Error("MERCADO_PAGO_ACCESS_TOKEN ausente.");
  }

  const response = await fetch(`${MP_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      payload?.message ??
      payload?.error ??
      `Mercado Pago retornou HTTP ${response.status}.`;
    throw new Error(message);
  }

  return payload as T;
}

export type MercadoPagoPreapproval = {
  id: string;
  payer_id?: number | string | null;
  payer_email?: string | null;
  collector_id?: number | string | null;
  external_reference?: string | null;
  init_point?: string | null;
  next_payment_date?: string | null;
  status?: string | null;
};

export type MercadoPagoPreapprovalPlan = {
  id: string;
  back_url?: string | null;
  external_reference?: string | null;
  init_point?: string | null;
  reason?: string | null;
  status?: string | null;
};

export type MercadoPagoPayment = {
  id: number | string;
  external_reference?: string | null;
  metadata?: Record<string, unknown> | null;
  payer?: {
    id?: number | string | null;
    email?: string | null;
  } | null;
  preapproval_id?: string | null;
  status?: string | null;
};

export type MercadoPagoAuthorizedPayment = {
  id: number | string;
  payment?: {
    id?: number | string | null;
    status?: string | null;
  } | null;
  preapproval_id?: string | null;
  status?: string | null;
};

export async function getMercadoPagoPreapprovalPlan(id: string) {
  return mercadoPagoRequest<MercadoPagoPreapprovalPlan>(
    `/preapproval_plan/${encodeURIComponent(id)}`,
  );
}

export function buildHostedSubscriptionCheckoutUrl({
  backUrl,
  barbershopId,
  initPoint,
  userId,
}: {
  backUrl: string;
  barbershopId: string;
  initPoint: string;
  userId: string;
}) {
  const url = new URL(initPoint);
  const externalReference = JSON.stringify({
    barbershop_id: barbershopId,
    user_id: userId,
  });

  url.searchParams.set("external_reference", externalReference);
  url.searchParams.set("back_url", backUrl);

  return url.toString();
}

export async function getHoraAiProPlanCheckout({
  backUrl,
  barbershopId,
  userId,
}: {
  backUrl: string;
  barbershopId: string;
  userId: string;
}) {
  const { proPlanId } = getMercadoPagoConfig();

  if (!proPlanId) {
    throw new Error("MERCADO_PAGO_PRO_PLAN_ID ausente.");
  }

  const plan = await getMercadoPagoPreapprovalPlan(proPlanId);

  if (!plan.init_point) {
    throw new Error("Plano Mercado Pago nao retornou init_point.");
  }

  return {
    checkoutUrl: buildHostedSubscriptionCheckoutUrl({
      backUrl,
      barbershopId,
      initPoint: plan.init_point,
      userId,
    }),
    plan,
  };
}

export async function getMercadoPagoPreapproval(id: string) {
  return mercadoPagoRequest<MercadoPagoPreapproval>(
    `/preapproval/${encodeURIComponent(id)}`,
  );
}

export async function cancelMercadoPagoPreapproval(id: string) {
  return mercadoPagoRequest<MercadoPagoPreapproval>(
    `/preapproval/${encodeURIComponent(id)}`,
    {
      body: JSON.stringify({ status: "canceled" }),
      method: "PUT",
    },
  );
}

export async function getMercadoPagoPayment(id: string) {
  return mercadoPagoRequest<MercadoPagoPayment>(
    `/v1/payments/${encodeURIComponent(id)}`,
  );
}

export async function getMercadoPagoAuthorizedPayment(id: string) {
  return mercadoPagoRequest<MercadoPagoAuthorizedPayment>(
    `/authorized_payments/${encodeURIComponent(id)}`,
  );
}

function signatureParts(signature: string) {
  return signature.split(",").reduce<Record<string, string>>((accumulator, part) => {
    const [key, value] = part.split("=");
    if (key && value) {
      accumulator[key.trim()] = value.trim();
    }
    return accumulator;
  }, {});
}

export function verifyMercadoPagoWebhookSignature({
  dataId,
  requestId,
  signature,
}: {
  dataId: string;
  requestId: string;
  signature: string;
}) {
  const { webhookSecret } = getMercadoPagoConfig();

  if (!webhookSecret) {
    return false;
  }

  const parts = signatureParts(signature);
  const ts = parts.ts;
  const v1 = parts.v1;

  if (!ts || !v1 || !requestId || !dataId) {
    return false;
  }

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(manifest)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}
