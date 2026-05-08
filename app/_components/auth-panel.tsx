"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseAuthDiagnostics, supabase } from "../lib/supabase";

const CONNECTION_ERROR_MESSAGE =
  "Não foi possível conectar ao Supabase. Verifique URL, ANON KEY, projeto ativo e bloqueio de rede.";

function getErrorInfo(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  if (error && typeof error === "object") {
    const maybeError = error as { name?: unknown; message?: unknown };
    return {
      name: typeof maybeError.name === "string" ? maybeError.name : "UnknownError",
      message:
        typeof maybeError.message === "string"
          ? maybeError.message
          : "Erro desconhecido.",
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

function isFetchConnectionError(error: unknown) {
  const { name, message } = getErrorInfo(error);
  return name === "AuthRetryableFetchError" || message.includes("Failed to fetch");
}

export function AuthPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function checkSupabaseConnection() {
      const diagnostics = getSupabaseAuthDiagnostics();
      console.info("[Supabase Auth] Diagnostico inicial", diagnostics);

      try {
        const sessionResult = await supabase.auth.getSession();

        if (sessionResult.error) {
          const errorInfo = getErrorInfo(sessionResult.error);
          console.error("[Supabase Auth] getSession retornou erro", {
            ...diagnostics,
            errorName: errorInfo.name,
            errorMessage: errorInfo.message,
          });

          if (isFetchConnectionError(sessionResult.error)) {
            setMessage(CONNECTION_ERROR_MESSAGE);
          }
        }
      } catch (error) {
        const errorInfo = getErrorInfo(error);
        console.error("[Supabase Auth] getSession falhou", {
          ...diagnostics,
          errorName: errorInfo.name,
          errorMessage: errorInfo.message,
        });
        setMessage(CONNECTION_ERROR_MESSAGE);
      }
    }

    checkSupabaseConnection();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const diagnostics = getSupabaseAuthDiagnostics();
      const form = new FormData(event.currentTarget);
      const email = String(form.get("email")).trim();
      const password = String(form.get("password"));

      console.info("[Supabase Auth] Iniciando autenticacao", {
        ...diagnostics,
        mode,
      });

      const result =
        mode === "login"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (result.error) {
        const errorInfo = getErrorInfo(result.error);
        console.error("[Supabase Auth] Erro retornado pela API", {
          ...diagnostics,
          mode,
          errorName: errorInfo.name,
          errorMessage: errorInfo.message,
          data: result.data,
        });

        if (isFetchConnectionError(result.error)) {
          setMessage(CONNECTION_ERROR_MESSAGE);
          return;
        }

        setMessage(result.error.message);
        return;
      }

      if (mode === "signup" && !result.data.session) {
        setMessage("Cadastro criado. Confirme seu e-mail antes de entrar.");
        return;
      }

      router.push("/dashboard");
    } catch (error) {
      const diagnostics = getSupabaseAuthDiagnostics();
      const errorInfo = getErrorInfo(error);
      console.error("[Supabase Auth] Falha de conexao ou fetch", {
        ...diagnostics,
        mode,
        errorName: errorInfo.name,
        errorMessage: errorInfo.message,
        sessionCheck: await supabase.auth.getSession().catch((sessionError) => ({
          errorName: getErrorInfo(sessionError).name,
          errorMessage: getErrorInfo(sessionError).message,
        })),
      });
      setMessage(CONNECTION_ERROR_MESSAGE);
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
