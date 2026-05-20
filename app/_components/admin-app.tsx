"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ADMIN_EMAIL } from "../lib/admin-constants";
import { supabase } from "../lib/supabase";

type AdminMetrics = {
  agendaConfigured: number;
  agendaMissing: number;
  totalUsers: number;
  trialActive: number;
  trialExpiring7Days: number;
  usersLast30Days: number;
};

type AdminUser = {
  agendaConfigured: boolean;
  createdAt: string | null;
  daysToTrialEnd: number;
  email: string;
  id: string;
  lastSignInAt: string | null;
  name: string;
  planStatus: string;
  publicUrl: string | null;
  pushEnabled: boolean;
  shopName: string | null;
  trialEndsAt: string;
  trialStatus: string;
};

type AdminUsersResponse = {
  error?: string;
  metrics?: AdminMetrics;
  success: boolean;
  users?: AdminUser[];
};

type UserDetail = {
  appointmentsCount: number;
  businessHours: Array<{
    active: boolean;
    closes_at: string;
    id: string;
    opens_at: string;
    weekday: number;
  }>;
  lastAppointments: Array<{
    appointmentDate: string;
    appointmentTime: string;
    clientName: string | null;
    id: string;
    serviceName: string | null;
    status: string;
  }>;
  publicUrl: string | null;
  pushSubscriptionsCount: number;
  services: Array<{
    active: boolean;
    duration_minutes: number;
    id: string;
    name: string;
    price: number | string;
  }>;
  shop: {
    address: string | null;
    id: string;
    name: string;
    phone: string | null;
    slug: string;
  } | null;
  user: {
    createdAt: string | null;
    email: string;
    id: string;
    lastSignInAt: string | null;
  };
};

type UserDetailResponse = {
  detail?: UserDetail;
  error?: string;
  success: boolean;
};

const metricCards: Array<{
  key: keyof AdminMetrics;
  label: string;
}> = [
  { key: "totalUsers", label: "Total de usuarios" },
  { key: "usersLast30Days", label: "Criados nos ultimos 30 dias" },
  { key: "trialActive", label: "Testes gratis ativos" },
  { key: "trialExpiring7Days", label: "Expiram em ate 7 dias" },
  { key: "agendaConfigured", label: "Com agenda configurada" },
  { key: "agendaMissing", label: "Sem agenda configurada" },
];

