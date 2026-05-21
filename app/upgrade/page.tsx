"use client";

import Link from "next/link";
import { useState } from "react";
import { supabase } from "../lib/supabase";

const comparisonRows = [
  ["Agendamentos mensais", "20", "Ilimitados"],
  ["Link publico de agendamento", "Incluido", "Incluido"],
  ["Agenda e clientes", "Incluido", "Incluido"],
  ["Historico de atendimentos", "Incluido", "Incluido"],
  ["Criacao manual de horarios", "Incluido", "Incluido"],
];

export default function UpgradePage() {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function startSubscription() {
    setLoading(true);
    setMessage("");

    try {
      const { data, error } = await supabase.auth.getSession();

      if (error) throw error;

      const token = data.session?.access_token;

      if (!token) {
        setMessage("Entre na sua conta para assinar o plano Pro.");
        return;
      }

      const response = await fetch("/api/billing/mercadopago/start", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as {
        checkoutUrl?: string;
        error?: string;
        success?: boolean;
      };

      if (!response.ok || !payload.success || !payload.checkoutUrl) {
        setMessage(payload.error ?? "Nao foi possivel iniciar a assinatura.");
        return;
      }

      window.location.href = payload.checkoutUrl;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Nao foi possivel iniciar a assinatura.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_70%_0%,rgba(214,176,122,0.14),transparent_28%),linear-gradient(135deg,#050505,#111111_58%,#080808)] px-4 py-6 text-[var(--premium-text-100)] sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-7">
        <header className="flex flex-col gap-5 border-b border-[var(--premium-border-soft)] pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--premium-gold-400)]">
              HoraAi Pro
            </p>
            <h1 className="premium-text-title mt-3 text-5xl font-bold leading-none sm:text-6xl">
              Continue recebendo agendamentos sem limite mensal.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--premium-text-300)]">
              O Pro custa menos que um corte de cabelo e libera agendamentos
              ilimitados para sua barbearia.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] px-4 py-2 text-sm font-bold text-[var(--premium-text-300)]"
          >
            Voltar ao dashboard
          </Link>
        </header>

        <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <article className="rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-[rgba(16,16,16,0.72)] p-5 shadow-[var(--premium-shadow-soft)]">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[var(--premium-text-500)]">
              Plano Gratuito
            </p>
            <div className="mt-4 flex items-end gap-2">
              <span className="premium-text-title text-5xl font-bold">R$0</span>
              <span className="pb-2 text-sm font-bold text-[var(--premium-text-500)]">
                /mes
              </span>
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--premium-text-300)]">
              Ideal para testar o HoraAi e validar o agendamento online com seus
              primeiros clientes.
            </p>
            <div className="mt-6 rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-black/24 p-4">
              <p className="text-3xl font-black text-[var(--premium-gold-300)]">
                20
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--premium-text-300)]">
                agendamentos por mes
              </p>
            </div>
          </article>

          <article className="relative overflow-hidden rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-strong)] bg-[linear-gradient(145deg,rgba(214,176,122,0.16),rgba(16,16,16,0.82)_42%,rgba(16,16,16,0.74))] p-5 shadow-[var(--premium-shadow-card)]">
            <div className="absolute right-4 top-4 rounded-full border border-[var(--premium-border-strong)] bg-black/30 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-[var(--premium-gold-300)]">
              Recomendado
            </div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[var(--premium-gold-300)]">
              Plano Pro
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <span className="pb-2 text-xl font-black text-[var(--premium-gold-300)]">
                R$
              </span>
              <span className="premium-text-title text-6xl font-bold leading-none">
                19,90
              </span>
              <span className="pb-2 text-sm font-bold text-[var(--premium-gold-300)]">
                /mes
              </span>
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--premium-text-200)]">
              Para continuar usando o link publico sem travar nos 20
              agendamentos mensais do plano gratuito.
            </p>
            <div className="mt-6 rounded-[var(--premium-radius-md)] border border-[var(--premium-border-strong)] bg-black/28 p-4">
              <p className="text-3xl font-black text-[var(--premium-gold-300)]">
                Ilimitado
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--premium-text-300)]">
                agendamentos todos os meses
              </p>
            </div>
            <button
              type="button"
              onClick={startSubscription}
              disabled={loading}
              className="mt-6 inline-flex min-h-14 w-full items-center justify-center rounded-[var(--premium-radius-md)] border border-[var(--premium-border-strong)] bg-[linear-gradient(135deg,var(--premium-gold-300),var(--premium-gold-500))] px-5 text-base font-black text-black shadow-[0_18px_44px_rgba(214,176,122,0.2)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Abrindo Mercado Pago..." : "Assinar Pro"}
            </button>
            {message ? (
              <p className="mt-3 rounded-[var(--premium-radius-md)] border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100">
                {message}
              </p>
            ) : null}
          </article>
        </section>

        <section className="overflow-hidden rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-[rgba(16,16,16,0.72)] shadow-[var(--premium-shadow-soft)]">
          <div className="border-b border-[var(--premium-border-soft)] p-5">
            <h2 className="text-xl font-black text-[var(--premium-text-100)]">
              Comparacao dos planos
            </h2>
            <p className="mt-1 text-sm text-[var(--premium-text-500)]">
              Apenas recursos que ja existem hoje no HoraAi.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
              <thead className="bg-black/24 text-xs uppercase tracking-[0.12em] text-[var(--premium-text-500)]">
                <tr>
                  <th className="px-5 py-3">Recurso</th>
                  <th className="px-5 py-3">Gratuito</th>
                  <th className="px-5 py-3">Pro</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map(([feature, free, pro]) => (
                  <tr key={feature} className="border-t border-white/[0.06]">
                    <td className="px-5 py-4 font-bold text-[var(--premium-text-100)]">
                      {feature}
                    </td>
                    <td className="px-5 py-4 text-[var(--premium-text-300)]">
                      {free}
                    </td>
                    <td className="px-5 py-4 font-bold text-[var(--premium-gold-300)]">
                      {pro}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
