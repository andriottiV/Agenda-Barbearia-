import { Resend } from "resend";

export function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const notificationEmail = process.env.NOTIFICATION_EMAIL?.trim();
  const fromEmail =
    process.env.RESEND_FROM_EMAIL?.trim() ??
    "HoraAi <onboarding@resend.dev>";

  return {
    apiKey,
    notificationEmail,
    fromEmail,
    diagnostics: {
      hasApiKey: Boolean(apiKey),
      hasNotificationEmail: Boolean(notificationEmail),
      fromEmail,
      notificationEmail: notificationEmail ?? null,
    },
  };
}

export function createResendClient(apiKey: string) {
  return new Resend(apiKey);
}
