"use client";

import Image from "next/image";
import { useState } from "react";
import { PremiumCard } from "../components/ui/premium";
import { AuthPanel } from "./_components/auth-panel";

const highlights = [
  "Link de agendamento",
  "Controle de clientes",
  "Horários organizados",
];

export default function Home() {
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");

  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-[var(--premium-bg-950)] text-[var(--premium-text-100)] lg:overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(214,176,122,0.18),transparent_30%),radial-gradient(circle_at_82%_10%,rgba(255,255,255,0.07),transparent_24%),linear-gradient(135deg,#080808_0%,#101010_48%,#161616_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.14] [background:linear-gradient(90deg,rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="pointer-events-none absolute -left-28 top-16 h-80 w-80 rounded-full bg-[rgba(214,176,122,0.1)] blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-10rem] right-[-8rem] h-[28rem] w-[28rem] rounded-full bg-[rgba(200,155,94,0.1)] blur-3xl" />

      <section className="relative mx-auto grid min-h-dvh w-full max-w-6xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[55fr_45fr] lg:items-center lg:gap-10 lg:px-8 lg:py-8">
        <div className="grid content-center gap-7 pt-4 lg:pt-0">
          <div className="max-w-[640px] space-y-5">
            <div className="w-full max-w-[360px] sm:max-w-[440px]">
              <Image
                src="/logoAB.png"
                alt="HoraAi"
                width={1400}
                height={411}
                priority
                className="h-auto w-full object-contain"
                sizes="(max-width: 640px) 86vw, 440px"
              />
            </div>

            <div className="space-y-3">
              <h1 className="premium-text-title text-4xl font-bold leading-[1.02] text-[var(--premium-text-100)] sm:text-5xl lg:text-6xl xl:text-7xl">
                Sua agenda online
              </h1>
              <p className="max-w-2xl text-2xl font-semibold leading-[1.08] text-[var(--premium-gold-300)] sm:text-3xl lg:text-4xl">
                simples para o cliente, perfeita para o barbeiro.
              </p>
              <p className="max-w-xl text-base leading-7 text-[var(--premium-text-300)] sm:text-lg">
                Crie seu link de agendamento, receba clientes online e tenha
                controle do seu dia a dia.
              </p>
            </div>
          </div>

          <div className="grid max-w-[640px] gap-3 sm:grid-cols-3">
            {highlights.map((item) => (
              <div
                key={item}
                className="group rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-white/[0.04] px-4 py-3 shadow-[var(--premium-shadow-soft)] backdrop-blur-xl transition hover:border-[var(--premium-border-strong)] hover:bg-white/[0.065]"
              >
                <span className="mb-3 block h-1.5 w-8 rounded-full bg-[var(--premium-gold-400)] opacity-80 transition group-hover:w-10" />
                <span className="text-sm font-bold leading-5 text-[var(--premium-text-100)]">
                  {item}
                </span>
              </div>
            ))}
          </div>

          <div className="grid max-w-[640px] gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <p className="max-w-md text-sm leading-6 text-[var(--premium-text-300)]">
              Agendamento simples para clientes. Controle inteligente para
              barbeiros.
            </p>
            <button
              type="button"
              onClick={() => setAuthMode("signup")}
              className="w-fit rounded-[var(--premium-radius-md)] border border-[var(--premium-border-strong)] bg-[linear-gradient(135deg,var(--premium-gold-300),var(--premium-gold-500))] px-5 py-3 text-sm font-black tracking-[0.04em] text-[#080808] shadow-[0_18px_48px_rgba(214,176,122,0.22)] transition hover:brightness-110"
            >
              Começar teste grátis
            </button>
          </div>
        </div>

        <div className="grid items-center pb-4 lg:pb-0">
          <PremiumCard className="mx-auto w-full max-w-[420px] p-5 sm:p-6">
            <div className="mb-6 grid gap-5">
              <div className="flex items-center gap-4">
                <Image
                  src="/HoraAi-AppIconAB.png"
                  alt="HoraAi"
                  width={96}
                  height={96}
                  className="h-12 w-12 shrink-0 object-contain drop-shadow-[0_0_18px_rgba(214,176,122,0.24)]"
                />
                <div className="h-px flex-1 bg-gradient-to-r from-[var(--premium-border-strong)] to-transparent" />
              </div>

              <div className="space-y-1.5">
                <h2 className="premium-text-title text-3xl font-bold leading-none text-[var(--premium-text-100)] sm:text-4xl">
                  Bem-vindo ao HoraAi
                </h2>
                <p className="text-sm leading-6 text-[var(--premium-text-300)]">
                  Acesse sua agenda e organize sua rotina.
                </p>
              </div>
            </div>

            <AuthPanel mode={authMode} onModeChange={setAuthMode} />
          </PremiumCard>
        </div>
      </section>
    </main>
  );
}
