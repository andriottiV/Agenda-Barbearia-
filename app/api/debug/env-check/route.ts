function exists(value: string | undefined) {
  return Boolean(value?.trim());
}

export async function GET() {
  return Response.json({
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: exists(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    ),
    VAPID_PRIVATE_KEY: exists(process.env.VAPID_PRIVATE_KEY),
    VAPID_SUBJECT: exists(process.env.VAPID_SUBJECT),
    SUPABASE_SERVICE_ROLE_KEY: exists(process.env.SUPABASE_SERVICE_ROLE_KEY),
    NEXT_PUBLIC_SUPABASE_URL: exists(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: exists(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  });
}
