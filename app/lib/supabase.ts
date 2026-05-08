import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

function getProjectRefFromUrl(url: string | undefined) {
  return url?.match(/^https:\/\/([^.]+)\.supabase\.co\/?$/)?.[1] ?? null;
}

function getProjectRefFromAnonKey(key: string | undefined) {
  if (!key) {
    return null;
  }

  try {
    const payload = JSON.parse(atob(key.split(".")[1] ?? ""));
    return typeof payload.ref === "string" ? payload.ref : null;
  } catch {
    return null;
  }
}

export function getSupabaseConfigDiagnostics() {
  const refFromUrl = getProjectRefFromUrl(supabaseUrl);
  const refFromAnonKey = getProjectRefFromAnonKey(supabaseAnonKey);

  return {
    url: supabaseUrl ?? null,
    urlConfigured: Boolean(supabaseUrl),
    anonKeyConfigured: Boolean(supabaseAnonKey),
    urlFormatOk: Boolean(refFromUrl),
    refFromUrl,
    refFromAnonKey,
    refsMatch: Boolean(refFromUrl && refFromAnonKey && refFromUrl === refFromAnonKey),
  };
}

export function getSupabaseConfigError() {
  const diagnostics = getSupabaseConfigDiagnostics();

  if (!diagnostics.urlConfigured) {
    return "NEXT_PUBLIC_SUPABASE_URL nao foi configurada.";
  }

  if (!diagnostics.anonKeyConfigured) {
    return "NEXT_PUBLIC_SUPABASE_ANON_KEY nao foi configurada.";
  }

  if (!diagnostics.urlFormatOk) {
    return "NEXT_PUBLIC_SUPABASE_URL precisa estar no formato https://<project-ref>.supabase.co.";
  }

  if (!diagnostics.refsMatch) {
    return "A URL do Supabase e a anon key pertencem a projetos diferentes.";
  }

  return null;
}
