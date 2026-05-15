"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PremiumCard } from "../components/ui/premium";
import { AuthPanel } from "./_components/auth-panel";
import { supabase } from "./lib/supabase";

const problemCards = [
  {
    title: "Conversas se perdem",
    text: "Mensagens desencontradas e informacoes repetidas.",
    lines: ["Tem horario hoje?", "Tenho sim. Qual hora?", "Pode ser 15h?"],
  },
  {
    title: "Horarios duplicados",
    text: "Dois clientes tentam marcar o mesmo horario.",
    lines: ["Consegue antecipar?", "Deixa eu ver aqui", "09:30 ainda esta livre?"],
  },
  {
    title: "Faltas e atrasos",
    text: "Sem lembretes, seu tempo e lucro sao perdidos.",
    lines: ["Confirmado entao.", "Beleza, te espero.", "Mensagem nao lida"],
  },
];

const flowSteps = [
  {
    title: "Cliente agenda",
    text: "Pelo link, em segundos, sem precisar falar com voce.",
  },
  {
    title: "Voce recebe na hora",
    text: "Notificacao automatica no seu celular.",
  },
  {
    title: "Agenda se organiza",
    text: "Horario registrado, cliente salvo, tudo no lugar.",
  },
  {
    title: "Voce ganha tempo",
    text: "Menos bagunca, mais foco no que realmente importa.",
  },
];

const priceFeatures = [
  "Agendamento online",
  "Link de agendamento",
  "Notificacoes automaticas",
  "Controle de clientes",
  "Horarios organizados",
  "Suporte por e-mail",
];

const appointments = [
  ["08:00", "Corte de Cabelo", "08:00 - 09:00", "from-[#162536] to-[#0c1420]"],
  ["09:30", "Barba", "09:30 - 10:30", "from-[#261d3d] to-[#120f22]"],
  ["11:00", "Corte + Barba", "11:00 - 12:00", "from-[#372411] to-[#1a1208]"],
  ["13:00", "Pigmentacao", "13:00 - 14:00", "from-[#111e31] to-[#080f18]"],
];

type AuthMode = "login" | "signup";

