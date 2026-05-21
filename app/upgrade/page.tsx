import Link from "next/link";

const plans = [
  {
    description: "Para testar o HoraAi com agenda online e link publico.",
    features: ["20 agendamentos por mes", "Link publico de agendamento", "Clientes e servicos"],
    name: "Free",
    price: "R$0",
  },
  {
    description: "Para barbearias que querem continuar recebendo horarios sem limite mensal.",
    features: [
      "Agendamentos ilimitados",
      "Historico de clientes",
      "Dashboard e notificacoes disponiveis no app",
    ],
    name: "Pro",
    price: "R$19,90/mes",
  },
];

export default function UpgradePage() {
  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_70%_0%,rgba(214,176,122,0.12),transparent_28%),linear-gradient(135deg,#070707,#101010)] px-4 py-8 text-[var(--premium-text-100)] sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-5xl gap-8">
        <header className="flex flex-col gap-4 border-b border-[var(--premium-border-soft)] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--premium-gold-400)]">
              Planos HoraAi
            </p>
            <h1 className="premium-text-title mt-3 text-4xl font-bold sm:text-5xl">
              Escolha seu plano
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--premium-text-300)]">
              A estrutura de planos ja esta preparada. A assinatura online ainda
              nao esta ativa.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] px-4 py-2 text-sm font-bold text-[var(--premium-text-300)]"
          >
            Voltar ao dashboard
          </Link>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className="rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-[rgba(16,16,16,0.72)] p-5 shadow-[var(--premium-shadow-soft)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="premium-text-title text-4xl font-bold">
                    {plan.name}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--premium-text-300)]">
                    {plan.description}
                  </p>
                </div>
                <p className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-strong)] px-3 py-2 text-sm font-black text-[var(--premium-gold-300)]">
                  {plan.price}
                </p>
              </div>

              <ul className="mt-6 grid gap-3 text-sm text-[var(--premium-text-200)]">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3">
                    <span className="grid h-5 w-5 place-items-center rounded-full border border-[var(--premium-border-strong)] text-[0.62rem] font-black text-[var(--premium-gold-300)]">
                      OK
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              {plan.name === "Pro" ? (
                <button
                  type="button"
                  disabled
                  className="mt-7 inline-flex min-h-12 w-full cursor-not-allowed items-center justify-center rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-white/[0.06] px-4 text-sm font-black text-[var(--premium-text-300)]"
                >
                  Assinar Pro em breve
                </button>
              ) : (
                <Link
                  href="/dashboard"
                  className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-[var(--premium-radius-md)] border border-[var(--premium-border-strong)] px-4 text-sm font-black text-[var(--premium-gold-300)]"
                >
                  Continuar no Free
                </Link>
              )}
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
