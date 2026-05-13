import { createResendClient } from "../../../lib/resend-server";

export async function GET() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const notificationEmail = process.env.NOTIFICATION_EMAIL?.trim();
  const hasResendKey = Boolean(apiKey);

  console.log("[Email Test] RESEND_API_KEY exists", hasResendKey);
  console.log("[Email Test] NOTIFICATION_EMAIL", notificationEmail);

  if (!apiKey || !notificationEmail) {
    return Response.json(
      {
        success: false,
        data: null,
        error: {
          message: "RESEND_API_KEY ou NOTIFICATION_EMAIL ausente",
          hasApiKey: hasResendKey,
          hasNotificationEmail: Boolean(notificationEmail),
        },
        hasResendKey,
        notificationEmail: notificationEmail ?? null,
      },
      { status: 500 },
    );
  }

  try {
    const resend = createResendClient(apiKey);
    console.log("[Email Test] Tentando enviar email via Resend");

    const { data, error } = await resend.emails.send({
      from: "HoraAi <onboarding@resend.dev>",
      to: notificationEmail,
      subject: "Teste de e-mail HoraAi",
      html: "<strong>Se você recebeu isso, o Resend está funcionando.</strong>",
    });

    console.log("[Email Test] Resend data", data);
    console.error("[Email Test] Resend error", error);

    return Response.json(
      {
        success: !error,
        data,
        error,
        hasResendKey,
        notificationEmail,
      },
      { status: error ? 502 : 200 },
    );
  } catch (error) {
    console.error("[Email Test] Erro inesperado", error);

    return Response.json(
      {
        success: false,
        data: null,
        error,
        hasResendKey,
        notificationEmail,
      },
      { status: 500 },
    );
  }
}