export default function Home() {
  const router = useRouter();
  const authRef = useRef<HTMLElement | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [checkingAuth, setCheckingAuth] = useState(true);

  const openAuth = useCallback((mode: AuthMode) => {
    setAuthMode(mode);
    window.requestAnimationFrame(() => {
      authRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  useEffect(() => {
    let mounted = true;

    async function restoreSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) {
        console.error("[Home Auth] Erro ao restaurar sessao", error);
        setCheckingAuth(false);
        return;
      }

      if (data.session?.user) {
        router.replace("/dashboard");
        return;
      }

      setCheckingAuth(false);
    }

    restoreSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === "SIGNED_IN" && session?.user) {
        router.replace("/dashboard");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

  if (checkingAuth) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[var(--premium-bg-950)] px-6 text-[var(--premium-text-100)]">
        <div className="grid justify-items-center gap-4">
          <Image
            src="/HoraAi-AppIconAB.png"
            alt="HoraAi"
            width={96}
            height={96}
            priority
            className="h-20 w-20 object-contain"
          />
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--premium-gold-300)]">
            Carregando
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-[#050607] text-[var(--premium-text-100)]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_70%_0%,rgba(214,176,122,0.12),transparent_28%),linear-gradient(135deg,#050607_0%,#090b0d_46%,#111315_100%)]" />
      <div className="pointer-events-none fixed inset-x-0 top-0 hidden h-96 bg-[radial-gradient(circle_at_68%_38%,rgba(214,176,122,0.16),transparent_34%)] sm:block" />

      <nav className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
        <a href="#inicio" className="flex items-center gap-3" aria-label="HoraAi">
          <Image
            src="/logoAB.png"
            alt="HoraAi"
            width={220}
            height={65}
            priority
            className="h-10 w-auto object-contain sm:h-12"
          />
        </a>

        <div className="hidden items-center gap-8 text-sm font-medium text-white/72 md:flex">
          <a className="transition hover:text-white" href="#recursos">
            Recursos
          </a>
          <a className="transition hover:text-white" href="#como-funciona">
            Como funciona
          </a>
          <a className="transition hover:text-white" href="#precos">
            Precos
          </a>
          <a className="transition hover:text-white" href="#suporte">
            Suporte
          </a>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => openAuth("login")}
            className="hidden rounded-[var(--premium-radius-md)] px-4 py-2 text-sm font-semibold text-white/74 transition hover:text-white sm:inline-flex"
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => openAuth("signup")}
            className="rounded-[var(--premium-radius-md)] border border-[#d6b07a]/45 bg-[linear-gradient(135deg,#e0c08d,#b8833d)] px-4 py-2.5 text-sm font-black text-[#090807] shadow-[0_16px_38px_rgba(214,176,122,0.2)] transition hover:brightness-110"
          >
            Teste gratis
          </button>
        </div>
      </nav>

      <section
        id="inicio"
        className="landing-reveal relative z-10 mx-auto grid min-h-[calc(100dvh-5.5rem)] w-full max-w-7xl items-center gap-10 px-4 pb-14 pt-6 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-8 lg:px-8 lg:pb-20"
      >
        <div className="max-w-xl">
          <div className="mb-7 inline-flex rounded-[var(--premium-radius-md)] border border-[#d6b07a]/35 bg-black/30 px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.18em] text-[#e0c08d]">
            Feito para barbeiros
          </div>

          <h1 className="premium-text-title max-w-[13ch] text-6xl font-bold leading-[0.92] text-white sm:text-7xl lg:text-8xl">
            Agenda online para{" "}
            <span className="text-[var(--premium-gold-400)]">barbeiros.</span>
          </h1>

          <p className="mt-7 max-w-md text-3xl font-semibold leading-tight text-white/70 sm:text-4xl">
            Simples para o cliente. Rapida para voce.
          </p>
          <p className="mt-7 max-w-md text-lg leading-8 text-white/68">
            Seu cliente agenda sozinho. Voce recebe no celular e organiza seu
            dia.
          </p>

          <div className="mt-10 flex flex-col items-start gap-3">
            <button
              type="button"
              onClick={() => openAuth("signup")}
              className="group inline-flex min-h-14 items-center justify-center gap-4 rounded-[var(--premium-radius-md)] border border-[#e0c08d]/50 bg-[linear-gradient(135deg,#e6c58f,#b9823e)] px-7 text-base font-black text-[#070707] shadow-[0_20px_54px_rgba(214,176,122,0.23)] transition hover:-translate-y-0.5 hover:brightness-110"
            >
              Teste gratis por 30 dias
              <span className="transition group-hover:translate-x-1">-&gt;</span>
            </button>
            <p className="text-sm text-white/48">
              Sem cartao de credito. Cancele quando quiser.
            </p>
          </div>
        </div>

        <ProductMockup />
      </section>

      <section
        id="recursos"
        className="landing-reveal relative z-10 border-y border-white/[0.07] bg-black/18 px-4 py-16 sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-xl text-center">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--premium-gold-400)]">
              O problema
            </p>
            <h2 className="premium-text-title mt-3 text-4xl font-bold leading-tight text-white sm:text-5xl">
              WhatsApp nao foi feito para agenda.
            </h2>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {problemCards.map((card) => (
              <article
                key={card.title}
                className="rounded-[1.15rem] border border-white/[0.09] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.015))] p-4 shadow-[0_22px_70px_rgba(0,0,0,0.28)]"
              >
                <div className="rounded-[0.9rem] border border-white/[0.06] bg-[#080a0b] p-3">
                  <div className="mb-3 flex items-center gap-2 border-b border-white/[0.06] pb-3">
                    <span className="h-8 w-8 rounded-full bg-[linear-gradient(135deg,#4a4d50,#1a1c1e)]" />
                    <div>
                      <p className="text-xs font-bold text-white/84">Cliente</p>
                      <p className="text-[0.65rem] text-white/38">online</p>
                    </div>
                  </div>
                  <div className="grid min-h-28 content-start gap-2">
                    {card.lines.map((line, index) => (
                      <span
                        key={line}
                        className={`max-w-[82%] rounded-xl px-3 py-2 text-xs leading-5 ${
                          index === 1
                            ? "ml-auto bg-[#10251e] text-white/78"
                            : "bg-white/[0.055] text-white/66"
                        }`}
                      >
                        {line}
                      </span>
                    ))}
                  </div>
                </div>
                <h3 className="mt-5 text-lg font-bold text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-6 text-white/55">{card.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="como-funciona"
        className="landing-reveal relative z-10 px-4 py-16 sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--premium-gold-400)]">
              A solucao
            </p>
            <h2 className="premium-text-title mt-3 text-4xl font-bold leading-tight text-white sm:text-5xl">
              Tudo acontece{" "}
              <span className="text-[var(--premium-gold-400)]">
                automaticamente.
              </span>
            </h2>
          </div>

          <div className="mt-11 grid gap-4 lg:grid-cols-4">
            {flowSteps.map((step, index) => (
              <article key={step.title} className="relative">
                <div className="min-h-52 rounded-[1.15rem] border border-white/[0.09] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] p-4">
                  <FlowVisual index={index} />
                </div>
                {index < flowSteps.length - 1 ? (
                  <span className="absolute -right-3 top-24 hidden text-3xl text-[#d6b07a]/55 lg:block">
                    -&gt;
                  </span>
                ) : null}
                <h3 className="mt-5 text-lg font-bold text-white">
                  {index + 1}. {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-white/58">{step.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="precos"
        className="landing-reveal relative z-10 px-4 pb-10 sm:px-6 lg:px-8"
      >
        <div className="mx-auto grid max-w-6xl gap-8 rounded-[1.35rem] border border-white/[0.1] bg-[linear-gradient(135deg,rgba(255,255,255,0.055),rgba(255,255,255,0.015))] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.34)] sm:p-8 lg:grid-cols-[1.08fr_0.92fr] lg:p-12">
          <div>
            <h2 className="premium-text-title max-w-2xl text-4xl font-bold leading-tight text-white sm:text-5xl">
              Comece gratis por 30 dias.
              <span className="block text-[var(--premium-gold-400)]">
                Depois, apenas R$ 19,90/mes.
              </span>
            </h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {priceFeatures.map((feature) => (
                <p key={feature} className="flex items-center gap-3 text-sm text-white/72">
                  <span className="grid h-5 w-5 place-items-center rounded-full border border-[#d6b07a]/55 text-xs text-[#d6b07a]">
                    OK
                  </span>
                  {feature}
                </p>
              ))}
            </div>
          </div>

          <div className="rounded-[1rem] border border-white/[0.08] bg-black/26 p-6">
            <p className="text-sm font-semibold text-white/72">
              Menos que um corte por mes.
            </p>
            <div className="mt-5 flex items-end gap-2">
              <span className="pb-2 text-2xl font-black text-[var(--premium-gold-400)]">
                R$
              </span>
              <span className="premium-text-title text-7xl font-bold leading-none text-white">
                19,90
              </span>
              <span className="pb-3 text-lg font-bold text-[var(--premium-gold-400)]">
                /mes
              </span>
            </div>
            <button
              type="button"
              onClick={() => openAuth("signup")}
              className="mt-8 min-h-14 w-full rounded-[var(--premium-radius-md)] border border-[#e0c08d]/50 bg-[linear-gradient(135deg,#e6c58f,#b9823e)] px-6 text-base font-black text-[#070707] shadow-[0_18px_44px_rgba(214,176,122,0.2)] transition hover:brightness-110"
            >
              Comecar agora
            </button>
            <p className="mt-5 text-sm leading-6 text-white/52">
              Sem cartao de credito. Cancele quando quiser.
            </p>
          </div>
        </div>
      </section>

      <section
        ref={authRef}
        className="landing-reveal relative z-10 mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.92fr_0.72fr] lg:items-center lg:px-8"
      >
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--premium-gold-400)]">
            Acesso
          </p>
          <h2 className="premium-text-title mt-3 max-w-xl text-4xl font-bold leading-tight text-white sm:text-5xl">
            Crie sua conta gratis ou entre para continuar.
          </h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-white/58">
            Este e o mesmo acesso usado pelo dashboard do HoraAi. Nenhuma rota
            interna foi alterada.
          </p>
        </div>

        <PremiumCard className="auth-card w-full p-5 sm:p-6">
          <div className="mb-6">
            <h3 className="premium-text-title text-3xl font-bold text-white">
              {authMode === "login" ? "Entrar" : "Teste gratis"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-white/55">
              {authMode === "login"
                ? "Acesse sua agenda e organize seu dia."
                : "Comece sem cartao de credito."}
            </p>
          </div>
          <AuthPanel mode={authMode} onModeChange={setAuthMode} />
        </PremiumCard>
      </section>

      <footer
        id="suporte"
        className="relative z-10 border-t border-white/[0.07] px-4 py-10 sm:px-6 lg:px-8"
      >
        <div className="mx-auto grid max-w-6xl gap-8 text-sm text-white/56 sm:grid-cols-2 lg:grid-cols-[1.2fr_0.7fr_0.8fr_1fr]">
          <div>
            <Image
              src="/logoAB.png"
              alt="HoraAi"
              width={190}
              height={56}
              className="h-10 w-auto object-contain"
            />
            <p className="mt-4 leading-6">
              Mais organizacao.
              <br />
              Mais tempo. Mais lucro.
            </p>
          </div>
          <div>
            <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-white/42">
              Navegacao
            </p>
            <div className="grid gap-2">
              <a href="#recursos" className="hover:text-white">
                Recursos
              </a>
              <a href="#como-funciona" className="hover:text-white">
                Como funciona
              </a>
              <a href="#precos" className="hover:text-white">
                Precos
              </a>
              <a href="#suporte" className="hover:text-white">
                Suporte
              </a>
            </div>
          </div>
          <div>
            <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-white/42">
              Contato
            </p>
            <a href="mailto:suporte@horaai.com" className="hover:text-white">
              suporte@horaai.com
            </a>
          </div>
          <div className="sm:text-right">
            <p>© 2026 HoraAi.</p>
            <p className="mt-2">Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}

function ProductMockup() {
  return (
    <div className="landing-mockup relative mx-auto w-full max-w-3xl lg:mr-[-2rem]">
      <div className="absolute -inset-4 rounded-[2rem] bg-[radial-gradient(circle_at_55%_0%,rgba(224,192,141,0.18),transparent_48%)]" />
      <div className="relative rounded-[1.65rem] border border-[#d6b07a]/26 bg-[linear-gradient(145deg,#151719,#060708_56%,#0c0d0f)] p-2 shadow-[0_34px_100px_rgba(0,0,0,0.55)]">
        <div className="rounded-[1.25rem] border border-white/[0.08] bg-[#07090b] p-4 sm:p-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-[#d6b07a]/35 text-xs font-black text-[#d6b07a]">
                HA
              </span>
              <span className="text-xl font-bold text-white">HoraAi</span>
            </div>
            <button className="rounded-lg border border-[#d6b07a]/30 px-3 py-2 text-xs font-bold text-[#e0c08d]">
              Novo agendamento
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <aside className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
              {[
                "Agenda",
                "Agendamentos",
                "Clientes",
                "Servicos",
                "Horarios",
                "Configuracoes",
              ].map((item, index) => (
                <div
                  key={item}
                  className={`rounded-lg px-3 py-3 text-xs font-bold ${
                    index === 0
                      ? "bg-[#d6b07a]/12 text-[#e0c08d]"
                      : "text-white/48"
                  }`}
                >
                  {item}
                </div>
              ))}
            </aside>

            <section className="rounded-xl border border-white/[0.07] bg-black/24 p-4">
              <div className="mb-5 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-white">Agenda do dia</h2>
                <span className="rounded-lg border border-white/[0.08] px-3 py-2 text-xs font-bold text-white/74">
                  15/05/2026
                </span>
              </div>

              <div className="grid gap-3">
                {appointments.map(([time, title, range, gradient]) => (
                  <div key={`${time}-${title}`} className="grid grid-cols-[3.2rem_1fr] gap-3">
                    <span className="pt-3 text-xs font-semibold text-white/52">
                      {time}
                    </span>
                    <div
                      className={`rounded-lg border border-white/[0.06] bg-gradient-to-r ${gradient} p-3`}
                    >
                      <p className="text-sm font-bold text-white">{title}</p>
                      <p className="mt-1 text-xs text-white/56">{range}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function FlowVisual({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="grid gap-3 text-xs text-white/58">
        <p>Seu link</p>
        <div className="rounded-lg bg-black/28 p-3 text-white/70">hora.ai/agendar</div>
        <p>Escolha o servico</p>
        <div className="grid gap-2">
          {["Corte de cabelo", "Barba", "Corte + Barba"].map((item) => (
            <div key={item} className="flex justify-between rounded-lg bg-white/[0.055] p-2">
              <span>{item}</span>
              <span>R$ --</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (index === 1) {
    return (
      <div className="grid h-full place-items-center rounded-xl bg-[radial-gradient(circle_at_50%_10%,rgba(214,176,122,0.18),transparent_42%),#080a0d] p-4 text-center">
        <p className="premium-text-title text-5xl font-bold text-[#e0c08d]">
          09:30
        </p>
        <div className="mt-5 rounded-xl border border-white/[0.1] bg-white/[0.08] p-3 text-left text-xs text-white/70">
          <p className="font-bold text-white">HoraAi</p>
          <p className="mt-1">Novo agendamento recebido.</p>
        </div>
      </div>
    );
  }

  if (index === 2) {
    return (
      <div className="grid gap-3">
        {["10:00 Corte", "11:00 Barba", "12:00 Corte + Barba"].map((item) => (
          <div key={item} className="rounded-lg bg-white/[0.055] p-3 text-sm font-bold text-white/74">
            {item}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid h-full place-items-center rounded-xl border border-[#d6b07a]/18 bg-[linear-gradient(145deg,rgba(214,176,122,0.12),rgba(255,255,255,0.025))] p-5 text-center">
      <p className="premium-text-title text-5xl font-bold text-white">Livre</p>
      <p className="mt-3 text-sm leading-6 text-white/56">
        Menos mensagens. Mais foco no atendimento.
      </p>
    </div>
  );
}
