import { createClient } from "@supabase/supabase-js";

function cleanEnvValue(value: string | undefined) {
  return value?.trim().replace(/^["']|["']$/g, "");
}

const supabaseUrl = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(
  /\/+$/,
  "",
);
const supabaseAnonKey = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const supabaseServiceRoleKey = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);

export function createServerSupabaseClient() {
  return createClient(supabaseUrl ?? "", supabaseAnonKey ?? "", {
    auth: {
      persistSession: false,
    },
  });
}

export function createServerSupabaseAdminClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl ?? "", supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}

export function getServerSupabaseDiagnostics() {
  return {
    hasUrl: Boolean(supabaseUrl),
    hasAnonKey: Boolean(supabaseAnonKey),
    hasServiceRoleKey: Boolean(supabaseServiceRoleKey),
  };
}