function formatDate(value: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

async function sessionToken() {
  const { data, error } = await supabase.auth.getSession();

  if (error) throw error;

  return data.session?.access_token ?? "";
}

export function AdminApp() {
  const router = useRouter();
  const [accessDenied, setAccessDenied] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState("");
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);

  const origin = useMemo(
    () => (typeof window === "undefined" ? "" : window.location.origin),
    [],
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const token = await sessionToken();

      if (!token) {
        router.replace("/dashboard");
        return;
      }

      const response = await fetch("/api/admin/users", {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as AdminUsersResponse;

      if (response.status === 403) {
        setAccessDenied(true);
        return;
      }

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Nao foi possivel carregar usuarios.");
        return;
      }

      setMetrics(payload.metrics ?? null);
      setUsers(payload.users ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Nao foi possivel carregar o admin.",
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    let mounted = true;

    async function checkAccess() {
      const { data, error: userError } = await supabase.auth.getUser();

      if (!mounted) return;

      if (userError || !data.user) {
        router.replace("/dashboard");
        return;
      }

      if (data.user.email?.toLowerCase() !== ADMIN_EMAIL) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      await loadUsers();
    }

    checkAccess();

    return () => {
      mounted = false;
    };
  }, [loadUsers, router]);

  async function copyEmail(email: string) {
    await navigator.clipboard.writeText(email);
    setCopiedEmail(email);
    window.setTimeout(() => setCopiedEmail(""), 1800);
  }

  async function openDetail(userId: string) {
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);

    try {
      const token = await sessionToken();
      const response = await fetch(`/api/admin/users/${userId}`, {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as UserDetailResponse;

      if (!response.ok || !payload.success || !payload.detail) {
        setDetailError(payload.error ?? "Nao foi possivel carregar detalhes.");
        return;
      }

      setDetail(payload.detail);
    } catch (detailLoadError) {
      setDetailError(
        detailLoadError instanceof Error
          ? detailLoadError.message
          : "Nao foi possivel carregar detalhes.",
      );
    } finally {
      setDetailLoading(false);
    }
  }

  if (accessDenied) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[var(--premium-bg-950)] px-4 text-[var(--premium-text-100)]">
        <section className="max-w-md rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-[rgba(16,16,16,0.78)] p-6 text-center shadow-[var(--premium-shadow-soft)]">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--premium-gold-400)]">
            Admin
          </p>
          <h1 className="premium-text-title mt-3 text-4xl font-bold">
            Acesso negado
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--premium-text-300)]">
            Esta area e restrita ao administrador do HoraAi.
          </p>
          <Link
            href="/dashboard"
            className="mt-6 inline-flex rounded-[var(--premium-radius-md)] border border-[var(--premium-border-strong)] px-4 py-3 text-sm font-bold text-[var(--premium-gold-300)]"
          >
            Voltar ao dashboard
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_70%_0%,rgba(214,176,122,0.12),transparent_28%),linear-gradient(135deg,#070707,#101010)] px-4 py-5 text-[var(--premium-text-100)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 border-b border-[var(--premium-border-soft)] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--premium-gold-400)]">
              HoraAi Admin
            </p>
            <h1 className="premium-text-title mt-2 text-4xl font-bold sm:text-5xl">
              Controle de usuarios
            </h1>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={loadUsers}
              className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-black/20 px-4 py-3 text-sm font-bold text-[var(--premium-text-300)] transition hover:border-[var(--premium-border-strong)]"
            >
              Atualizar
            </button>
            <Link
              href="/dashboard"
              className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-strong)] bg-[linear-gradient(135deg,var(--premium-gold-300),var(--premium-gold-500))] px-4 py-3 text-sm font-black text-black"
            >
              Dashboard
            </Link>
          </div>
        </header>

        {loading ? (
          <section className="mt-8 grid gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-28 animate-pulse rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-white/[0.04]"
              />
            ))}
          </section>
        ) : error ? (
          <p className="mt-8 rounded-[var(--premium-radius-md)] border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
            {error}
          </p>
        ) : (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {metricCards.map((card) => (
                <article
                  key={card.key}
                  className="rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-[rgba(16,16,16,0.72)] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.24)]"
                >
                  <p className="text-sm text-[var(--premium-text-300)]">
                    {card.label}
                  </p>
                  <p className="premium-text-title mt-3 text-5xl font-bold">
                    {metrics?.[card.key] ?? 0}
                  </p>
                </article>
              ))}
            </section>

            <section className="mt-8 overflow-hidden rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-[rgba(16,16,16,0.72)]">
              <div className="border-b border-[var(--premium-border-soft)] p-4">
                <h2 className="text-lg font-bold">Usuarios reais</h2>
                <p className="mt-1 text-sm text-[var(--premium-text-500)]">
                  Dados vindos do Supabase. Plano e teste sao derivados da data
                  de criacao porque nao ha tabela de billing no projeto.
                </p>
              </div>

              {!users.length ? (
                <p className="p-6 text-sm text-[var(--premium-text-300)]">
                  Nenhum usuario encontrado.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[1050px] w-full border-collapse text-left text-sm">
                    <thead className="bg-black/24 text-xs uppercase tracking-[0.08em] text-[var(--premium-text-500)]">
                      <tr>
                        <th className="px-4 py-3">Nome/empresa</th>
                        <th className="px-4 py-3">Email</th>
                        <th className="px-4 py-3">Criado em</th>
                        <th className="px-4 py-3">Teste gratis</th>
                        <th className="px-4 py-3">Plano/status</th>
                        <th className="px-4 py-3">Agenda</th>
                        <th className="px-4 py-3">Push</th>
                        <th className="px-4 py-3">Ultimo acesso</th>
                        <th className="px-4 py-3">Acoes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr
                          key={user.id}
                          className="border-t border-white/[0.06] text-[var(--premium-text-300)]"
                        >
                          <td className="px-4 py-4 font-bold text-[var(--premium-text-100)]">
                            {user.name}
                          </td>
                          <td className="px-4 py-4">{user.email || "-"}</td>
                          <td className="px-4 py-4">{formatDate(user.createdAt)}</td>
                          <td className="px-4 py-4">
                            {user.trialStatus}
                            {user.daysToTrialEnd >= 0
                              ? ` (${user.daysToTrialEnd} dias)`
                              : ""}
                          </td>
                          <td className="px-4 py-4">{user.planStatus}</td>
                          <td className="px-4 py-4">
                            {user.agendaConfigured ? "Configurada" : "Pendente"}
                          </td>
                          <td className="px-4 py-4">
                            {user.pushEnabled ? "Ativado" : "Nao ativado"}
                          </td>
                          <td className="px-4 py-4">
                            {formatDateTime(user.lastSignInAt)}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => openDetail(user.id)}
                                className="rounded-md border border-[var(--premium-border-soft)] px-3 py-2 font-bold text-[var(--premium-gold-300)]"
                              >
                                Ver detalhes
                              </button>
                              {user.email ? (
                                <button
                                  type="button"
                                  onClick={() => copyEmail(user.email)}
                                  className="rounded-md border border-[var(--premium-border-soft)] px-3 py-2"
                                >
                                  {copiedEmail === user.email
                                    ? "Copiado"
                                    : "Copiar email"}
                                </button>
                              ) : null}
                              {user.publicUrl ? (
                                <a
                                  href={`${origin}${user.publicUrl}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-md border border-[var(--premium-border-soft)] px-3 py-2"
                                >
                                  Abrir agenda
                                </a>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {detailLoading || detail || detailError ? (
        <div className="fixed inset-0 z-[99999] bg-black/64 p-3 backdrop-blur-sm sm:p-5">
          <aside className="ml-auto grid h-full w-full max-w-xl overflow-y-auto rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-[#101010] p-5 shadow-[var(--premium-shadow-card)]">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--premium-gold-400)]">
                  Detalhe
                </p>
                <h2 className="premium-text-title mt-2 text-3xl font-bold">
                  Usuario
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDetail(null);
                  setDetailError("");
                }}
                className="rounded-md border border-[var(--premium-border-soft)] px-3 py-2 text-sm font-bold"
              >
                Fechar
              </button>
            </div>

            {detailLoading ? (
              <div className="grid gap-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-20 animate-pulse rounded-[var(--premium-radius-md)] bg-white/[0.05]"
                  />
                ))}
              </div>
            ) : detailError ? (
              <p className="rounded-[var(--premium-radius-md)] border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
                {detailError}
              </p>
            ) : detail ? (
              <UserDetailPanel detail={detail} origin={origin} />
            ) : null}
          </aside>
        </div>
      ) : null}
    </main>
  );
}

function UserDetailPanel({
  detail,
  origin,
}: {
  detail: UserDetail;
  origin: string;
}) {
  return (
    <div className="grid gap-5 text-sm text-[var(--premium-text-300)]">
      <section className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] p-4">
        <h3 className="font-bold text-[var(--premium-text-100)]">Dados basicos</h3>
        <dl className="mt-3 grid gap-2">
          <div>
            <dt className="text-[var(--premium-text-500)]">Email</dt>
            <dd>{detail.user.email || "-"}</dd>
          </div>
          <div>
            <dt className="text-[var(--premium-text-500)]">Criado em</dt>
            <dd>{formatDateTime(detail.user.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-[var(--premium-text-500)]">Ultimo acesso</dt>
            <dd>{formatDateTime(detail.user.lastSignInAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] p-4">
        <h3 className="font-bold text-[var(--premium-text-100)]">Barbearia</h3>
        {detail.shop ? (
          <div className="mt-3 grid gap-2">
            <p>{detail.shop.name}</p>
            <p>Telefone: {detail.shop.phone ?? "-"}</p>
            <p>Endereco: {detail.shop.address ?? "-"}</p>
            {detail.publicUrl ? (
              <a
                href={`${origin}${detail.publicUrl}`}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-[var(--premium-gold-300)]"
              >
                Abrir link publico
              </a>
            ) : null}
          </div>
        ) : (
          <p className="mt-3">Nenhuma barbearia configurada.</p>
        )}
      </section>

      <section className="grid gap-3 rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] p-4">
        <h3 className="font-bold text-[var(--premium-text-100)]">Resumo</h3>
        <p>Servicos cadastrados: {detail.services.length}</p>
        <p>Horarios configurados: {detail.businessHours.length}</p>
        <p>Agendamentos: {detail.appointmentsCount}</p>
        <p>Subscriptions push: {detail.pushSubscriptionsCount}</p>
      </section>

      <section className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] p-4">
        <h3 className="font-bold text-[var(--premium-text-100)]">Servicos</h3>
        <div className="mt-3 grid gap-2">
          {detail.services.length ? (
            detail.services.map((service) => (
              <p key={service.id}>
                {service.name} · {service.duration_minutes} min ·{" "}
                {service.active ? "Ativo" : "Pausado"}
              </p>
            ))
          ) : (
            <p>Nenhum servico cadastrado.</p>
          )}
        </div>
      </section>

      <section className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] p-4">
        <h3 className="font-bold text-[var(--premium-text-100)]">
          Ultimos agendamentos
        </h3>
        <div className="mt-3 grid gap-2">
          {detail.lastAppointments.length ? (
            detail.lastAppointments.map((appointment) => (
              <p key={appointment.id}>
                {appointment.appointmentDate} {appointment.appointmentTime} ·{" "}
                {appointment.serviceName ?? "Servico"} · {appointment.status}
              </p>
            ))
          ) : (
            <p>Nenhum agendamento encontrado.</p>
          )}
        </div>
      </section>
    </div>
  );
}
