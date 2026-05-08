import { createResendClient, getResendConfig } from "../../../lib/resend-server";

type NewAppointmentPayload = {
  customerName?: unknown;
  customerPhone?: unknown;
  serviceName?: unknown;
  appointmentDate?: unknown;
  appointmentTime?: unknown;
  barbershopName?: unknown;
};

function field(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
  appointmentDate,
  appointmentTime,
  barbershopName,
}: {
  customerName: string;
  customerPhone: string;
  serviceName: string;
  appointmentDate: string;
  appointmentTime: string;
  barbershopName: string;
}) {
  const rows = [
    ["Cliente", customerName],
    ["Telefone", customerPhone],
    ["Serviço", serviceName],
    ["Data", appointmentDate],
    ["Horário", appointmentTime],
  ];

  return `
    <div style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:560px;margin:0 auto;padding:32px 18px;">
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          <div style="padding:24px;border-bottom:1px solid #e2e8f0;">
            <p style="margin:0 0 6px;color:#047857;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">
              ${escapeHtml(barbershopName)}
            </p>
            <h1 style="margin:0;font-size:24px;line-height:1.25;color:#0f172a;">
              Novo agendamento recebido
            </h1>
          </div>
          <div style="padding:24px;">
            <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#334155;">
              Novo agendamento recebido:
            </p>
            <table style="width:100%;border-collapse:collapse;">
              <tbody>
                ${rows
                  .map(
                    ([label, value]) => `
                      <tr>
                        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:14px;width:110px;">
                          ${escapeHtml(label)}
                        </td>
                        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:15px;font-weight:700;">
                          ${escapeHtml(value)}
                        </td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
            <p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:#475569;">
              Acesse o painel para acompanhar.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function POST(request: Request) {
  const { apiKey, notificationEmail, diagnostics } = getResendConfig();

  console.log("[Notifications] Configuracao Resend", diagnostics);

  if (!apiKey || !notificationEmail) {
    console.error("[Notifications] Resend env ausente", diagnostics);
    return Response.json(
      { error: "Notifications are not configured." },
      { status: 500 },
    );
  }

  let payload: NewAppointmentPayload;

  try {
    payload = (await request.json()) as NewAppointmentPayload;
    console.log("[Notifications] Payload recebido", payload);
  } catch (error) {
    console.error("[Notifications] Erro ao ler payload", error);
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const customerName = field(payload.customerName);
  const customerPhone = field(payload.customerPhone);
  const serviceName = field(payload.serviceName);
  const appointmentDate = field(payload.appointmentDate);
  const appointmentTime = field(payload.appointmentTime);
  const barbershopName = field(payload.barbershopName);

  if (
    !customerName ||
    !customerPhone ||
    !serviceName ||
    !appointmentDate ||
    !appointmentTime ||
    !barbershopName
  ) {
    console.error("[Notifications] Payload incompleto", {
      customerName,
      customerPhone,
      serviceName,
      appointmentDate,
      appointmentTime,
      barbershopName,
    });
    return Response.json({ error: "Missing appointment fields." }, { status: 400 });
  }

  const resend = createResendClient(apiKey);
  console.log("[Notifications] email destino", notificationEmail);
  console.log("[Notifications] Enviando e-mail", {
    to: notificationEmail,
    subject: "Novo agendamento na agenda da barbearia",
    customerName,
    serviceName,
    appointmentDate,
    appointmentTime,
  });

  const resendResponse = await resend.emails.send({
    from: "Agenda Barbearia <onboarding@resend.dev>",
    to: notificationEmail,
    subject: "Novo agendamento na agenda da barbearia",
    html: emailTemplate({
      customerName,
      customerPhone,
      serviceName,
      appointmentDate,
      appointmentTime,
      barbershopName,
    }),
    text: [
      "Novo agendamento recebido:",
      "",
      `Cliente: ${customerName}`,
      `Telefone: ${customerPhone}`,
      `Serviço: ${serviceName}`,
      `Data: ${appointmentDate}`,
      `Horário: ${appointmentTime}`,
      "",
      "Acesse o painel para acompanhar.",
    ].join("\n"),
  });

  console.log("[Notifications] Resposta completa do Resend", resendResponse);

  const { error } = resendResponse;

  if (error) {
    console.error("[Notifications] Erro completo ao enviar e-mail", {
      error,
      response: resendResponse,
      diagnostics,
    });
    return Response.json({ error: "Could not send notification." }, { status: 502 });
  }

  return Response.json({ ok: true, resend: resendResponse });
}
