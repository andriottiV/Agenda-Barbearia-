import { createResendClient, getResendConfig } from "./resend-server";
import { currency, whatsappLink } from "./schedule";
import { sendPushToUser } from "./web-push-server";
import {
  createServerSupabaseAdminClient,
  getServerSupabaseDiagnostics,
} from "./supabase-server";

type NewAppointmentPayload = {
  barbershopId?: unknown;
  barbershopSlug?: unknown;
  appointmentId?: unknown;
  customerName?: unknown;
  customerPhone?: unknown;
  serviceName?: unknown;
  servicePrice?: unknown;
  serviceDurationMinutes?: unknown;
  appointmentDate?: unknown;
  appointmentTime?: unknown;
  notes?: unknown;
  barbershopName?: unknown;
};

function field(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numericField(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailTemplate({
  customerName,
  customerPhone,
  serviceName,
  servicePrice,
  serviceDurationMinutes,
  appointmentDate,
  appointmentTime,
  notes,
  barbershopName,
  customerWhatsappUrl,
}: {
  customerName: string;
  customerPhone: string;
  serviceName: string;
  servicePrice: number;
  serviceDurationMinutes: number;
  appointmentDate: string;
  appointmentTime: string;
  notes: string;
  barbershopName: string;
  customerWhatsappUrl: string;
}) {
  const rows = [
    ["Cliente", customerName],
    ["WhatsApp", customerPhone],
    ["Servico", serviceName],
    ["Preco", currency(servicePrice)],
    ["Duracao", `${serviceDurationMinutes} min`],
    ["Data", appointmentDate],
    ["Horario", appointmentTime],
    ["Observacoes", notes || "Sem observacoes"],
  ];

  return `
    <div style="margin:0;padding:0;background:#080808;font-family:Arial,sans-serif;color:#f5f1eb;">
      <div style="max-width:560px;margin:0 auto;padding:32px 18px;">
        <div style="background:#121212;border:1px solid rgba(214,176,122,.35);border-radius:18px;overflow:hidden;">
          <div style="padding:24px;border-bottom:1px solid rgba(214,176,122,.2);">
            <p style="margin:0 0 6px;color:#d6b07a;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">
              ${escapeHtml(barbershopName)}
            </p>
            <h1 style="margin:0;font-size:24px;line-height:1.25;color:#f5f1eb;">
              Novo agendamento recebido
            </h1>
          </div>
          <div style="padding:24px;">
            <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#cfc6ba;">
              Um cliente acabou de confirmar um horario pelo HoraAi.
            </p>
            <table style="width:100%;border-collapse:collapse;">
              <tbody>
                ${rows
                  .map(
                    ([label, value]) => `
                      <tr>
                        <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);color:#8e8579;font-size:14px;width:120px;">
                          ${escapeHtml(label)}
                        </td>
                        <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);color:#f5f1eb;font-size:15px;font-weight:700;">
                          ${escapeHtml(value)}
                        </td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
            <a href="${escapeHtml(customerWhatsappUrl)}" style="display:inline-block;margin:22px 0 0;background:#20b15a;color:#ffffff;text-decoration:none;border-radius:12px;padding:12px 16px;font-weight:700;font-size:14px;">
              Abrir WhatsApp do cliente
            </a>
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function POST(request: Request) {
  const { apiKey, notificationEmail, diagnostics } = getResendConfig();
  const supabaseDiagnostics = getServerSupabaseDiagnostics();
  let payload: NewAppointmentPayload;

  try {
    payload = (await request.json()) as NewAppointmentPayload;
  } catch (error) {
    console.error("[Notifications API] Erro ao ler payload", error);
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const barbershopId = field(payload.barbershopId);
  const barbershopSlug = field(payload.barbershopSlug);
  const appointmentId = field(payload.appointmentId);
  const customerName = field(payload.customerName);
  const customerPhone = field(payload.customerPhone);
  const serviceName = field(payload.serviceName);
  const servicePrice = numericField(payload.servicePrice);
  const serviceDurationMinutes = numericField(payload.serviceDurationMinutes);
  const appointmentDate = field(payload.appointmentDate);
  const appointmentTime = field(payload.appointmentTime);
  const notes = field(payload.notes);
  const barbershopName = field(payload.barbershopName);

  if (
    (!barbershopId && !barbershopSlug) ||
    !customerName ||
    !customerPhone ||
    !serviceName ||
    !appointmentDate ||
    !appointmentTime ||
    !barbershopName
  ) {
    console.error("[Notifications API] Payload incompleto", {
      barbershopId,
      barbershopSlug,
      customerName,
      customerPhone,
      serviceName,
      servicePrice,
      serviceDurationMinutes,
      appointmentDate,
      appointmentTime,
      barbershopName,
    });
    return Response.json({ error: "Missing appointment fields." }, { status: 400 });
  }

  const customerWhatsappUrl = whatsappLink(
    customerPhone,
    `Ola ${customerName}, aqui e da ${barbershopName}. Recebemos seu agendamento de ${serviceName} para ${appointmentDate} as ${appointmentTime}.`,
  );
  const results: {
    notification?: unknown;
    notificationError?: unknown;
    push?: unknown;
    pushError?: unknown;
    email?: unknown;
    emailError?: unknown;
    emailSkipped?: boolean;
  } = {};

  const adminSupabase = createServerSupabaseAdminClient();

  if (!adminSupabase) {
    console.error("[Notifications API] SUPABASE_SERVICE_ROLE_KEY ausente", {
      supabaseDiagnostics,
    });
    results.notificationError = "SUPABASE_SERVICE_ROLE_KEY ausente";
  } else {

  const shopQuery = adminSupabase
    .from("barbershops")
    .select("id, owner_id, name");
  const filteredShopQuery = barbershopId
    ? shopQuery.eq("id", barbershopId)
    : shopQuery.eq("slug", barbershopSlug);
  const { data: shops, error: shopError } = await filteredShopQuery.limit(1);
  const shop = shops?.[0];
  const ownerUserId = typeof shop?.owner_id === "string" ? shop.owner_id : "";

  if (shopError || !ownerUserId) {
    console.error("[Notifications API] Erro ao encontrar dono da barbearia", {
      data: shop,
      error: shopError,
      barbershopId,
      barbershopSlug,
    });
    results.notificationError = shopError ?? "owner user_id nao encontrado";
  } else {

  const title = "Novo agendamento recebido";
  const message = `${customerName} confirmou ${serviceName} em ${appointmentDate} as ${appointmentTime}.`;
  const notificationPayload = {
    user_id: ownerUserId,
    appointment_id: appointmentId || null,
    type: "new_appointment",
    title,
    message,
    read: false,
  };

  const { data: notification, error: notificationError } = await adminSupabase
    .from("notifications")
    .insert(notificationPayload)
    .select("id, user_id, appointment_id, type, title, message, read, created_at")
    .single();

  results.notification = notification;
  if (notificationError) {
    results.notificationError = notificationError;
  }

  try {
    const pushMessage = `${customerName} agendou ${serviceName} para ${appointmentDate} às ${appointmentTime}.`;

    const pushResult = await sendPushToUser({
      supabase: adminSupabase,
      userId: ownerUserId,
      payload: {
        title: "Novo agendamento no HoraAi",
        body: pushMessage,
        link: "/dashboard",
        data: {
          appointmentId: appointmentId || "",
          barbershopId: shop?.id ?? barbershopId,
          body: pushMessage,
          title: "Novo agendamento no HoraAi",
          type: "new_appointment",
          url: "/dashboard",
        },
      },
    });

    results.push = pushResult;

    if (!pushResult.ok) {
      console.warn("[Notifications API] Push nao enviado", {
        barbershopId: shop?.id ?? barbershopId,
        ownerUserId,
        pushResult,
      });
    }
  } catch (error) {
    console.error("[Notifications API] Erro ao enviar push", {
      error,
      barbershopId: shop?.id ?? barbershopId,
      ownerUserId,
    });
    results.pushError = error;
  }
  }
  }

  if (!apiKey || !notificationEmail) {
    console.warn("[Notifications API] Resend nao configurado; e-mail ignorado", {
      resend: diagnostics,
    });
    return Response.json({
      ok: true,
      diagnostics: { resend: diagnostics, supabase: supabaseDiagnostics },
      ...results,
      emailSkipped: true,
    });
  }

  try {
    const resend = createResendClient(apiKey);
    const { data, error } = await resend.emails.send({
      from: "HoraAi <onboarding@resend.dev>",
      to: notificationEmail,
      subject: "Novo agendamento recebido - HoraAi",
      html: emailTemplate({
        customerName,
        customerPhone,
        serviceName,
        servicePrice,
        serviceDurationMinutes,
        appointmentDate,
        appointmentTime,
        notes,
        barbershopName,
        customerWhatsappUrl,
      }),
      text: [
        "Novo agendamento recebido - HoraAi",
        "",
        `Barbearia: ${barbershopName}`,
        `Cliente: ${customerName}`,
        `WhatsApp: ${customerPhone}`,
        `Servico: ${serviceName}`,
        `Preco: ${currency(servicePrice)}`,
        `Duracao: ${serviceDurationMinutes} min`,
        `Data: ${appointmentDate}`,
        `Horario: ${appointmentTime}`,
        `Observacoes: ${notes || "Sem observacoes"}`,
        `WhatsApp do cliente: ${customerWhatsappUrl}`,
      ].join("\n"),
    });

    if (error) {
      console.error("[Notifications API] Erro retornado pelo Resend", error);
    }

    results.email = data;
    results.emailError = error;
  } catch (error) {
    console.error("[Notifications API] Erro inesperado ao enviar e-mail", error);
    results.emailError = error;
  }

  return Response.json({ ok: true, ...results });
}
