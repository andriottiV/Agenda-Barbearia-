"use client";

import Image from "next/image";
import Link from "next/link";
import {
  DragEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import {
  PremiumBadge,
  PremiumEmptyState,
} from "../../components/ui/premium";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { logSupabaseError } from "../lib/supabase-debug";
import { supabase } from "../lib/supabase";
import { friendlySupabaseError } from "../lib/supabase-errors";
import {
  currency,
  formatPhoneBR,
  isInsideBusinessHours,
  makeSlots,
  minutesFromTime,
  overlapsLunchBreak,
  overlapsTimeRange,
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
  Notification as AppNotification,
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
  notifications:
    "notifications.select(id, user_id, appointment_id, type, title, message, read, created_at).eq(user_id).order(created_at desc).limit(10)",
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

function formatNotificationTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function hasValidPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
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
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const pushNotifications = usePushNotifications(user);

  const publicPath = barbershop ? `/agendar/${barbershop.slug}` : "";
  const unreadNotifications = notifications.filter((item) => !item.read).length;

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
    await loadNotifications(currentUser.id);
    setLoading(false);
  }

  async function loadNotifications(userId = user?.id) {
    if (!userId) return;

    const { data, error } = await supabase
      .from("notifications")
      .select("id, user_id, appointment_id, type, title, message, read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      logSupabaseError("[Dashboard] Erro ao carregar notificacoes", error, {
        table: "notifications",
        query: DASHBOARD_QUERIES.notifications,
        filter: { user_id: userId },
      });
      return;
    }

    const unreadNotificationsById = new Map<string, AppNotification>();

    ((data ?? []) as AppNotification[]).forEach((notification) => {
      if (!notification.read) {
        unreadNotificationsById.set(notification.id, notification);
      }
    });

    setNotifications(Array.from(unreadNotificationsById.values()));
  }

  async function markNotificationAsRead(notificationId: string) {
    setNotifications((current) =>
      current.filter((item) => item.id !== notificationId),
    );

    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", notificationId);

    if (error) {
      logSupabaseError("[Dashboard] Erro ao marcar notificacao como lida", error, {
        notificationId,
      });
      setNotice(friendlySupabaseError(error));
      await loadNotifications();
      return;
    }
  }

  async function clearNotifications() {
    if (!user) return;

    setNotifications([]);
    setNotificationsOpen(false);

    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);

    if (error) {
      logSupabaseError("[Dashboard] Erro ao limpar notificacoes", error, {
        userId: user.id,
      });
      setNotice(friendlySupabaseError(error));
      await loadNotifications(user.id);
      return;
    }

    setNotice("Notificacoes limpas.");
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
    let mounted = true;

    async function restoreSession() {
      setLoading(true);

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (!mounted) return;

      if (sessionError) {
        console.error("[Dashboard Auth] Erro ao restaurar sessao", sessionError);
      }

      const sessionUser = sessionData.session?.user ?? null;

      if (sessionUser) {
        setUser(sessionUser);
        await load(sessionUser);
        return;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (!mounted) return;

      if (userError) {
        console.error("[Dashboard Auth] Erro ao validar usuario", userError);
      }

      if (!userData.user) {
        setLoading(false);
        router.replace("/");
        return;
      }

      setUser(userData.user);
      await load(userData.user);
    }

    restoreSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === "SIGNED_OUT") {
        setUser(null);
        router.replace("/");
        return;
      }

      if (session?.user) {
        setUser(session.user);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!user) return;

    const interval = window.setInterval(() => {
      loadNotifications(user.id);
    }, 30000);

    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!notificationsOpen) return;

    function closeNotificationsOnOutsideClick(event: MouseEvent | TouchEvent) {
      const target = event.target;

      if (
        target instanceof Node &&
        notificationsRef.current &&
        !notificationsRef.current.contains(target)
      ) {
        setNotificationsOpen(false);
      }
    }

    document.addEventListener("mousedown", closeNotificationsOnOutsideClick);
    document.addEventListener("touchstart", closeNotificationsOnOutsideClick);

    return () => {
      document.removeEventListener("mousedown", closeNotificationsOnOutsideClick);
      document.removeEventListener("touchstart", closeNotificationsOnOutsideClick);
    };
  }, [notificationsOpen]);

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
    const occupiedRanges = appointments
      .filter((appointment) => appointment.status !== "cancelled")
      .map((appointment) => ({
        startTime: appointment.appointment_time.slice(0, 5),
        durationMinutes: appointment.services?.duration_minutes ?? 30,
      }));

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
      occupiedRanges,
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
    router.replace("/");
  }

  async function copyPublicLink() {
    if (!publicPath) return;
    const fullUrl = `${window.location.origin}${publicPath}`;

    try {
      await navigator.clipboard.writeText(fullUrl);
      setNotice("Link de agendamento copiado.");
    } catch {
      setNotice(`Link de agendamento: ${fullUrl}`);
    }
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

    if (!payload.name || !payload.slug) {
      setNotice("Informe o nome da barbearia para salvar o perfil.");
      return;
    }

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

    if (!payload.name) {
      setNotice("Informe o nome do servico.");
      return;
    }

    if (!Number.isFinite(payload.duration_minutes) || payload.duration_minutes <= 0) {
      setNotice("Informe uma duracao valida para o servico.");
      return;
    }

    if (!Number.isFinite(payload.price) || payload.price < 0) {
      setNotice("Informe um preco valido para o servico.");
      return;
    }

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

    if (!payload.name) {
      setNotice("Informe o nome do servico.");
      return;
    }

    if (!Number.isFinite(payload.duration_minutes) || payload.duration_minutes <= 0) {
      setNotice("Informe uma duracao valida para o servico.");
      return;
    }

    if (!Number.isFinite(payload.price) || payload.price < 0) {
      setNotice("Informe um preco valido para o servico.");
      return;
    }

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

    const invalidRow = rows.find((row) => {
      if (!row.active) return false;
      if (minutesFromTime(row.opens_at) >= minutesFromTime(row.closes_at)) {
        return true;
      }

      if (!row.lunch_enabled) return false;

      const lunchStarts = minutesFromTime(row.lunch_starts_at);
      const lunchEnds = minutesFromTime(row.lunch_ends_at);

      return (
        lunchStarts >= lunchEnds ||
        lunchStarts < minutesFromTime(row.opens_at) ||
        lunchEnds > minutesFromTime(row.closes_at)
      );
    });

    if (invalidRow) {
      setNotice(
        `Revise os horarios de ${weekdays[invalidRow.weekday]}: abertura, fechamento e pausa precisam estar em ordem.`,
      );
      return;
    }

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

    if (!clientPayload.name) {
      setNotice("Nome e telefone sao obrigatorios para salvar o cliente.");
      return;
    }

    if (!hasValidPhone(clientPayload.phone)) {
      setNotice("Informe um WhatsApp valido com DDD.");
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
    const name = String(formData.get("name")).trim();
    const phone = String(formData.get("phone") ?? "").trim();

    if (!name) {
      setNotice("Informe o nome do cliente.");
      return;
    }

    if (!hasValidPhone(phone)) {
      setNotice("Informe um WhatsApp valido com DDD.");
      return;
    }

    setActionLoading(true);
    try {
      const { error } = await supabase
        .from("clients")
        .update({
          name,
          phone,
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
    if (!barbershop) return;

    setActionLoading(true);
    try {
      const { data, error } = await supabase
        .from("clients")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", client.id)
        .eq("barbershop_id", barbershop.id)
        .is("deleted_at", null)
        .select("id")
        .maybeSingle();

      logSupabaseError("[Dashboard] Erro ao excluir cliente", error, {
        clientId: client.id,
        barbershopId: barbershop.id,
      });

      if (error) {
        setNotice(friendlySupabaseError(error));
        return;
      }

      if (!data) {
        setNotice("Cliente nao encontrado ou ja excluido.");
        setDeleteClientCandidate(null);
        setClients((current) => current.filter((item) => item.id !== client.id));
        return;
      }

      setClients((current) => current.filter((item) => item.id !== client.id));
      setClientSearch("");
      setDeleteClientCandidate(null);
      if (selectedClientId === client.id) setSelectedClientId(null);
      setNotice("Cliente excluido.");
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
    if (!service || !client) {
      setNotice("Selecione cliente e servico para criar o agendamento.");
      return;
    }

    const appointmentTime = String(formData.get("appointment_time"));
    if (!appointmentTime) {
      setNotice("Selecione um horario livre.");
      return;
    }

    const appointmentDayHours = hours.find(
      (item) => item.weekday === new Date(`${date}T12:00:00`).getDay(),
    );

    if (!appointmentDayHours?.active) {
      setNotice("A barbearia esta fechada nesta data.");
      return;
    }

    if (
      !isInsideBusinessHours(
        appointmentTime,
        service.duration_minutes,
        appointmentDayHours.opens_at,
        appointmentDayHours.closes_at,
      )
    ) {
      setNotice("Este horario fica fora do expediente.");
      return;
    }

    const conflict = appointments.some((item) => {
      if (item.status === "cancelled") return false;

      return overlapsTimeRange(
        appointmentTime,
        service.duration_minutes,
        item.appointment_time.slice(0, 5),
        item.services?.duration_minutes ?? 30,
      );
    });

    if (conflict) {
      setNotice("Este horario ja esta ocupado.");
      return;
    }

    if (
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
          <div className="mb-10 grid gap-3 px-2 pt-2">
            <div className="w-full max-w-[168px]">
              <Image
                src="/logoAB.png"
                alt="HoraAi"
                width={1400}
                height={411}
                priority
                className="h-auto w-full object-contain"
                sizes="168px"
              />
            </div>
            <div>
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
          <header className="relative z-[9000] overflow-visible rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-black/20 backdrop-blur-xl">
        <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 w-[112px]">
              <Image
                src="/logoAB.png"
                alt="HoraAi"
                width={1400}
                height={411}
                className="h-auto w-full object-contain"
                sizes="112px"
              />
            </div>
            <p className="text-sm leading-6 text-[var(--premium-text-300)]">
              {barbershop?.name ?? "Minha barbearia"}
            </p>
            <h1 className="premium-text-title text-4xl font-bold leading-none text-[var(--premium-text-100)]">
              {tab === "agenda" ? "Agenda" : nav.find(([key]) => key === tab)?.[1]}
            </h1>
          </div>
          <div className="relative z-[9999] flex flex-wrap items-center gap-2 overflow-visible">
            <div ref={notificationsRef} className="relative z-[9999]">
              <button
                type="button"
                onClick={() => setNotificationsOpen((current) => !current)}
                className="relative inline-flex h-12 w-12 items-center justify-center rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-black/25 text-[var(--premium-gold-300)] transition hover:border-[var(--premium-border-strong)]"
                aria-label="Notificacoes"
              >
                <svg
                  aria-hidden="true"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0a3 3 0 0 1-6 0m6 0H9"
                  />
                </svg>
                {unreadNotifications ? (
                  <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--premium-gold-400)] px-1 text-[0.68rem] font-black text-black">
                    {unreadNotifications}
                  </span>
                ) : null}
              </button>

              {notificationsOpen ? (
                <div className="fixed left-4 right-4 top-24 z-[9999] max-h-[calc(100vh-7rem)] overflow-hidden rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-[var(--premium-bg-glass-strong)] p-3 shadow-[var(--premium-shadow-card)] backdrop-blur-xl sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-3 sm:w-[min(22rem,calc(100vw-2rem))]">
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 px-2 pb-3">
                    <div>
                      <p className="text-sm font-bold text-[var(--premium-text-100)]">
                        Notificacoes
                      </p>
                      <p className="text-xs text-[var(--premium-text-500)]">
                        Ultimos avisos do HoraAi
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => loadNotifications()}
                        className="rounded-[var(--premium-radius-sm)] border border-[var(--premium-border-soft)] px-3 py-2 text-xs font-bold text-[var(--premium-gold-300)]"
                      >
                        Atualizar
                      </button>
                      <button
                        type="button"
                        onClick={clearNotifications}
                        disabled={!notifications.length}
                        className="rounded-[var(--premium-radius-sm)] border border-[var(--premium-border-soft)] px-3 py-2 text-xs font-bold text-[var(--premium-text-300)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Limpar
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid max-h-96 gap-2 overflow-y-auto">
                    {notifications.length ? (
                      notifications.map((notification) => (
                        <button
                          key={notification.id}
                          type="button"
                          onClick={() => markNotificationAsRead(notification.id)}
                          className={`rounded-[var(--premium-radius-md)] border p-3 text-left transition ${
                            notification.read
                              ? "border-white/10 bg-white/[0.03]"
                              : "border-[var(--premium-border-strong)] bg-[rgba(214,176,122,0.1)]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-bold text-[var(--premium-text-100)]">
                              {notification.title}
                            </p>
                            {!notification.read ? (
                              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--premium-gold-400)]" />
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-[var(--premium-text-300)]">
                            {notification.message}
                          </p>
                          <p className="mt-2 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--premium-text-500)]">
                            {formatNotificationTime(notification.created_at)}
                          </p>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-[var(--premium-radius-md)] border border-dashed border-[var(--premium-border-soft)] p-5 text-center">
                        <p className="text-sm font-bold text-[var(--premium-text-100)]">
                          Nenhuma notificacao ainda.
                        </p>
                        <p className="mt-1 text-xs text-[var(--premium-text-500)]">
                          Novos agendamentos aparecerao aqui.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            {barbershop ? (
              <>
                <button
                  type="button"
                  onClick={async () => {
                    const result =
                      await pushNotifications.enablePushNotifications();
                    setNotice(result.message);
                  }}
                  disabled={pushNotifications.isDisabled}
                  title={pushNotifications.message || undefined}
                  className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-black/25 px-4 py-3 text-sm font-bold text-[var(--premium-text-200)] transition hover:border-[var(--premium-border-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pushNotifications.buttonLabel}
                </button>
                <button
                  type="button"
                  onClick={copyPublicLink}
                  className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-black/25 px-4 py-3 text-sm font-bold text-[var(--premium-gold-300)] transition hover:border-[var(--premium-border-strong)]"
                >
                  Copiar link de agendamento
                </button>
                <Link
                  className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-strong)] bg-[linear-gradient(135deg,var(--premium-gold-300),var(--premium-gold-500))] px-4 py-3 text-sm font-black text-black transition hover:brightness-110"
                  href={`/agendar/${barbershop.slug}`}
                >
                  Abrir link público
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
        <nav className="sticky top-2 z-30 flex gap-2 overflow-x-auto rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-[rgba(8,8,8,0.82)] p-2 shadow-[var(--premium-shadow-soft)] backdrop-blur-xl lg:hidden">
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
            Cadastre o perfil da barbearia para liberar agenda, servicos e link de agendamento.
          </p>
        ) : null}

        {tab === "agenda" && barbershop ? (
          <section className="grid gap-5">
            <div className="rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-[rgba(16,16,16,0.72)] p-4 shadow-[var(--premium-shadow-soft)] backdrop-blur-xl sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--premium-gold-300)]">
                    Agenda do barbeiro
                  </p>
                  <h2 className="mt-2 text-2xl font-black leading-tight text-[var(--premium-text-100)] sm:text-3xl">
                    {date === todayIso() ? "Hoje" : date}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--premium-text-300)]">
                    {selectedDayHours?.active
                      ? `${selectedDayHours.opens_at.slice(0, 5)} as ${selectedDayHours.closes_at.slice(0, 5)}`
                      : "Fechado nesta data"}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="date"
                    value={date}
                    onChange={(event) => {
                      setDate(event.target.value);
                      load(user, event.target.value);
                    }}
                    className="field sm:w-48"
                  />
                  <a href="#novo-agendamento" className="primary-button inline-flex justify-center">
                    Novo agendamento
                  </a>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <AgendaMetric label="Agendamentos" value={String(dailySummary.count)} />
                <AgendaMetric label="Receita prevista" value={currency(dailySummary.revenue)} />
                <AgendaMetric
                  label="Proximo horario"
                  value={
                    dailySummary.nextAppointment
                      ? dailySummary.nextAppointment.appointment_time.slice(0, 5)
                      : "Livre"
                  }
                  detail={dailySummary.nextAppointment?.clients?.name ?? undefined}
                />
                <AgendaMetric label="Horarios livres" value={String(adminAvailableSlots.length)} />
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.65fr)]">
              <section className="grid gap-4">
                <Panel title="Agenda do dia">
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
                      <div className="rounded-[var(--premium-radius-lg)] border border-dashed border-[var(--premium-border-soft)] bg-white/[0.025] p-8 text-center">
                        <p className="text-base font-bold text-[var(--premium-text-100)]">
                          Nenhum horario marcado.
                        </p>
                        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--premium-text-300)]">
                          Crie um agendamento pelo formulario ou compartilhe o link publico.
                        </p>
                        <a href="#novo-agendamento" className="primary-button mt-5 inline-flex">
                          Criar agendamento
                        </a>
                      </div>
                    ) : null}
                  </div>
                </Panel>
              </section>

              <aside className="grid content-start gap-4">
                <Panel title="Novo agendamento">
                  <form
                    id="novo-agendamento"
                    onSubmit={createAppointment}
                    className="grid gap-3"
                  >
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
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <input
                        type="date"
                        value={date}
                        onChange={(event) => {
                          setDate(event.target.value);
                          load(user, event.target.value);
                        }}
                        className="field"
                      />
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
                    </div>
                    {selectedDayHours?.active && selectedDayHours.lunch_enabled ? (
                      <p className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-[rgba(214,176,122,0.08)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--premium-gold-300)]">
                        Pausa: {selectedDayHours.lunch_starts_at?.slice(0, 5)} as{" "}
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

                <Panel title="Resumo">
                  <div className="grid gap-3">
                    <SummaryStat
                      label="Clientes"
                      value={String(dailySummary.attendedClients)}
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
                    {expandedSummary ? "Ocultar historico" : "Ver historico"}
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
              </aside>
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

function AgendaMetric({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-white/[0.035] p-4">
      <p className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-[var(--premium-text-500)]">
        {label}
      </p>
      <p className="mt-2 truncate text-2xl font-black leading-none text-[var(--premium-text-100)]">
        {value}
      </p>
      {detail ? (
        <p className="mt-2 truncate text-xs font-semibold text-[var(--premium-gold-300)]">
          {detail}
        </p>
      ) : null}
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
    <div className="rounded-[var(--premium-radius-md)] border border-[var(--premium-border-soft)] bg-white/[0.03] p-3">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[var(--premium-text-500)]">
        {label}
      </p>
      <p className="mt-1 break-words text-xl font-black text-[var(--premium-gold-300)]">
        {value}
      </p>
      {detail ? (
        <p className="mt-1 text-xs text-[var(--premium-text-300)]">{detail}</p>
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
    <article className="rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-[rgba(16,16,16,0.78)] p-4 shadow-[var(--premium-shadow-soft)] backdrop-blur-xl">
      <div className="grid gap-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
        <div className="grid h-16 w-20 place-items-center rounded-[var(--premium-radius-md)] border border-[var(--premium-border-strong)] bg-[rgba(214,176,122,0.1)]">
          <p className="text-2xl font-black leading-none text-[var(--premium-gold-300)]">
            {appointment.appointment_time.slice(0, 5)}
          </p>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-bold text-[var(--premium-text-100)]">
              {appointment.clients?.name ?? "Cliente"}
            </p>
            <PremiumBadge tone={appointment.status === "cancelled" ? "red" : "gold"}>
              {appointment.status}
            </PremiumBadge>
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-[var(--premium-text-300)]">
            {appointment.services?.name ?? "Servico"}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--premium-text-500)]">
            {formatPhoneBR(appointment.clients?.phone)}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {appointment.clients?.phone ? (
            <a
              href={whatsappLink(
                appointment.clients.phone,
                `Ola ${appointment.clients.name}, seu horario na ${barbershopName} esta marcado para ${appointment.appointment_date} as ${appointment.appointment_time.slice(0, 5)}.`,
              )}
              target="_blank"
              rel="noreferrer"
              className="small-button min-h-11"
            >
              WhatsApp
            </a>
          ) : null}
          <button type="button" onClick={onConfirm} className="small-button min-h-11">
            Confirmar
          </button>
          <button type="button" onClick={onCancel} className="small-button min-h-11">
            Cancelar
          </button>
        </div>
      </div>
    </article>
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
    <section className="rounded-[var(--premium-radius-lg)] border border-[var(--premium-border-soft)] bg-[var(--premium-bg-glass)] p-4 shadow-[var(--premium-shadow-soft)] backdrop-blur-xl sm:p-5">
      <h2 className="mb-4 text-base font-bold text-[var(--premium-text-100)] sm:text-lg">
        {title}
      </h2>
      {children}
    </section>
  );
}
