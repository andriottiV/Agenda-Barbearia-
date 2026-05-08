"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getSupabaseConfigDiagnostics,
  getSupabaseConfigError,
  supabase,
} from "../lib/supabase";

export function AuthPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const configError = getSupabaseConfigError();

      if (configError) {
        console.error("[Supabase Auth] Configuracao invalida", {
          ...getSupabaseConfigDiagnostics(),
          error: configError,
        });
        setMessage("Configuracao do Supabase invalida. Verifique o console.");
        return;
      }

      const form = new FormData(event.currentTarget);
      const email = String(form.get("email")).trim();
      const password = String(form.get("password"));

      const result =
        mode === "login"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (result.error) {
        console.error("[Supabase Auth] Erro retornado pela API", {
          mode,
          error: result.error,
          data: result.data,
        });
        setMessage(result.error.message);
        return;
      }

      if (mode === "signup" && !result.data.session) {
        setMessage("Cadastro criado. Confirme seu e-mail antes de entrar.");
        return;
      }

      router.push("/dashboard");
    } catch (error) {
      console.error("[Supabase Auth] Falha de conexao ou fetch", {
        mode,
        error,
        diagnostics: getSupabaseConfigDiagnostics(),
        sessionCheck: await supabase.auth.getSession().catch((sessionError) => ({
          error: sessionError,
        })),
      });
      setMessage(
        "Nao foi possivel conectar ao Supabase. Verifique sua conexao e configuracao.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        E-mail
        <input
          name="email"
          type="email"
          required
          className="h-11 rounded-md border border-slate-300 px-3 text-slate-950 outline-none focus:border-emerald-600"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Senha
        <input
          name="password"
          type="password"
          minLength={6}
          required
          className="h-11 rounded-md border border-slate-300 px-3 text-slate-950 outline-none focus:border-emerald-600"
        />
      </label>
      <button
        disabled={loading}
        className="h-11 rounded-md bg-emerald-700 px-4 font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
      >
        {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
      </button>
      <button
        type="button"
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        className="text-sm font-medium text-emerald-800"
      >
        {mode === "login" ? "Criar uma conta" : "Ja tenho conta"}
      </button>
      {message ? <p className="text-sm text-red-700">{message}</p> : null}
    </form>
  );
}
