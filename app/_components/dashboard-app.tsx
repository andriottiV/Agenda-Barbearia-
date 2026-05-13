"use client";

import Link from "next/link";
import { DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import {
  PremiumBadge,
  PremiumEmptyState,
  PremiumListItem,
} from "../../components/ui/premium";
import { logSupabaseError } from "../lib/supabase-debug";
import { supabase } from "../lib/supabase";
import { friendlySupabaseError } from "../lib/supabase-errors";
import {
  currency,
  formatPhoneBR,
  makeSlots,
  overlapsLunchBreak,
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

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

const DISPLAY_ORDER_HOTFIX_MESSAGE =
  "Banco precisa do hotfix de ordenacao. Rode supabase/hotfix.sql no Supabase SQL Editor.";

const DASHBOARD_QUERIES = {
  shop:
    "barbershops.select(id, owner_id, name, slug, phone, address, created_at).eq(owner_id)",
  services:
    "services.select(id, barbershop_id, name, duration_minutes, price, active, display_order, created_at).eq(barbershop_id).order(display_order, created_at)",
  hours:
    "business_hours.select(id, barbershop_id, weekday, opens_at, closes_at, active, lunch_enabled, lunch_starts_at, lunch_ends_at, created_at).eq(barbershop_id).order(weekday)",
  clients:
    "clients.select(id, barbershop_id, name, phone, notes, preferred_frequency_days, deleted_at, created_at).eq(barbershop_id).is(deleted_at,null).order(name)",
  appointments:
    "appointments.select(id, barbershop_id, client_id, service_id, appointment_date, appointment_time, status, notes, created_at, clients(name, phone), services(name, price, duration_minutes)).eq(barbershop_id).eq(appointment_date).order(appointment_time)",
  history:
    "appointments.select(id, barbershop_id, client_id, service_id, appointment_date, appointment_time, status, notes, created_at, clients(name, phone), services(name, price, duration_minutes)).eq(barbershop_id).order(appointment_date desc, appointment_time desc)",
} as const;

type ClientFrequencyStatus = "Novo" | "Recorrente" | "Em risco" | "Sumido";

function isMissingDisplayOrderError(error: SupabaseErrorLike | null | undefined) {
  const text = `${error?.code ?? ""} ${error?.message ?? ""} ${
    error?.details ?? ""
  } ${error?.hint ?? ""}`.toLowerCase();

  return text.includes("display_order");
}

function normalizeServices(rows: Service[] | null | undefined) {
  return (rows ?? []).map((service, index) => ({
    ...service,
    display_order: Number(service.display_order ?? index),
  }));
}

function normalizeAppointmentRow(row: unknown): Appointment {
  const appointment = row as Appointment & {
    clients?: Array<Pick<Client, "name" | "phone">> | Pick<Client, "name" | "phone"> | null;
    services?: Array<Pick<Service, "name" | "price" | "duration_minutes">> | Pick<Service, "name" | "price" | "duration_minutes"> | null;
  };

  return {
    ...appointment,
    clients: Array.isArray(appointment.clients)
      ? appointment.clients[0] ?? null
      : appointment.clients ?? null,
    services: Array.isArray(appointment.services)
      ? appointment.services[0] ?? null
      : appointment.services ?? null,
  };
}

function normalizeAppointments(rows: unknown[] | null | undefined) {
  return (rows ?? []).map((row) => normalizeAppointmentRow(row));
}

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
  const [clientAppointments, setClientAppointments] = useState<Appointment[]>([]);
  const [notice, setNotice] = useState("");
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Service | null>(null);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteClientCandidate, setDeleteClientCandidate] = useState<Client | null>(
    null,
  );
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [expandedSummary, setExpandedSummary] = useState(false);
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
      .select("id, owner_id, name, slug, phone, address, created_at")
      .eq("owner_id", currentUser.id)
      .maybeSingle();

    if (shopRes.error) {
      logSupabaseError("[Dashboard] Erro ao carregar barbearia", shopRes.error, {
        table: "barbershops",
        operation: "select owner_id",
        query: DASHBOARD_QUERIES.shop,
        filter: { owner_id: currentUser.id },
      });
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
      setClientAppointments([]);
      setLoading(false);
      setTab("profile");
      return;
    }

    const [servicesRes, hoursRes, clientsRes, appointmentsRes, historyRes] =
      await Promise.all([
        loadServices(shop.id),
        supabase
          .from("business_hours")
          .select(
            "id, barbershop_id, weekday, opens_at, closes_at, active, lunch_enabled, lunch_starts_at, lunch_ends_at, created_at",
          )
          .eq("barbershop_id", shop.id)
          .order("weekday"),
        supabase
          .from("clients")
          .select(
            "id, barbershop_id, name, phone, notes, preferred_frequency_days, deleted_at, created_at",
          )
          .eq("barbershop_id", shop.id)
          .is("deleted_at", null)
          .order("name"),
        supabase
          .from("appointments")
          .select(
            "id, barbershop_id, client_id, service_id, appointment_date, appointment_time, status, notes, created_at, clients(name, phone), services(name, price, duration_minutes)",
          )
          .eq("barbershop_id", shop.id)
          .eq("appointment_date", selectedDate)
          .order("appointment_time"),
        supabase
          .from("appointments")
          .select(
            "id, barbershop_id, client_id, service_id, appointment_date, appointment_time, status, notes, created_at, clients(name, phone), services(name, price, duration_minutes)",
          )
          .eq("barbershop_id", shop.id)
          .order("appointment_date", { ascending: false })
          .order("appointment_time", { ascending: false }),
      ]);

    const firstError =
      servicesRes.error ??
      hoursRes.error ??
      clientsRes.error ??
      appointmentsRes.error ??
      historyRes.error;

    if (firstError) {
      const dashboardErrors = [
        {
          key: "services",
          error: servicesRes.error,
          table: "services",
          query: DASHBOARD_QUERIES.services,
        },
        {
          key: "hours",
          error: hoursRes.error,
          table: "business_hours",
          query: DASHBOARD_QUERIES.hours,
        },
        {
          key: "clients",
          error: clientsRes.error,
          table: "clients",
          query: DASHBOARD_QUERIES.clients,
        },
        {
          key: "appointments",
          error: appointmentsRes.error,
          table: "appointments",
          query: DASHBOARD_QUERIES.appointments,
        },
        {
          key: "history",
          error: historyRes.error,
          table: "appointments",
          query: DASHBOARD_QUERIES.history,
        },
      ];

      logSupabaseError("[Dashboard] Erro ao carregar painel", firstError, {
        failedQueries: dashboardErrors
          .filter((item) => item.error)
          .map(({ key, table, query }) => ({ key, table, query })),
        shopId: shop?.id,
        selectedDate,
      });

      dashboardErrors.forEach(({ key, error, table, query }) => {
        logSupabaseError(`[Dashboard] Query falhou: ${key}`, error, {
          table,
          query,
          filter: { barbershop_id: shop.id, appointment_date: selectedDate },
        });
      });

      setNotice(friendlySupabaseError(firstError));
    }

    setServices(normalizeServices(servicesRes.data ?? []));
    setHours((hoursRes.data ?? []) as BusinessHour[]);
    setClients((clientsRes.data ?? []) as Client[]);
    setAppointments(normalizeAppointments(appointmentsRes.data ?? []));
    setClientAppointments(normalizeAppointments(historyRes.data ?? []));
    setLoading(false);
  }

  async function loadServices(barbershopId: string) {
    const orderedRes = await supabase
      .from("services")
      .select(
        "id, barbershop_id, name, duration_minutes, price, active, display_order, created_at",
      )
      .eq("barbershop_id", barbershopId)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (!orderedRes.error) {
      return orderedRes;
    }

    if (!isMissingDisplayOrderError(orderedRes.error)) {
      return orderedRes;
    }

    logSupabaseError(
      "[Dashboard] Coluna services.display_order ausente, usando fallback",
      orderedRes.error,
      {
        table: "services",
        query: DASHBOARD_QUERIES.services,
        filter: { barbershop_id: barbershopId },
      },
    );
    setNotice(DISPLAY_ORDER_HOTFIX_MESSAGE);

    const fallbackRes = await supabase
      .from("services")
      .select("*")
      .eq("barbershop_id", barbershopId)
      .order("created_at", { ascending: true });

    if (fallbackRes.error) {
      logSupabaseError(
        "[Dashboard] Erro ao carregar servicos no fallback",
        fallbackRes.error,
        {
          table: "services",
          query: "services.select(*).eq(barbershop_id).order(created_at)",
          filter: { barbershop_id: barbershopId },
        },
      );
    }

    return fallbackRes;
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

  const dailySummary = useMemo(() => {
    const valid = appointments.filter((item) => item.status !== "cancelled");
    const cancelled = appointments.filter((item) => item.status === "cancelled");
    const revenue = valid.reduce(
      (sum, item) => sum + Number(item.services?.price ?? 0),
      0,
    );
    const uniqueClients = new Set(valid.map((item) => item.client_id).filter(Boolean));
    const now = new Date();
    const isToday = date === todayIso();
    const nextAppointment = valid.find((item) => {
      if (!isToday) return true;
      const appointmentDate = new Date(`${item.appointment_date}T${item.appointment_time}`);
      return appointmentDate >= now;
    });

    return {
      attendedClients: uniqueClients.size,
      cancellations: cancelled.length,
      count: valid.length,
      nextAppointment,
      revenue,
    };
  }, [appointments, date]);

  const selectedDayHours = useMemo(() => {
    const weekday = new Date(`${date}T12:00:00`).getDay();
    return hours.find((item) => item.weekday === weekday);
  }, [date, hours]);

  const adminAvailableSlots = useMemo(() => {
    const activeServices = services.filter((service) => service.active);
    const selectedService =
      activeServices.find((service) => service.id === selectedServiceId) ??
      activeServices[0];

    if (!selectedDayHours?.active || !selectedService) {
      return [];
    }

    const occupiedSlots = appointments
      .filter((appointment) => appointment.status !== "cancelled")
      .map((appointment) => appointment.appointment_time.slice(0, 5));

    return makeSlots(
      selectedDayHours.opens_at,
      selectedDayHours.closes_at,
      selectedService.duration_minutes,
      occupiedSlots,
      {
        enabled: selectedDayHours.lunch_enabled,
        startsAt: selectedDayHours.lunch_starts_at,
        endsAt: selectedDayHours.lunch_ends_at,
      },
    );
  }, [appointments, selectedDayHours, selectedServiceId, services]);

  const fullSummary = useMemo(() => {
    const today = new Date(`${todayIso()}T12:00:00`);
    const startOfDay = new Date(today);
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    const startOfFortnight = new Date(today);
    startOfFortnight.setDate(today.getDate() - 14);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const valid = clientAppointments.filter(
      (appointment) => appointment.status !== "cancelled",
    );

    function inRange(start: Date) {
      return valid.filter((appointment) => {
        const appointmentDate = new Date(`${appointment.appointment_date}T12:00:00`);
        return appointmentDate >= start && appointmentDate <= startOfDay;
      });
    }

    function summarize(rangeAppointments: Appointment[]) {
      const revenue = rangeAppointments.reduce(
        (sum, appointment) => sum + Number(appointment.services?.price ?? 0),
        0,
      );

      return {
        count: rangeAppointments.length,
        revenue,
      };
    }

    const byDay = valid.reduce(
      (acc, appointment) => {
        const key = appointment.appointment_date;
        const current = acc[key] ?? { count: 0, revenue: 0 };
        acc[key] = {
          count: current.count + 1,
          revenue: current.revenue + Number(appointment.services?.price ?? 0),
        };
        return acc;
      },
      {} as Record<string, { count: number; revenue: number }>,
    );

    const rankedDays = Object.entries(byDay);
    const bestRevenueDay = [...rankedDays].sort(
      ([, a], [, b]) => b.revenue - a.revenue,
    )[0];
    const bestAppointmentDay = [...rankedDays].sort(
      ([, a], [, b]) => b.count - a.count,
    )[0];
    const month = summarize(inRange(startOfMonth));
    const elapsedMonthDays = Math.max(1, today.getDate());

    return {
      fortnight: summarize(inRange(startOfFortnight)),
      month,
      week: summarize(inRange(startOfWeek)),
      bestRevenueDay,
      bestAppointmentDay,
      dailyAverage: month.revenue / elapsedMonthDays,
      averageTicket: month.count ? month.revenue / month.count : 0,
    };
  }, [clientAppointments]);

  const clientFrequency = useMemo(() => {
    const today = new Date(`${todayIso()}T12:00:00`);

    return clients.reduce(
      (acc, client) => {
        const visits = clientAppointments
          .filter(
            (appointment) =>
              appointment.client_id === client.id &&
              appointment.status !== "cancelled",
          )
          .sort((a, b) =>
            `${a.appointment_date}T${a.appointment_time}`.localeCompare(
              `${b.appointment_date}T${b.appointment_time}`,
            ),
          );
        const totalVisits = visits.length;
        const lastVisit = visits.at(-1)?.appointment_date ?? null;
        const lastVisitDate = lastVisit ? new Date(`${lastVisit}T12:00:00`) : null;
        const daysSinceLastVisit = lastVisitDate
          ? Math.floor(
              (today.getTime() - lastVisitDate.getTime()) / (1000 * 60 * 60 * 24),
            )
          : null;
        const gaps = visits
          .slice(1)
          .map((visit, index) => {
            const previous = new Date(`${visits[index].appointment_date}T12:00:00`);
            const current = new Date(`${visit.appointment_date}T12:00:00`);
            return Math.max(
              0,
              Math.round(
                (current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24),
              ),
            );
          })
          .filter((gap) => gap > 0);
        const averageFrequency = gaps.length
          ? Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length)
          : null;
        const status =
          totalVisits <= 1
            ? "Novo"
            : daysSinceLastVisit !== null && daysSinceLastVisit > 60
              ? "Sumido"
              : daysSinceLastVisit !== null && daysSinceLastVisit > 45
                ? "Em risco"
                : daysSinceLastVisit !== null && daysSinceLastVisit <= 30
                  ? "Recorrente"
                  : "Em risco";

        acc[client.id] = {
          averageFrequency,
          lastVisit,
          status,
          totalVisits,
          visits: [...visits].reverse(),
        };

        return acc;
      },
      {} as Record<
        string,
        {
          averageFrequency: number | null;
          lastVisit: string | null;
          status: ClientFrequencyStatus;
          totalVisits: number;
          visits: Appointment[];
        }
      >,
    );
  }, [clientAppointments, clients]);

  const selectedClient =
    clients.find((client) => client.id === selectedClientId) ?? clients[0] ?? null;

  const filteredClients = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    if (!query) return clients;

    return clients.filter((client) => {
      const phone = client.phone?.replace(/\D/g, "") ?? "";
      return (
        client.name.toLowerCase().includes(query) ||
        client.phone.toLowerCase().includes(query) ||
        phone.includes(query.replace(/\D/g, ""))
      );
    });
  }, [clientSearch, clients]);

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
      logSupabaseError("[Dashboard] Erro ao salvar perfil", error);
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
      let { error } = await supabase.from("services").insert(payload);
      let successMessage = "Servico criado.";

      if (isMissingDisplayOrderError(error)) {
        logSupabaseError(
          "[Dashboard] Insert de servico sem display_order por coluna ausente",
          error,
        );
        const fallbackPayload = {
          barbershop_id: payload.barbershop_id,
          name: payload.name,
          price: payload.price,
          duration_minutes: payload.duration_minutes,
          active: payload.active,
        };
        const fallbackRes = await supabase.from("services").insert(fallbackPayload);
        error = fallbackRes.error;
        if (!error) {
          successMessage = `Servico criado. ${DISPLAY_ORDER_HOTFIX_MESSAGE}`;
        }
      }

      logSupabaseError("[Dashboard] Erro ao criar servico", error);
      setNotice(error ? friendlySupabaseError(error) : successMessage);
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
      logSupabaseError("[Dashboard] Erro ao ativar/pausar servico", error, {
        serviceId: service.id,
      });
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

      logSupabaseError("[Dashboard] Erro ao editar servico", error, {
        serviceId: service.id,
      });
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

      logSupabaseError("[Dashboard] Erro ao arquivar servico", error, {
        serviceId: service.id,
      });
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
      logSupabaseError("[Dashboard] Erro ao atualizar ordem de servicos", firstError);
      setNotice(
        isMissingDisplayOrderError(firstError)
          ? DISPLAY_ORDER_HOTFIX_MESSAGE
          : firstError
            ? friendlySupabaseError(firstError)
            : "Ordem atualizada.",
      );
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
      lunch_enabled: formData.get(`lunch_enabled_${weekday}`) === "on",
      lunch_starts_at: String(formData.get(`lunch_starts_${weekday}`) || "12:00"),
      lunch_ends_at: String(formData.get(`lunch_ends_${weekday}`) || "13:00"),
    }));

    const appointmentsInLunch = clientAppointments.filter((appointment) => {
      if (appointment.status === "cancelled") return false;
      const weekday = new Date(`${appointment.appointment_date}T12:00:00`).getDay();
      const row = rows[weekday];
      const duration = appointment.services?.duration_minutes ?? 30;
      return overlapsLunchBreak(appointment.appointment_time, duration, {
        enabled: row.active && row.lunch_enabled,
        startsAt: row.lunch_starts_at,
        endsAt: row.lunch_ends_at,
      });
    });

    if (
      appointmentsInLunch.length &&
      !window.confirm(
        `Existem ${appointmentsInLunch.length} agendamento(s) dentro da pausa de almoço. Deseja salvar mesmo assim?`,
      )
    ) {
      return;
    }

    setActionLoading(true);
    try {
      const { error } = await supabase
        .from("business_hours")
        .upsert(rows, { onConflict: "barbershop_id,weekday" });
      logSupabaseError("[Dashboard] Erro ao salvar horarios", error);
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
    const clientPayload = {
      barbershop_id: barbershop.id,
      name: String(formData.get("name")).trim(),
      phone: String(formData.get("phone")).trim(),
      notes: String(formData.get("notes") ?? "").trim() || null,
      preferred_frequency_days:
        Number(formData.get("preferred_frequency_days")) || null,
    };

    if (!clientPayload.name || !clientPayload.phone) {
      setNotice("Nome e telefone são obrigatórios para salvar o cliente.");
      return;
    }

    setActionLoading(true);
    try {

      const { error } = await supabase.from("clients").insert(clientPayload);

      logSupabaseError("[Dashboard] Erro ao criar cliente", error, {
        table: "clients",
        operation: "insert",
        payload: clientPayload,
      });
      setNotice(error ? friendlySupabaseError(error) : "Cliente criado.");
      if (!error) form.reset();
      await load();
    } finally {
      setActionLoading(false);
    }
  }

  async function updateClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingClient) return;

    const form = event.currentTarget;
    const formData = new FormData(form);

    setActionLoading(true);
    try {
      const { error } = await supabase
        .from("clients")
        .update({
          name: String(formData.get("name")).trim(),
          phone: String(formData.get("phone") ?? "").trim(),
          notes: String(formData.get("notes") ?? "").trim() || null,
          preferred_frequency_days:
            Number(formData.get("preferred_frequency_days")) || null,
        })
        .eq("id", editingClient.id);

      logSupabaseError("[Dashboard] Erro ao editar cliente", error, {
        clientId: editingClient.id,
      });
      setNotice(error ? friendlySupabaseError(error) : "Cliente atualizado.");
      if (!error) setEditingClient(null);
      await load();
    } finally {
      setActionLoading(false);
    }
  }

  async function deleteClient(client: Client) {
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from("clients")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", client.id);

      logSupabaseError("[Dashboard] Erro ao excluir cliente", error, {
        clientId: client.id,
      });
      setNotice(error ? friendlySupabaseError(error) : "Cliente excluido.");
      setDeleteClientCandidate(null);
      if (selectedClientId === client.id) setSelectedClientId(null);
      await load();
    } finally {
      setActionLoading(false);
    }
  }

  function callClientOnWhatsapp(client: Client) {
    if (!client.phone?.replace(/\D/g, "")) {
      setNotice("Este cliente ainda nao possui telefone cadastrado.");
      return;
    }

    window.open(
      whatsappLink(
        client.phone,
        `Ola, ${client.name}! Tudo bem? Aqui e da barbearia. Passando para falar sobre seu atendimento.`,
      ),
      "_blank",
      "noopener,noreferrer",
    );
  }

  function registerClientReturn(client: Client) {
    setSelectedClientId(client.id);
    setTab("agenda");
    setNotice("Selecione serviço, data e horário para registrar o retorno.");
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

    const appointmentDayHours = hours.find(
      (item) => item.weekday === new Date(`${date}T12:00:00`).getDay(),
    );

    if (
      appointmentDayHours &&
      overlapsLunchBreak(appointmentTime, service.duration_minutes, {
        enabled: appointmentDayHours.lunch_enabled,
        startsAt: appointmentDayHours.lunch_starts_at,
        endsAt: appointmentDayHours.lunch_ends_at,
      })
    ) {
      setNotice("Este horario fica dentro da pausa para almoço.");
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

      logSupabaseError("[Dashboard] Erro ao criar agendamento", error);
      setNotice(error ? friendlySupabaseError(error) : "Agendamento criado.");
      if (!error) {
        form.reset();
        setSelectedServiceId("");
      }
      await load();
    } finally {
      setActionLoading(false);
    }
  }

  async function updateAppointment(id: string, status: Appointment["status"]) {
    const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
    logSupabaseError("[Dashboard] Erro ao atualizar agendamento", error, {
      appointmentId: id,
      status,
    });
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
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--premium-bg-950)] p-8 text-[var(--premium-text-100)]">
        Carregando...
      </main>
    );
  }

  return (
    <main className="hora-admin relative min-h-screen overflow-x-hidden bg-[var(--premium-bg-950)] text-[var(--premium-text-100)]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(214,176,122,0.15),transparent_28%),radial-gradient(circle_at_92%_12%,rgba(255,255,255,0.07),transparent_22%),linear-gradient(135deg,#080808_0%,#101010_50%,#161616_100%)]" />
      <div className="relative grid min-h-screen lg:grid-cols-[260px_1fr]">
        <aside className="hidden border-r border-[var(--premium-border-soft)] bg-black/30 p-4 backdrop-blur-xl lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
          <div className="mb-10 flex items-center gap-3 px-2 pt-2">
            <div className="grid h-12 w-12 place-items-center rounded-full border border-[var(--premium-border-strong)] text-lg font-black text-[var(--premium-gold-300)]">
              HA
            </div>
            <div>
              <p className="premium-text-title text-3xl font-bold text-[var(--premium-text-100)]">
                HoraAi
              </p>
              <p className="text-xs text-[var(--premium-text-500)]">
                {barbershop?.name ?? "Minha barbearia"}
              </p>
            </div>
          </div>
          <nav className="grid gap-2">
            {nav.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-[var(--premium-radius-md)] px-4 py-3 text-left text-sm font-bold transition ${
                  tab === key
                    ? "border border-[var(--premium-border-strong)] bg-[rgba(214,176,122,0.14)] text-[var(--premium-gold-300)]"
                    : "text-[var(--premium-text-300)] hover:bg-white/[0.05] hover:text-[var(--premium-text-100)]"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
          <button
            onClick={signOut}
            className="mt-auto rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] px-4 py-3 text-left text-sm font-bold text-[var(--premium-text-300)] transition hover:border-[var(--premium-border-strong)] hover:text-[var(--premium-text-100)]"
          >
            Sair
          </button>
        </aside>

        <div className="grid min-w-0 content-start gap-6 px-4 py-5 sm:px-6 lg:px-8">
          <header className="rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-black/20 backdrop-blur-xl">
        <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm leading-6 text-[var(--premium-text-300)]">
              Agenda Barber · {barbershop?.name ?? "Minha barbearia"}
            </p>
            <h1 className="premium-text-title text-4xl font-bold leading-none text-[var(--premium-text-100)]">
              {tab === "agenda" ? "Agenda" : nav.find(([key]) => key === tab)?.[1]}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {barbershop ? (
              <>
                <button
                  type="button"
                  onClick={copyPublicLink}
                  className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-black/25 px-4 py-3 text-sm font-bold text-[var(--premium-gold-300)] transition hover:border-[var(--premium-border-strong)]"
                >
                  Copiar link
                </button>
                <Link
                  className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-strong)] bg-[linear-gradient(135deg,var(--premium-gold-300),var(--premium-gold-500))] px-4 py-3 text-sm font-black text-black transition hover:brightness-110"
                  href={`/agendar/${barbershop.slug}`}
                >
                  Link publico
                </Link>
              </>
            ) : null}
            <button
              onClick={signOut}
              className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] px-4 py-3 text-sm font-bold text-[var(--premium-text-300)] lg:hidden"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <div className="grid gap-6">
        <nav className="flex gap-2 overflow-x-auto rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-black/25 p-2 backdrop-blur-xl lg:hidden">
          {nav.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`shrink-0 rounded-[var(--premium-radius-md)] px-4 py-2 text-sm font-bold ${
                tab === key
                  ? "bg-[var(--premium-gold-400)] text-black"
                  : "text-[var(--premium-text-300)]"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {notice ? (
          <p className="fixed right-4 top-4 z-40 max-w-sm rounded-[var(--premium-radius-md)] border border-[var(--premium-border-strong)] bg-[var(--premium-bg-glass-strong)] px-4 py-3 text-sm text-[var(--premium-text-100)] shadow-[var(--premium-shadow-soft)] backdrop-blur-xl">
            {notice}
          </p>
        ) : null}

        {!barbershop && tab !== "profile" ? (
          <p className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-strong)] bg-[rgba(214,176,122,0.1)] px-4 py-3 text-sm text-[var(--premium-gold-300)]">
            Cadastre o perfil da barbearia para liberar agenda, servicos e link publico.
          </p>
        ) : null}

        {tab === "agenda" && barbershop ? (
          <section className="grid gap-5">
            <div className="hidden">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-bold uppercase text-sky-200">
                    Resumo do dia
                  </p>
                  <h2 className="mt-1 text-2xl font-bold">
                    {date === todayIso() ? "Hoje" : date}
                  </h2>
                </div>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    load(user, event.target.value);
                  }}
                  className="field max-w-52 border-slate-700 bg-slate-900 text-white"
                />
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <PremiumMetric label="Atendimentos de hoje" value={String(dailySummary.count)} />
                <PremiumMetric label="Receita de hoje" value={currency(dailySummary.revenue)} />
                <PremiumMetric label="Clientes atendidos" value={String(dailySummary.attendedClients)} />
                <PremiumMetric
                  label="Proximo horario"
                  value={
                    dailySummary.nextAppointment
                      ? `${dailySummary.nextAppointment.appointment_time.slice(0, 5)} - ${dailySummary.nextAppointment.clients?.name ?? "Cliente"}`
                      : "Livre"
                  }
                />
                <PremiumMetric label="Horarios livres" value={String(adminAvailableSlots.length)} />
                <PremiumMetric label="Faltas/cancelamentos" value={String(dailySummary.cancellations)} />
              </div>

              <button
                type="button"
                onClick={() => setExpandedSummary((current) => !current)}
                className="mt-4 rounded-md border border-sky-300/40 px-4 py-2 text-sm font-bold text-sky-100 transition hover:bg-white/10"
              >
                {expandedSummary ? "Ocultar resumo completo" : "Ver resumo completo"}
              </button>

              {expandedSummary ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <PremiumMetric label="Resumo da semana" value={`${fullSummary.week.count} atend.`} detail={currency(fullSummary.week.revenue)} />
                  <PremiumMetric label="Resumo da quinzena" value={`${fullSummary.fortnight.count} atend.`} detail={currency(fullSummary.fortnight.revenue)} />
                  <PremiumMetric label="Resumo do mes" value={`${fullSummary.month.count} atend.`} detail={currency(fullSummary.month.revenue)} />
                  <PremiumMetric
                    label="Comparativo de melhor dia"
                    value={fullSummary.bestAppointmentDay?.[0] ?? fullSummary.bestRevenueDay?.[0] ?? "-"}
                    detail="Mais forte no historico"
                  />
                  <PremiumMetric label="Dia com maior receita" value={fullSummary.bestRevenueDay?.[0] ?? "-"} detail={currency(fullSummary.bestRevenueDay?.[1].revenue ?? 0)} />
                  <PremiumMetric label="Dia com mais atendimentos" value={fullSummary.bestAppointmentDay?.[0] ?? "-"} detail={`${fullSummary.bestAppointmentDay?.[1].count ?? 0} atend.`} />
                  <PremiumMetric label="Media diaria" value={currency(fullSummary.dailyAverage)} />
                  <PremiumMetric label="Ticket medio" value={currency(fullSummary.averageTicket)} />
                </div>
              ) : null}
            </div>

            <div className="grid gap-5 xl:grid-cols-[0.88fr_1.55fr_0.72fr]">
            <div className="grid gap-4">
              <Panel title="Novo agendamento">
                <form onSubmit={createAppointment} className="grid gap-3">
                  <select
                    name="client_id"
                    required
                    className="field"
                    value={selectedClientId ?? ""}
                    onChange={(event) => setSelectedClientId(event.target.value)}
                  >
                    <option value="">Cliente</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                  <select
                    name="service_id"
                    required
                    className="field"
                    value={selectedServiceId}
                    onChange={(event) => setSelectedServiceId(event.target.value)}
                  >
                    <option value="">Servico</option>
                    {services
                      .filter((service) => service.active)
                      .map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name}
                        </option>
                      ))}
                  </select>
                  <select
                    name="appointment_time"
                    required
                    className="field"
                    disabled={!selectedServiceId}
                  >
                    <option value="">
                      {selectedServiceId ? "Horario livre" : "Selecione um servico"}
                    </option>
                    {adminAvailableSlots.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={date}
                    onChange={(event) => {
                      setDate(event.target.value);
                      load(user, event.target.value);
                    }}
                    className="field"
                  />
                  {selectedDayHours?.active && selectedDayHours.lunch_enabled ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                      Pausa para almoco:{" "}
                      {selectedDayHours.lunch_starts_at?.slice(0, 5)} as{" "}
                      {selectedDayHours.lunch_ends_at?.slice(0, 5)}
                    </p>
                  ) : null}
                  <textarea
                    name="notes"
                    placeholder="Observacoes"
                    className="field min-h-20 py-3"
                  />
                  <button disabled={actionLoading} className="primary-button">
                    Criar agendamento
                  </button>
                </form>
              </Panel>
            </div>
            <Panel title="Agenda do dia">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-[var(--premium-text-300)]">
                  {date === todayIso() ? "Hoje" : date}
                </p>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    load(user, event.target.value);
                  }}
                  className="field max-w-48"
                />
              </div>
              <div className="grid gap-3">
                {selectedDayHours?.active && selectedDayHours.lunch_enabled ? (
                  <LunchBreakBlock
                    startsAt={selectedDayHours.lunch_starts_at}
                    endsAt={selectedDayHours.lunch_ends_at}
                  />
                ) : null}
                {appointments.map((appointment) => (
                  <AppointmentItem
                    key={appointment.id}
                    appointment={appointment}
                    barbershopName={barbershop.name}
                    onCancel={() => updateAppointment(appointment.id, "cancelled")}
                    onConfirm={() => updateAppointment(appointment.id, "confirmed")}
                  />
                ))}
                {!appointments.length ? (
                  <PremiumEmptyState
                    title="Nenhum agendamento para esta data."
                    description="Quando um horario for criado, ele aparece aqui na agenda do dia."
                  />
                ) : null}
              </div>
            </Panel>
            <Panel title="Resumo do dia">
              <div className="grid gap-3">
                <SummaryStat label="Agendamentos" value={String(dailySummary.count)} />
                <SummaryStat label="Receita" value={currency(dailySummary.revenue)} />
                <SummaryStat
                  label="Clientes atendidos"
                  value={String(dailySummary.attendedClients)}
                />
                <SummaryStat
                  label="Proximo horario"
                  value={
                    dailySummary.nextAppointment
                      ? dailySummary.nextAppointment.appointment_time.slice(0, 5)
                      : "Livre"
                  }
                />
                <SummaryStat
                  label="Horarios livres"
                  value={String(adminAvailableSlots.length)}
                />
                <SummaryStat
                  label="Cancelamentos"
                  value={String(dailySummary.cancellations)}
                />
              </div>
              <button
                type="button"
                onClick={() => setExpandedSummary((current) => !current)}
                className="small-button mt-4 w-full justify-center"
              >
                {expandedSummary ? "Ocultar resumo completo" : "Ver resumo completo"}
              </button>
              {expandedSummary ? (
                <div className="mt-4 grid gap-3">
                  <SummaryStat
                    label="Semana"
                    value={`${fullSummary.week.count} atend.`}
                    detail={currency(fullSummary.week.revenue)}
                  />
                  <SummaryStat
                    label="Mes"
                    value={`${fullSummary.month.count} atend.`}
                    detail={currency(fullSummary.month.revenue)}
                  />
                  <SummaryStat
                    label="Ticket medio"
                    value={currency(fullSummary.averageTicket)}
                  />
                </div>
              ) : null}
            </Panel>
            </div>
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
                    className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 lg:grid-cols-[1fr_140px_140px_110px_140px_140px_130px] lg:items-center"
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
                    <input
                      name={`lunch_starts_${weekday}`}
                      type="time"
                      defaultValue={row?.lunch_starts_at?.slice(0, 5) ?? "12:00"}
                      className="field"
                      aria-label={`Inicio do almoço em ${label}`}
                    />
                    <input
                      name={`lunch_ends_${weekday}`}
                      type="time"
                      defaultValue={row?.lunch_ends_at?.slice(0, 5) ?? "13:00"}
                      className="field"
                      aria-label={`Fim do almoço em ${label}`}
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        name={`lunch_enabled_${weekday}`}
                        type="checkbox"
                        defaultChecked={row?.lunch_enabled ?? false}
                      />
                      Almoço
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
              <form id="novo-cliente" onSubmit={saveClient} className="grid gap-3">
                <label className="grid gap-2">
                  <span className="premium-label">Nome</span>
                  <input name="name" placeholder="Nome do cliente" required className="field" />
                </label>
                <label className="grid gap-2">
                  <span className="premium-label">WhatsApp</span>
                <input
                  name="phone"
                  placeholder="WhatsApp com DDD"
                  className="field"
                />
                </label>
                <label className="grid gap-2">
                  <span className="premium-label">Frequencia</span>
                <input
                  name="preferred_frequency_days"
                  type="number"
                  min={1}
                  placeholder="Frequencia desejada em dias"
                  className="field"
                />
                </label>
                <label className="grid gap-2">
                  <span className="premium-label">Observacoes</span>
                <textarea
                  name="notes"
                  placeholder="Preferencias, estilo, observacoes..."
                  className="field min-h-24 py-3"
                />
                </label>
                <button className="primary-button">Cadastrar cliente</button>
              </form>
            </Panel>
            <Panel title="Clientes">
              <div className="mb-5 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                <p className="text-sm leading-6 text-[var(--premium-text-300)]">
                  Veja seus clientes e acompanhe o historico de atendimento.
                </p>
                <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_auto]">
                  <input
                    value={clientSearch}
                    onChange={(event) => setClientSearch(event.target.value)}
                    placeholder="Buscar cliente..."
                    className="field"
                  />
                  <a href="#novo-cliente" className="primary-button text-center">
                    Novo cliente
                  </a>
                </div>
              </div>
              <div className="grid gap-3">
                {filteredClients.map((client) => {
                  const frequency = clientFrequency[client.id];

                  return (
                    <article key={client.id} className="premium-list-item">
                      <div className="grid gap-4">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedClientId((current) =>
                              current === client.id ? null : client.id,
                            )
                          }
                          className="grid min-w-0 gap-4 text-left sm:grid-cols-[auto_1fr_auto] sm:items-center"
                        >
                          <div className="grid h-12 w-12 place-items-center rounded-full border border-[var(--premium-border-soft)] bg-[rgba(214,176,122,0.12)] text-sm font-black text-[var(--premium-gold-300)]">
                            {clientInitials(client.name)}
                          </div>
                          <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="truncate text-base font-bold text-[var(--premium-text-100)]">{client.name}</p>
                            {frequency ? (
                              <PremiumBadge tone={frequency.status === "Sumido" ? "muted" : "gold"}>
                                {frequency.status}
                              </PremiumBadge>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-sm text-[var(--premium-text-300)]">
                            {maskPhone(client.phone)}
                          </p>
                          <p className="hidden">
                            Ultima visita: {frequency?.lastVisit ?? "sem visitas"} ·{" "}
                          </p>
                          <p className="mt-1 text-sm text-[var(--premium-text-500)]">
                            Ultima visita: {frequency?.lastVisit ?? "sem visitas"}
                          </p>
                          </div>
                          <span className="text-xl text-[var(--premium-gold-300)]">
                            {selectedClientId === client.id ? "↑" : "↓"}
                          </span>
                        </button>
                        {selectedClientId === client.id ? (
                          <ClientDetails
                            client={client}
                            frequency={frequency}
                            onCall={() => callClientOnWhatsapp(client)}
                            onDelete={() => setDeleteClientCandidate(client)}
                            onEdit={() => setEditingClient(client)}
                            onRegisterReturn={() => registerClientReturn(client)}
                          />
                        ) : null}
                        <div className="hidden grid-cols-1 gap-2 sm:grid-cols-3">
                          <button
                            type="button"
                            onClick={() => callClientOnWhatsapp(client)}
                            className="small-button min-h-11"
                          >
                            Chamar no WhatsApp
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingClient(client)}
                            className="small-button min-h-11"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteClientCandidate(client)}
                            className="small-button min-h-11 border-red-200 text-red-700"
                          >
                            Excluir
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
                {!clients.length ? <EmptyClientsState /> : null}
                {clients.length && !filteredClients.length ? (
                  <PremiumEmptyState
                    title="Nenhum cliente encontrado."
                    description="Tente buscar por outro nome ou telefone."
                  />
                ) : null}
              </div>
            </Panel>
            {false && selectedClient ? (
              <Panel title="Detalhe do cliente">
                <div className="grid gap-4">
                  <div>
                    <p className="text-lg font-bold">{selectedClient.name}</p>
                    <p className="text-sm text-slate-600">
                      {formatPhoneBR(selectedClient.phone)}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Metric
                      label="Status"
                      value={clientFrequency[selectedClient.id]?.status ?? "Novo"}
                    />
                    <Metric
                      label="Ultima visita"
                      value={clientFrequency[selectedClient.id]?.lastVisit ?? "-"}
                    />
                    <Metric
                      label="Visitas"
                      value={String(
                        clientFrequency[selectedClient.id]?.totalVisits ?? 0,
                      )}
                    />
                  </div>
                  <p className="text-sm text-slate-600">
                    Frequencia media:{" "}
                    {clientFrequency[selectedClient.id]?.averageFrequency
                      ? `${clientFrequency[selectedClient.id]?.averageFrequency} dias`
                      : "ainda sem dados suficientes"}
                  </p>
                  {selectedClient.notes ? (
                    <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      {selectedClient.notes}
                    </p>
                  ) : null}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => callClientOnWhatsapp(selectedClient)}
                      className="primary-button"
                    >
                      Chamar no WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() => registerClientReturn(selectedClient)}
                      className="small-button min-h-11 text-center"
                    >
                      Registrar retorno/agendamento
                    </button>
                  </div>
                  <div className="grid gap-2">
                    <p className="text-sm font-bold text-slate-700">
                      Historico de atendimentos
                    </p>
                    {(clientFrequency[selectedClient.id]?.visits ?? []).map(
                      (appointment) => (
                        <div
                          key={appointment.id}
                          className="rounded-md border border-slate-200 bg-white p-3 text-sm"
                        >
                          <p className="font-semibold">
                            {appointment.appointment_date} as{" "}
                            {appointment.appointment_time.slice(0, 5)}
                          </p>
                          <p className="text-slate-600">
                            {appointment.services?.name ?? "Servico"} ·{" "}
                            {appointment.status}
                          </p>
                        </div>
                      ),
                    )}
                    {!clientFrequency[selectedClient.id]?.visits.length ? (
                      <p className="text-sm text-slate-600">
                        Nenhum atendimento registrado para este cliente.
                      </p>
                    ) : null}
                  </div>
                </div>
              </Panel>
            ) : null}
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
        </div>
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

      {editingClient ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4">
          <div className="w-full max-w-lg rounded-md border border-slate-200 bg-white p-5 shadow-lg">
            <h2 className="text-xl font-bold text-slate-950">Editar contato</h2>
            <form onSubmit={updateClient} className="mt-4 grid gap-3">
              <input
                name="name"
                defaultValue={editingClient.name}
                required
                className="field"
              />
              <input
                name="phone"
                defaultValue={editingClient.phone ?? ""}
                placeholder="WhatsApp com DDD"
                className="field"
              />
              <input
                name="preferred_frequency_days"
                type="number"
                min={1}
                defaultValue={editingClient.preferred_frequency_days ?? ""}
                placeholder="Frequencia desejada em dias"
                className="field"
              />
              <textarea
                name="notes"
                defaultValue={editingClient.notes ?? ""}
                placeholder="Observacoes"
                className="field min-h-24 py-3"
              />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setEditingClient(null)}
                  className="small-button"
                >
                  Cancelar
                </button>
                <button disabled={actionLoading} className="primary-button px-5">
                  Salvar contato
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteClientCandidate ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4">
          <div className="w-full max-w-md rounded-md border border-slate-200 bg-white p-5 shadow-lg">
            <h2 className="text-xl font-bold text-slate-950">Excluir contato?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Tem certeza que deseja excluir este cliente?
            </p>
            <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
              {deleteClientCandidate.name}
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeleteClientCandidate(null)}
                className="small-button"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => deleteClient(deleteClientCandidate)}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-800 disabled:opacity-60"
              >
                Excluir contato
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
    <div className="animate-pulse rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-white/[0.04] p-4">
      <div className="mb-3 h-5 w-2/3 rounded bg-white/10" />
      <div className="h-4 w-1/2 rounded bg-white/5" />
    </div>
  );
}

function PremiumMetric({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.06] p-4">
      <p className="text-xs font-bold uppercase text-sky-100">{label}</p>
      <p className="mt-2 break-words text-2xl font-black leading-tight text-white">
        {value}
      </p>
      {detail ? <p className="mt-1 text-sm text-slate-300">{detail}</p> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-white/[0.04] p-4">
      <p className="text-xs font-semibold uppercase text-[var(--premium-text-500)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-[var(--premium-text-100)]">
        {value}
      </p>
    </div>
  );
}

function SummaryStat({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-white/[0.035] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--premium-text-500)]">
        {label}
      </p>
      <p className="mt-2 break-words text-2xl font-black text-[var(--premium-gold-300)]">
        {value}
      </p>
      {detail ? (
        <p className="mt-1 text-sm text-[var(--premium-text-300)]">{detail}</p>
      ) : null}
    </div>
  );
}

type ClientFrequencySummary = {
  averageFrequency: number | null;
  lastVisit: string | null;
  status: ClientFrequencyStatus;
  totalVisits: number;
  visits: Appointment[];
};

function clientInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function maskPhone(phone: string) {
  const formatted = formatPhoneBR(phone);
  const digits = phone.replace(/\D/g, "");

  if (digits.length < 4) {
    return formatted;
  }

  return `${formatted.slice(0, 5)} ... ${formatted.slice(-4)}`;
}

function EmptyClientsState() {
  return (
    <div className="premium-empty-state">
      <span className="mx-auto block h-1.5 w-10 rounded-full bg-[var(--premium-gold-400)] opacity-80" />
      <p className="mt-4 text-sm font-semibold text-[var(--premium-text-100)]">
        Nenhum cliente cadastrado ainda.
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-[var(--premium-text-300)]">
        Cadastre seu primeiro cliente para começar a organizar sua agenda.
      </p>
      <a href="#novo-cliente" className="primary-button mt-5 inline-flex">
        Cadastrar cliente
      </a>
    </div>
  );
}

function ClientDetails({
  client,
  frequency,
  onCall,
  onDelete,
  onEdit,
  onRegisterReturn,
}: {
  client: Client;
  frequency?: ClientFrequencySummary;
  onCall: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onRegisterReturn: () => void;
}) {
  return (
    <div className="grid gap-4 border-t border-[var(--premium-border-soft)] pt-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Telefone" value={formatPhoneBR(client.phone)} />
        <Metric label="Ultima visita" value={frequency?.lastVisit ?? "-"} />
        <Metric label="Atendimentos" value={String(frequency?.totalVisits ?? 0)} />
      </div>

      <p className="text-sm text-[var(--premium-text-300)]">
        Frequencia media:{" "}
        {frequency?.averageFrequency
          ? `${frequency.averageFrequency} dias`
          : "ainda sem dados suficientes"}
      </p>

      {client.notes ? (
        <p className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-white/[0.035] p-3 text-sm leading-6 text-[var(--premium-text-300)]">
          {client.notes}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <button type="button" onClick={onCall} className="primary-button">
          WhatsApp
        </button>
        <button type="button" onClick={onRegisterReturn} className="small-button min-h-11">
          Registrar retorno
        </button>
        <button type="button" onClick={onEdit} className="small-button min-h-11">
          Editar
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="small-button min-h-11 border-red-300/30 text-red-200"
        >
          Excluir
        </button>
      </div>

      <div className="grid gap-2">
        <p className="premium-label">Historico resumido</p>
        {(frequency?.visits ?? []).slice(0, 4).map((appointment) => (
          <div
            key={appointment.id}
            className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-white/[0.03] p-3 text-sm"
          >
            <p className="font-semibold text-[var(--premium-text-100)]">
              {appointment.appointment_date} as{" "}
              {appointment.appointment_time.slice(0, 5)}
            </p>
            <p className="mt-1 text-[var(--premium-text-300)]">
              {appointment.services?.name ?? "Servico"} · {appointment.status}
            </p>
          </div>
        ))}
        {!frequency?.visits.length ? (
          <p className="text-sm text-[var(--premium-text-300)]">
            Nenhum atendimento registrado para este cliente.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function AppointmentItem({
  appointment,
  barbershopName,
  onCancel,
  onConfirm,
}: {
  appointment: Appointment;
  barbershopName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <PremiumListItem className="border-l-4 border-l-[var(--premium-gold-400)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-bold text-[var(--premium-text-100)]">
              {appointment.appointment_time.slice(0, 5)}
            </p>
            <PremiumBadge tone={appointment.status === "cancelled" ? "red" : "gold"}>
              {appointment.status}
            </PremiumBadge>
          </div>
          <p className="mt-2 font-semibold text-[var(--premium-text-100)]">
            {appointment.clients?.name ?? "Cliente"}
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--premium-text-300)]">
            {appointment.services?.name ?? "Servico"} ·{" "}
            {formatPhoneBR(appointment.clients?.phone)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {appointment.clients?.phone ? (
            <a
              href={whatsappLink(
                appointment.clients.phone,
                `Ola ${appointment.clients.name}, seu horario na ${barbershopName} esta marcado para ${appointment.appointment_date} as ${appointment.appointment_time.slice(0, 5)}.`,
              )}
              target="_blank"
              className="small-button"
            >
              WhatsApp
            </a>
          ) : null}
          <button onClick={onConfirm} className="small-button">
            Confirmar
          </button>
          <button onClick={onCancel} className="small-button">
            Cancelar
          </button>
        </div>
      </div>
    </PremiumListItem>
  );
}

function LunchBreakBlock({
  endsAt,
  startsAt,
}: {
  endsAt?: string | null;
  startsAt?: string | null;
}) {
  return (
    <div className="rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-strong)] bg-[rgba(214,176,122,0.1)] p-4 shadow-[var(--premium-shadow-soft)]">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full border border-[var(--premium-border-strong)] text-[var(--premium-gold-300)]">
          ||
        </span>
        <div>
          <p className="font-bold text-[var(--premium-gold-300)]">
            Pausa para almoco
          </p>
          <p className="text-sm text-[var(--premium-text-300)]">
            {startsAt?.slice(0, 5)} as {endsAt?.slice(0, 5)}
          </p>
        </div>
      </div>
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
    <section className="rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-[var(--premium-bg-glass)] p-5 shadow-[var(--premium-shadow-soft)] backdrop-blur-xl">
      <h2 className="mb-4 text-xl font-bold text-[var(--premium-text-100)]">
        {title}
      </h2>
      {children}
    </section>
  );
}
