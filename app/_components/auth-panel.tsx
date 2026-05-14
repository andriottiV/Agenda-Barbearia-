"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PremiumButton, PremiumInput } from "../../components/ui/premium";
import { getSupabaseAuthDiagnostics, supabase } from "../lib/supabase";

type AuthMode = "login" | "signup";

const CONNECTION_ERROR_MESSAGE =
  "Nao foi possivel conectar ao Supabase. Verifique as variaveis de ambiente.";

function getErrorInfo(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      status: undefined as number | undefined,
    };
  }

  if (error && typeof error === "object") {
    const maybeError = error as {
      name?: unknown;
      message?: unknown;
      status?: unknown;
    };
    return {
      name: typeof maybeError.name === "string" ? maybeError.name : "UnknownError",
      message:
        typeof maybeError.message === "string"
          ? maybeError.message
          : "Erro desconhecido.",
      status: typeof maybeError.status === "number" ? maybeError.status : undefined,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
    status: undefined,
  };
}

function isFetchConnectionError(error: unknown) {
  const { name, message } = getErrorInfo(error);
  return (
    name === "AuthRetryableFetchError" ||
    message.includes("Failed to fetch") ||
    message.includes("failed to fetch") ||
    message.includes("network")
  );
}

export function AuthPanel({
  mode: controlledMode,
  onModeChange,
}: {
  mode?: AuthMode;
  onModeChange?: (mode: AuthMode) => void;
}) {
  const router = useRouter();
  const [uncontrolledMode, setUncontrolledMode] = useState<AuthMode>("login");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const mode = controlledMode ?? uncontrolledMode;

  function setMode(nextMode: AuthMode) {
    setMessage("");
    if (onModeChange) {
      onModeChange(nextMode);
      return;
    }
    setUncontrolledMode(nextMode);
  }

  useEffect(() => {
    async function checkSupabaseConnection() {
      const diagnostics = getSupabaseAuthDiagnostics();
      const origin = window.location.origin;
      if (!diagnostics.hasUrl || !diagnostics.hasKey) {
        console.error("[Supabase Auth] Variáveis de ambiente Supabase ausentes", {
          ...diagnostics,
          origin,
        });
        setMessage(CONNECTION_ERROR_MESSAGE);
        return;
      }

      try {
        const sessionResult = await supabase.auth.getSession();

        if (sessionResult.error) {
          const errorInfo = getErrorInfo(sessionResult.error);
          console.error("[Supabase Auth] getSession retornou erro", {
            ...diagnostics,
            urlExists: diagnostics.hasUrl,
            anonKeyExists: diagnostics.hasKey,
            origin,
            errorName: errorInfo.name,
            errorMessage: errorInfo.message,
            errorStatus: errorInfo.status,
          });

          if (isFetchConnectionError(sessionResult.error)) {
            setMessage(CONNECTION_ERROR_MESSAGE);
          }
        }
      } catch (error) {
        const errorInfo = getErrorInfo(error);
        console.error("[Supabase Auth] getSession falhou", {
          ...diagnostics,
          urlExists: diagnostics.hasUrl,
          anonKeyExists: diagnostics.hasKey,
          origin,
          errorName: errorInfo.name,
          errorMessage: errorInfo.message,
          errorStatus: errorInfo.status,
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
      const origin = window.location.origin;
      const form = new FormData(event.currentTarget);
      const email = String(form.get("email")).trim();
      const password = String(form.get("password"));

      if (!diagnostics.isConfigured) {
        console.error("[Supabase Auth] Cliente Supabase não está configurado", {
          ...diagnostics,
          origin,
          mode,
        });
        setMessage(CONNECTION_ERROR_MESSAGE);
        return;
      }

      const result =
        mode === "login"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (result.error) {
        const errorInfo = getErrorInfo(result.error);
        console.error("[Supabase Auth] Erro retornado pela API", {
          ...diagnostics,
          urlExists: diagnostics.hasUrl,
          anonKeyExists: diagnostics.hasKey,
          origin,
          mode,
          errorName: errorInfo.name,
          errorMessage: errorInfo.message,
          errorStatus: errorInfo.status,
          data: result.data,
          rawError: result.error,
        });

        if (isFetchConnectionError(result.error)) {
          setMessage(CONNECTION_ERROR_MESSAGE);
          return;
        }

        setMessage(result.error?.message || CONNECTION_ERROR_MESSAGE);
        return;
      }

      if (mode === "signup" && !result.data.session) {
        setMessage("Cadastro criado. Confirme seu e-mail antes de entrar.");
        return;
      }

      router.push("/dashboard");
    } catch (error) {
      const diagnostics = getSupabaseAuthDiagnostics();
      const origin = window.location.origin;
      const errorInfo = getErrorInfo(error);
      console.error("[Supabase Auth] Falha de conexao ou fetch", {
        ...diagnostics,
        urlExists: diagnostics.hasUrl,
        anonKeyExists: diagnostics.hasKey,
        origin,
        mode,
        errorName: errorInfo.name,
        errorMessage: errorInfo.message,
        errorStatus: errorInfo.status,
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
      <PremiumInput
        label="E-mail"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="voce@barbearia.com"
      />
      <PremiumInput
        label="Senha"
        name="password"
        type="password"
        minLength={6}
        required
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        placeholder="Minimo de 6 caracteres"
      />
      <PremiumButton disabled={loading} className="mt-2 w-full">
        {loading ? "Aguarde..." : mode === "login" ? "ENTRAR" : "CRIAR CONTA"}
      </PremiumButton>
      <PremiumButton
        type="button"
        variant="ghost"
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        className="w-full"
      >
        {mode === "login" ? "CRIAR UMA CONTA" : "JA TENHO CONTA"}
      </PremiumButton>
      {message ? (
        <p className="rounded-[var(--premium-radius-md)] border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100">
          {message}
        </p>
      ) : null}
    </form>
  );
}
