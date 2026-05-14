import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getResendConfig } from "../../lib/resend-server";

export async function GET() {
  try {
    const { apiKey, notificationEmail, fromEmail, diagnostics } =
      getResendConfig();

    if (!apiKey || !notificationEmail) {
      console.error("[TestEmail] RESEND_API_KEY ou NOTIFICATION_EMAIL ausente", {
        hasApiKey: Boolean(apiKey),
        hasNotificationEmail: Boolean(notificationEmail),
        fromEmail,
      });

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
      from: fromEmail,
      to: notificationEmail,
      subject: "Teste de notificacao da agenda",
      html: "<h2>Funcionou!</h2><p>Seu sistema de e-mail esta enviando notificacoes.</p>",
    });

    if (result.error) {
      console.error("[TestEmail] Erro retornado pelo Resend", {
        error: result.error,
        result,
        diagnostics,
      });

      return NextResponse.json(
        {
          success: false,
          error: result.error.message,
          details: result.error,
        },
        { status: 400 },
      );
    }

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
