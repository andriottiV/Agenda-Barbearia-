import { Resend } from "resend";

export function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const notificationEmail = process.env.NOTIFICATION_EMAIL?.trim();

  return {
    apiKey,
    notificationEmail,
    diagnostics: {
      hasApiKey: Boolean(apiKey),
      hasNotificationEmail: Boolean(notificationEmail),
      notificationEmail: notificationEmail ?? null,
    },
  };
}

export function createResendClient(apiKey: string) {
  return new Resend(apiKey);
}
