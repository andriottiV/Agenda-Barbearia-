import Link from "next/link";
import { AuthPanel } from "./_components/auth-panel";

export default function Home() {
  return (
    <main className="min-h-screen bg-stone-50 text-slate-950">
      <section className="mx-auto grid min-h-screen w-full max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div className="grid gap-8">
          <div className="grid gap-4">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Agenda para barbearia
            </p>
            <h1 className="max-w-3xl text-4xl font-bold leading-tight text-slate-950 sm:text-6xl">
              Agendamentos simples, servicos organizados e link publico para
              clientes.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-slate-700">
              MVP pronto para Vercel com Next.js App Router, Supabase Auth,
              Supabase Database e confirmacao por WhatsApp.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {["Agenda do dia", "Bloqueio de horarios", "wa.me automatico"].map(
              (item) => (
                <div
                  key={item}
                  className="rounded-md border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800"
                >
                  {item}
                </div>
              ),
            )}
          </div>
          <Link
            href="/agendar/barbearia-demo"
            className="w-fit rounded-md border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 transition hover:border-emerald-700 hover:text-emerald-800"
          >
            Ver fluxo publico de exemplo
          </Link>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-2 text-2xl font-bold">Entrar no painel</h2>
          <p className="mb-6 text-sm leading-6 text-slate-600">
            Use uma conta Supabase Auth. Depois configure seu perfil, servicos e
            horarios.
          </p>
          <AuthPanel />
        </div>
      </section>
    </main>
  );
}
