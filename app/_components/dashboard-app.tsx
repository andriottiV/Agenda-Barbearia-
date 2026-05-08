"use client";

import Link from "next/link";
import { DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { friendlySupabaseError } from "../lib/supabase-errors";
import {
  currency,
  todayIso,
  toMoney,
  weekdays,
  whatsappLink,
} from "../lib/schedule";
import type {
  Appointment,
  Barbershop,
  BusinessHour,
  Client,
  Service,
} from "../types";

type Tab = "agenda" | "services" | "hours" | "clients" | "profile";

export function DashboardApp() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("agenda");
  const [date, setDate] = useState(todayIso());
  const [barbershop, setBarbershop] = useState<Barbershop | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [hours, setHours] = useState<BusinessHour[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [notice, setNotice] = useState("");
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Service | null>(null);
  const [draggedServiceId, setDraggedServiceId] = useState<string | null>(null);
  const [serviceSavingId, setServiceSavingId] = useState<string | null>(null);

  const publicPath = barbershop ? `/agendar/${barbershop.slug}` : "";

  function slugify(value: string) {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  async function load(currentUser = user, selectedDate = date) {
    if (!currentUser) return;
    setLoading(true);

    const shopRes = await supabase
      .from("barbershops")
      .select("*")
      .eq("owner_id", currentUser.id)
      .maybeSingle();

    if (shopRes.error) {
      setNotice(friendlySupabaseError(shopRes.error));
      setLoading(false);
      return;
    }

    const shop = shopRes.data as Barbershop | null;
    setBarbershop(shop);

    if (!shop) {
      setServices([]);
      setHours([]);
      setClients([]);
      setAppointments([]);
      setLoading(false);
      setTab("profile");
      return;
    }

    const [servicesRes, hoursRes, clientsRes, appointmentsRes] =
      await Promise.all([
        supabase
          .from("services")
          .select("*")
          .eq("barbershop_id", shop.id)
          .order("display_order", { ascending: true })
          .order("name", { ascending: true }),
        supabase
          .from("business_hours")
          .select("*")
          .eq("barbershop_id", shop.id)
          .order("weekday"),
        supabase
          .from("clients")
          .select("*")
          .eq("barbershop_id", shop.id)
          .order("name"),
        supabase
          .from("appointments")
          .select("*, clients(name, phone), services(name, price, duration_minutes)")
          .eq("barbershop_id", shop.id)
          .eq("appointment_date", selectedDate)
          .order("appointment_time"),
      ]);

    const firstError =
      servicesRes.error ?? hoursRes.error ?? clientsRes.error ?? appointmentsRes.error;

    if (firstError) {
      setNotice(friendlySupabaseError(firstError));
    }

    setServices((servicesRes.data ?? []) as Service[]);
    setHours((hoursRes.data ?? []) as BusinessHour[]);
    setClients((clientsRes.data ?? []) as Client[]);
    setAppointments((appointmentsRes.data ?? []) as Appointment[]);
    setLoading(false);
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push("/");
        return;
      }

      setUser(data.user);
      load(data.user);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const metrics = useMemo(() => {
    const valid = appointments.filter((item) => item.status !== "cancelled");
    const revenue = valid.reduce(
      (sum, item) => sum + Number(item.services?.price ?? 0),
      0,
    );

    return { count: valid.length, revenue, clients: clients.length };
  }, [appointments, clients]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/");
  }

  async function copyPublicLink() {
    if (!publicPath) return;
    await navigator.clipboard.writeText(`${window.location.origin}${publicPath}`);
    setNotice("Link publico copiado.");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name")).trim();
    const slug = String(formData.get("slug") || slugify(name))
      .toLowerCase()
      .trim();
    const payload = {
      owner_id: user.id,
      name,
      slug,
      phone: String(formData.get("phone") ?? "").trim(),
      address: String(formData.get("address") ?? "").trim(),
    };

    setActionLoading(true);
    try {
      const query = barbershop
        ? supabase.from("barbershops").update(payload).eq("id", barbershop.id)
        : supabase.from("barbershops").insert(payload);
      const { error } = await query;
      setNotice(error ? friendlySupabaseError(error) : "Barbearia salva.");
      await load(user);
    } finally {
      setActionLoading(false);
    }
  }

  async function saveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !barbershop) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      barbershop_id: barbershop.id,
      name: String(formData.get("name")).trim(),
      price: toMoney(formData.get("price")),
      duration_minutes: Number(formData.get("duration_minutes")),
      active: formData.get("active") === "on",
      display_order: services.length,
    };

    setActionLoading(true);
    try {
      const { error } = await supabase.from("services").insert(payload);
      setNotice(error ? friendlySupabaseError(error) : "Servico criado.");
      if (!error) form.reset();
      await load(user);
    } finally {
      setActionLoading(false);
    }
  }

  async function toggleService(service: Service) {
    setServiceSavingId(service.id);
    try {
      const { error } = await supabase
        .from("services")
        .update({ active: !service.active })
        .eq("id", service.id);
      setNotice(error ? friendlySupabaseError(error) : "Servico atualizado.");
      await load();
    } finally {
      setServiceSavingId(null);
    }
  }

  async function updateService(event: FormEvent<HTMLFormElement>, service: Service) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name")).trim(),
      price: toMoney(formData.get("price")),
      duration_minutes: Number(formData.get("duration_minutes")),
      active: formData.get("active") === "on",
    };

    setServiceSavingId(service.id);
    try {
      const { error } = await supabase
        .from("services")
        .update(payload)
        .eq("id", service.id);

      setNotice(error ? friendlySupabaseError(error) : "Servico salvo.");
      if (!error) setEditingServiceId(null);
      await load();
    } finally {
      setServiceSavingId(null);
    }
  }

  async function archiveService(service: Service) {
    setServiceSavingId(service.id);
    try {
      const { error } = await supabase
        .from("services")
        .update({ active: false })
        .eq("id", service.id);

      setNotice(error ? friendlySupabaseError(error) : "Servico arquivado.");
      setDeleteCandidate(null);
      await load();
    } finally {
      setServiceSavingId(null);
    }
  }

  async function persistServiceOrder(nextServices: Service[]) {
    const orderedServices = nextServices.map((service, index) => ({
      ...service,
      display_order: index,
    }));

    setServices(orderedServices);
    setActionLoading(true);

    try {
      const results = await Promise.all(
        orderedServices.map((service, index) =>
          supabase
            .from("services")
            .update({ display_order: index })
            .eq("id", service.id),
        ),
      );

      const firstError = results.find((result) => result.error)?.error;
      setNotice(firstError ? friendlySupabaseError(firstError) : "Ordem atualizada.");
    } finally {
      setActionLoading(false);
    }
  }

  async function moveService(serviceId: string, direction: -1 | 1) {
    const currentIndex = services.findIndex((service) => service.id === serviceId);
    const nextIndex = currentIndex + direction;

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= services.length) {
      return;
    }

    const nextServices = [...services];
    const [service] = nextServices.splice(currentIndex, 1);
    nextServices.splice(nextIndex, 0, service);
    await persistServiceOrder(nextServices);
  }

  async function dropServiceOn(
    event: DragEvent<HTMLElement>,
    targetServiceId: string,
  ) {
    event.preventDefault();

    if (!draggedServiceId || draggedServiceId === targetServiceId) {
      setDraggedServiceId(null);
      return;
    }

    const fromIndex = services.findIndex((service) => service.id === draggedServiceId);
    const toIndex = services.findIndex((service) => service.id === targetServiceId);

    if (fromIndex < 0 || toIndex < 0) {
      setDraggedServiceId(null);
      return;
    }

    const nextServices = [...services];
    const [service] = nextServices.splice(fromIndex, 1);
    nextServices.splice(toIndex, 0, service);
    setDraggedServiceId(null);
    await persistServiceOrder(nextServices);
  }

  async function saveHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !barbershop) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const rows = weekdays.map((_, weekday) => ({
      barbershop_id: barbershop.id,
      weekday,
      opens_at: String(formData.get(`opens_${weekday}`) || "09:00"),
      closes_at: String(formData.get(`closes_${weekday}`) || "18:00"),
      active: formData.get(`active_${weekday}`) === "on",
    }));

    setActionLoading(true);
    try {
      await supabase.from("business_hours").delete().eq("barbershop_id", barbershop.id);
      const { error } = await supabase.from("business_hours").insert(rows);
      setNotice(error ? friendlySupabaseError(error) : "Horarios salvos.");
      await load(user);
    } finally {
      setActionLoading(false);
    }
  }

  async function saveClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!barbershop) return;

    const form = event.currentTarget;
    const formData = new FormData(form);

    setActionLoading(true);
    try {
      const { error } = await supabase.from("clients").insert({
        barbershop_id: barbershop.id,
        name: String(formData.get("name")).trim(),
        phone: String(formData.get("phone")).trim(),
      });

      setNotice(error ? friendlySupabaseError(error) : "Cliente criado.");
      if (!error) form.reset();
      await load();
    } finally {
      setActionLoading(false);
    }
  }

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!barbershop) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const service = services.find((item) => item.id === formData.get("service_id"));
    const client = clients.find((item) => item.id === formData.get("client_id"));
    if (!service || !client) return;

    const appointmentTime = String(formData.get("appointment_time"));
    const conflict = appointments.some(
      (item) =>
        item.status !== "cancelled" &&
        item.appointment_time.slice(0, 5) === appointmentTime,
    );

    if (conflict) {
      setNotice("Este horario ja esta ocupado.");
      return;
    }

    setActionLoading(true);
    try {
      const { error } = await supabase.from("appointments").insert({
        barbershop_id: barbershop.id,
        client_id: client.id,
        service_id: service.id,
        appointment_date: date,
        appointment_time: appointmentTime,
        status: "scheduled",
        notes: String(formData.get("notes") ?? "").trim(),
      });

      setNotice(error ? friendlySupabaseError(error) : "Agendamento criado.");
      if (!error) form.reset();
      await load();
    } finally {
      setActionLoading(false);
    }
  }

  async function updateAppointment(id: string, status: Appointment["status"]) {
    const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
    setNotice(error ? friendlySupabaseError(error) : "Agendamento atualizado.");
    await load();
  }

  const nav = [
    ["agenda", "Agenda"],
    ["services", "Servicos"],
    ["hours", "Horarios"],
    ["clients", "Clientes"],
    ["profile", "Perfil"],
  ] as const;

  if (loading && !user) {
    return <main className="p-8">Carregando...</main>;
  }

  return (
    <main className="min-h-screen bg-stone-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-emerald-700">
              {barbershop?.name ?? "Minha barbearia"}
            </p>
            <h1 className="text-3xl font-bold">Painel administrativo</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {barbershop ? (
              <>
                <button
                  type="button"
                  onClick={copyPublicLink}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold"
                >
                  Copiar link
                </button>
                <Link
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold"
                  href={`/agendar/${barbershop.slug}`}
                >
                  Link publico
                </Link>
              </>
            ) : null}
            <button
              onClick={signOut}
              className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6">
        <nav className="flex gap-2 overflow-x-auto">
          {nav.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-md px-4 py-2 text-sm font-semibold ${
                tab === key
                  ? "bg-emerald-700 text-white"
                  : "border border-slate-300 bg-white text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {notice ? (
          <p className="fixed right-4 top-4 z-40 max-w-sm rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm">
            {notice}
          </p>
        ) : null}

        {!barbershop && tab !== "profile" ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Cadastre o perfil da barbearia para liberar agenda, servicos e link publico.
          </p>
        ) : null}

        {tab === "agenda" && barbershop ? (
          <section className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
            <div className="grid gap-4">
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Hoje" value={String(metrics.count)} />
                <Metric label="Receita" value={currency(metrics.revenue)} />
                <Metric label="Clientes" value={String(metrics.clients)} />
              </div>
              <Panel title="Novo agendamento">
                <form onSubmit={createAppointment} className="grid gap-3">
                  <select name="client_id" required className="field">
                    <option value="">Cliente</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                  <select name="service_id" required className="field">
                    <option value="">Servico</option>
                    {services
                      .filter((service) => service.active)
                      .map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name}
                        </option>
                      ))}
                  </select>
                  <input
                    name="appointment_time"
                    type="time"
                    required
                    className="field"
                  />
                  <textarea
                    name="notes"
                    placeholder="Observacoes"
                    className="field min-h-20 py-3"
                  />
                  <button disabled={actionLoading} className="primary-button">
                    Criar
                  </button>
                </form>
              </Panel>
            </div>
            <Panel title="Agenda">
              <input
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  load(user, event.target.value);
                }}
                className="field mb-4 max-w-52"
              />
              <div className="grid gap-3">
                {appointments.map((appointment) => (
                  <article
                    key={appointment.id}
                    className="rounded-md border border-slate-200 bg-white p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-bold">
                          {appointment.appointment_time.slice(0, 5)} -{" "}
                          {appointment.clients?.name ?? "Cliente"}
                        </p>
                        <p className="text-sm text-slate-600">
                          {appointment.services?.name} -{" "}
                          {appointment.clients?.phone ?? "sem telefone"} -{" "}
                          {appointment.status}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {appointment.clients?.phone ? (
                          <a
                            href={whatsappLink(
                              appointment.clients.phone,
                              `Ola ${appointment.clients.name}, seu horario na ${barbershop.name} esta marcado para ${appointment.appointment_date} as ${appointment.appointment_time.slice(0, 5)}.`,
                            )}
                            target="_blank"
                            className="small-button"
                          >
                            WhatsApp
                          </a>
                        ) : null}
                        <button
                          onClick={() =>
                            updateAppointment(appointment.id, "confirmed")
                          }
                          className="small-button"
                        >
                          Confirmar
                        </button>
                        <button
                          onClick={() =>
                            updateAppointment(appointment.id, "cancelled")
                          }
                          className="small-button"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
                {!appointments.length ? (
                  <p className="text-sm text-slate-600">
                    Nenhum agendamento nesta data.
                  </p>
                ) : null}
              </div>
            </Panel>
          </section>
        ) : null}

        {tab === "services" && barbershop ? (
          <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <Panel title="Novo servico">
              <form onSubmit={saveService} className="grid gap-3">
                <input name="name" placeholder="Nome" required className="field" />
                <input
                  name="price"
                  placeholder="Preco ex: 45,00"
                  required
                  className="field"
                />
                <input
                  name="duration_minutes"
                  type="number"
                  min={15}
                  step={15}
                  placeholder="Duracao em minutos"
                  required
                  className="field"
                />
                <label className="flex items-center gap-2 text-sm">
                  <input name="active" type="checkbox" defaultChecked /> Ativo
                </label>
                <button disabled={actionLoading} className="primary-button">
                  Salvar servico
                </button>
              </form>
            </Panel>
            <Panel title="Servicos">
              <div className="grid gap-3" aria-live="polite">
                {loading ? (
                  <>
                    <ServiceSkeleton />
                    <ServiceSkeleton />
                  </>
                ) : null}
                {!loading &&
                  services.map((service, index) => {
                    const isEditing = editingServiceId === service.id;
                    const isSaving = serviceSavingId === service.id;

                    return (
                      <article
                        key={service.id}
                        draggable={!isEditing}
                        onDragStart={() => setDraggedServiceId(service.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => dropServiceOn(event, service.id)}
                        onDragEnd={() => setDraggedServiceId(null)}
                        className={`rounded-md border bg-white p-4 shadow-sm transition ${
                          draggedServiceId === service.id
                            ? "border-emerald-600 opacity-70"
                            : "border-slate-200"
                        }`}
                      >
                        {isEditing ? (
                          <form
                            onSubmit={(event) => updateService(event, service)}
                            className="grid gap-3"
                          >
                            <input
                              name="name"
                              defaultValue={service.name}
                              required
                              className="field"
                            />
                            <div className="grid gap-3 sm:grid-cols-2">
                              <input
                                name="price"
                                defaultValue={String(Number(service.price).toFixed(2)).replace(
                                  ".",
                                  ",",
                                )}
                                required
                                className="field"
                              />
                              <input
                                name="duration_minutes"
                                type="number"
                                min={15}
                                step={15}
                                defaultValue={service.duration_minutes}
                                required
                                className="field"
                              />
                            </div>
                            <label className="flex items-center gap-2 text-sm text-slate-700">
                              <input
                                name="active"
                                type="checkbox"
                                defaultChecked={service.active}
                              />
                              Ativo
                            </label>
                            <div className="flex flex-wrap gap-2">
                              <button
                                disabled={isSaving}
                                className="primary-button px-4 py-2 text-sm"
                              >
                                {isSaving ? "Salvando..." : "Salvar"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingServiceId(null)}
                                className="small-button"
                              >
                                Cancelar
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
                            <div className="min-w-0">
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className="cursor-grab select-none rounded border border-slate-200 px-2 py-1 text-xs text-slate-500">
                                  Arrastar
                                </span>
                                <span
                                  className={`rounded px-2 py-1 text-xs font-bold ${
                                    service.active
                                      ? "bg-emerald-50 text-emerald-800"
                                      : "bg-slate-100 text-slate-600"
                                  }`}
                                >
                                  {service.active ? "Ativo" : "Pausado"}
                                </span>
                              </div>
                              <p className="truncate text-lg font-bold text-slate-950">
                                {service.name}
                              </p>
                              <p className="mt-1 text-sm text-slate-600">
                                {currency(Number(service.price))} -{" "}
                                {service.duration_minutes} min
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                              <button
                                type="button"
                                disabled={index === 0 || actionLoading}
                                onClick={() => moveService(service.id, -1)}
                                className="small-button disabled:opacity-50"
                              >
                                Subir
                              </button>
                              <button
                                type="button"
                                disabled={index === services.length - 1 || actionLoading}
                                onClick={() => moveService(service.id, 1)}
                                className="small-button disabled:opacity-50"
                              >
                                Descer
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingServiceId(service.id)}
                                className="small-button"
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => toggleService(service)}
                                className="small-button"
                              >
                                {service.active ? "Pausar" : "Ativar"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteCandidate(service)}
                                className="small-button border-red-200 text-red-700"
                              >
                                Excluir
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                {!loading && !services.length ? (
                  <p className="text-sm text-slate-600">
                    Cadastre o primeiro servico para liberar o agendamento publico.
                  </p>
                ) : null}
              </div>
            </Panel>
          </section>
        ) : null}

        {tab === "hours" && barbershop ? (
          <Panel title="Horarios de funcionamento">
            <form onSubmit={saveHours} className="grid gap-3">
              {weekdays.map((label, weekday) => {
                const row = hours.find((item) => item.weekday === weekday);
                return (
                  <div
                    key={label}
                    className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_150px_150px_100px] sm:items-center"
                  >
                    <strong>{label}</strong>
                    <input
                      name={`opens_${weekday}`}
                      type="time"
                      defaultValue={row?.opens_at?.slice(0, 5) ?? "09:00"}
                      className="field"
                    />
                    <input
                      name={`closes_${weekday}`}
                      type="time"
                      defaultValue={row?.closes_at?.slice(0, 5) ?? "18:00"}
                      className="field"
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        name={`active_${weekday}`}
                        type="checkbox"
                        defaultChecked={row?.active ?? weekday !== 0}
                      />
                      Ativo
                    </label>
                  </div>
                );
              })}
              <button disabled={actionLoading} className="primary-button w-fit px-6">
                Salvar horarios
              </button>
            </form>
          </Panel>
        ) : null}

        {tab === "clients" && barbershop ? (
          <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <Panel title="Novo cliente">
              <form onSubmit={saveClient} className="grid gap-3">
                <input name="name" placeholder="Nome" required className="field" />
                <input
                  name="phone"
                  placeholder="WhatsApp com DDD"
                  required
                  className="field"
                />
                <button className="primary-button">Salvar cliente</button>
              </form>
            </Panel>
            <Panel title="Clientes">
              <div className="grid gap-3">
                {clients.map((client) => (
                  <article
                    key={client.id}
                    className="rounded-md border border-slate-200 bg-white p-4"
                  >
                    <p className="font-bold">{client.name}</p>
                    <p className="text-sm text-slate-600">{client.phone}</p>
                  </article>
                ))}
                {!clients.length ? (
                  <p className="text-sm text-slate-600">
                    Clientes agendados pelo link publico aparecerao aqui.
                  </p>
                ) : null}
              </div>
            </Panel>
          </section>
        ) : null}

        {tab === "profile" ? (
          <Panel title="Perfil publico">
            <form onSubmit={saveProfile} className="grid max-w-2xl gap-3">
              <input
                name="name"
                placeholder="Nome da barbearia"
                defaultValue={barbershop?.name}
                required
                className="field"
              />
              <input
                name="slug"
                placeholder="novandri-barber"
                defaultValue={barbershop?.slug}
                className="field"
              />
              <input
                name="phone"
                placeholder="WhatsApp da barbearia"
                defaultValue={barbershop?.phone ?? ""}
                className="field"
              />
              <input
                name="address"
                placeholder="Endereco"
                defaultValue={barbershop?.address ?? ""}
                className="field"
              />
              {publicPath ? (
                <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  {publicPath}
                </p>
              ) : null}
              <button disabled={actionLoading} className="primary-button">
                Salvar perfil
              </button>
            </form>
          </Panel>
        ) : null}
      </div>

      {deleteCandidate ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4">
          <div className="w-full max-w-md rounded-md border border-slate-200 bg-white p-5 shadow-lg">
            <h2 className="text-xl font-bold text-slate-950">Excluir servico?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Para preservar agendamentos antigos, o servico sera arquivado e
              deixara de aparecer no link publico.
            </p>
            <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
              {deleteCandidate.name}
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeleteCandidate(null)}
                className="small-button"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={serviceSavingId === deleteCandidate.id}
                onClick={() => archiveService(deleteCandidate)}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-800 disabled:opacity-60"
              >
                {serviceSavingId === deleteCandidate.id
                  ? "Arquivando..."
                  : "Arquivar servico"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ServiceSkeleton() {
  return (
    <div className="animate-pulse rounded-md border border-slate-200 bg-white p-4">
      <div className="mb-3 h-5 w-2/3 rounded bg-slate-200" />
      <div className="h-4 w-1/2 rounded bg-slate-100" />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}
