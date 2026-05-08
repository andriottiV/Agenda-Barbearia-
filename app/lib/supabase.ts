import { createClient } from "@supabase/supabase-js";

function cleanEnvValue(value: string | undefined) {
  return value?.trim().replace(/^["']|["']$/g, "");
}

const rawSupabaseUrl = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
const rawSupabaseAnonKey = cleanEnvValue(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

const supabaseUrl = rawSupabaseUrl?.replace(/\/+$/, "");
const supabaseAnonKey = rawSupabaseAnonKey;

const hasValidUrl = Boolean(
  supabaseUrl?.startsWith("https://") && supabaseUrl.endsWith(".supabase.co"),
);
const hasValidAnonKey = Boolean(supabaseAnonKey?.startsWith("eyJ"));

export function getSupabaseAuthDiagnostics() {
  return {
    url: supabaseUrl ?? null,
    hasUrl: Boolean(supabaseUrl),
    hasValidUrl,
    hasKey: Boolean(supabaseAnonKey),
    keyLength: supabaseAnonKey?.length ?? 0,
    hasValidAnonKey,
  };
}

if (!supabaseUrl || !supabaseAnonKey || !hasValidUrl || !hasValidAnonKey) {
  console.error("[Supabase Auth] Configuracao invalida", getSupabaseAuthDiagnostics());
}

export const supabase = createClient(
  supabaseUrl ?? "",
  supabaseAnonKey ?? "",
);
