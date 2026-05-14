"use client";
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

const hasUrl = Boolean(supabaseUrl);
const hasAnonKey = Boolean(supabaseAnonKey);
const hasValidUrl = Boolean(supabaseUrl?.startsWith("https://"));
const hasValidAnonKey = Boolean(supabaseAnonKey?.startsWith("eyJ"));

export function getSupabaseAuthDiagnostics() {
  return {
    url: supabaseUrl ?? null,
    hasUrl,
    hasValidUrl,
    hasKey: hasAnonKey,
    keyLength: supabaseAnonKey?.length ?? 0,
    hasValidAnonKey,
    isConfigured: hasUrl && hasAnonKey && hasValidUrl && hasValidAnonKey,
  };
}

if (!supabaseUrl || !supabaseAnonKey || !hasValidUrl || !hasValidAnonKey) {
  console.error("[Supabase Auth] Configuracao invalida", getSupabaseAuthDiagnostics());
}

export const supabase = createClient(
  supabaseUrl ?? "",
  supabaseAnonKey ?? "",
  {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      storageKey: "horaai-auth-session",
    },
  },
);
