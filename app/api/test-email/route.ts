import { NextResponse } from "next/server";
import { Resend } from "resend";

export async function GET() {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const notificationEmail = process.env.NOTIFICATION_EMAIL;

    if (!apiKey || !notificationEmail) {
      return NextResponse.json(
        {
          success: false,
          error: "RESEND_API_KEY ou NOTIFICATION_EMAIL ausente",
          hasApiKey: Boolean(apiKey),
          hasNotificationEmail: Boolean(notificationEmail),
        },
        { status: 500 },
      );
    }

    const resend = new Resend(apiKey);

    const result = await resend.emails.send({
      from: "Agenda Barbearia <onboarding@resend.dev>",
      to: notificationEmail,
      subject: "Teste de notificação da agenda",
      html: "<h2>Funcionou!</h2><p>Seu sistema de e-mail está enviando notificações.</p>",
    });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Erro no teste de email:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
