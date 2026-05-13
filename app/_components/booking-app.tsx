"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { logSupabaseError } from "../lib/supabase-debug";
import { supabase } from "../lib/supabase";
import { friendlySupabaseError } from "../lib/supabase-errors";
import {
  currency,
  makeSlots,
  overlapsLunchBreak,
  todayIso,
  whatsappLink,
  weekdays,
} from "../lib/schedule";
import type { Barbershop, BusinessHour, Service } from "../types";

type BookedSlot = {
  id: string;
  barbershop_id: string;
  appointment_date: string;
  appointment_time: string;
  status: "scheduled" | "confirmed" | "done";
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type SuccessDetails = {
  customerName: string;
  serviceName: string;
  appointmentDate: string;
  appointmentTime: string;
} | null;

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

function formatDateBR(value: string) {
  if (!value) return "Selecione a data";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    weekday: "long",
  }).format(new Date(`${value}T12:00:00`));
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function getServiceCategory(service: Service) {
  return (
    (service as Service & { category?: string | null }).category?.trim() ||
    "Servico"
  );
}

function StepTitle({
  step,
  title,
  description,
}: {
  step: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[#D6B07A]/80">
        {step}
      </p>
      <h2 className="text-xl font-semibold text-[#F5F1EB] sm:text-2xl">
        {title}
      </h2>
      {description ? (
        <p className="max-w-2xl text-sm leading-6 text-[#B8AEA3] sm:text-base">
          {description}
        </p>
      ) : null}
    </div>
  );
}

function BarberInfoPanel({
  barbershop,
  dayHours,
  weekday,
}: {
  barbershop: Barbershop;
  dayHours?: BusinessHour;
  weekday: number;
}) {
  const initials = getInitials(barbershop.name) || "HA";

  return (
    <aside className="premium-card relative overflow-hidden p-5 sm:p-7 lg:sticky lg:top-6 lg:min-h-[calc(100vh-3rem)] lg:p-9">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_8%,rgba(214,176,122,0.2),transparent_28%),linear-gradient(155deg,rgba(255,255,255,0.065),transparent_36%),linear-gradient(180deg,rgba(8,8,8,0.1),rgba(8,8,8,0.74))]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 opacity-30 [background:repeating-linear-gradient(120deg,rgba(214,176,122,0.18)_0,rgba(214,176,122,0.18)_1px,transparent_1px,transparent_16px)]" />

      <div className="relative flex min-h-full flex-col justify-between gap-8">
        <div className="space-y-6">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-[#D6B07A]/45 bg-black/45 text-xl font-black tracking-[0.08em] text-[#D6B07A] shadow-[0_18px_50px_rgba(214,176,122,0.14)]">
            {initials}
          </div>

          <div className="space-y-4">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#D6B07A]/80">
              Agendamento online
            </p>
            <h1 className="premium-text-title max-w-xl text-4xl font-semibold leading-[0.98] text-[#F5F1EB] sm:text-5xl lg:text-6xl">
              {barbershop.name}
            </h1>
            <p className="max-w-md text-base leading-7 text-[#CFC6BA] sm:text-lg">
              Agende seu horario de forma rapida e pratica.
            </p>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-[#D6B07A]/22 bg-[rgba(12,12,12,0.76)] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl">
          <InfoRow label="Endereco" value={barbershop.address ?? "Endereco nao informado"} />
          <InfoRow label="Instagram / contato" value={barbershop.phone ?? "Contato nao informado"} />
          <InfoRow
            label={`Horario - ${weekdays[weekday]}`}
            value={
              dayHours?.active
                ? `${dayHours.opens_at.slice(0, 5)} as ${dayHours.closes_at.slice(0, 5)}`
                : "Fechado nesta data"
            }
          />
          {dayHours?.active && dayHours.lunch_enabled ? (
            <p className="rounded-xl border border-[#D6B07A]/20 bg-[#D6B07A]/10 px-4 py-3 text-sm text-[#E0C08D]">
              Pausa: {dayHours.lunch_starts_at?.slice(0, 5)} as{" "}
              {dayHours.lunch_ends_at?.slice(0, 5)}
            </p>
          ) : null}
          {barbershop.phone ? (
            <a
              href={whatsappLink(
                barbershop.phone,
                "Ola, quero falar sobre um agendamento.",
              )}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#20B15A] px-5 py-3 text-sm font-bold text-white shadow-[0_18px_45px_rgba(32,177,90,0.24)] transition hover:bg-[#24c463]"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-white" />
              Agendar pelo WhatsApp
            </a>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-white/10 pb-4 last:border-b-0 last:pb-0">
      <span className="text-[0.68rem] font-bold uppercase tracking-[0.2em] text-[#D6B07A]/70">
        {label}
      </span>
      <span className="text-sm leading-6 text-[#F5F1EB]">{value}</span>
    </div>
  );
}

function PublicServiceCard({
  service,
  selected,
  onSelect,
}: {
  service: Service;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group min-h-40 rounded-2xl border p-5 text-left shadow-[0_20px_60px_rgba(0,0,0,0.22)] transition duration-200 ${
        selected
          ? "border-[#D6B07A] bg-[rgba(214,176,122,0.12)] text-[#F5F1EB] shadow-[0_22px_70px_rgba(214,176,122,0.18)]"
          : "border-[#D6B07A]/18 bg-[rgba(18,18,18,0.84)] text-[#F5F1EB] hover:-translate-y-0.5 hover:border-[#D6B07A]/50 hover:bg-white/[0.06]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <span className="inline-flex rounded-full border border-[#D6B07A]/25 px-3 py-1 text-[0.64rem] font-bold uppercase tracking-[0.18em] text-[#D6B07A]/80">
            {getServiceCategory(service)}
          </span>
          <h3 className="text-lg font-semibold leading-snug sm:text-xl">
            {service.name}
          </h3>
        </div>
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm font-black ${
            selected
              ? "border-[#D6B07A] bg-[#D6B07A] text-black"
              : "border-white/15 text-transparent group-hover:border-[#D6B07A]/45"
          }`}
        >
          ✓
        </span>
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <p className="text-2xl font-bold text-[#D6B07A]">
          {currency(Number(service.price))}
        </p>
        <p className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-sm font-semibold text-[#B8AEA3]">
          {service.duration_minutes} min
        </p>
      </div>
    </button>
  );
}

function TimeSlotGrid({
  slots,
  selectedTime,
  onSelect,
}: {
  slots: string[];
  selectedTime: string;
  onSelect: (slot: string) => void;
}) {
  if (!slots.length) {
    return (
      <div className="premium-empty-state py-7 text-left">
        <p className="font-semibold text-[#F5F1EB]">
          Nenhum horario disponivel para esta data.
        </p>
        <p className="mt-2 text-sm leading-6 text-[#B8AEA3]">
          Tente escolher outro dia ou fale com a barbearia pelo WhatsApp.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {slots.map((slot) => (
        <button
          key={slot}
          type="button"
          onClick={() => onSelect(slot)}
          className={`min-h-14 rounded-2xl border px-3 py-3 text-base font-bold transition ${
            selectedTime === slot
              ? "border-[#D6B07A] bg-[#D6B07A] text-[#080808] shadow-[0_16px_36px_rgba(214,176,122,0.2)]"
              : "border-[#D6B07A]/18 bg-[rgba(12,12,12,0.84)] text-[#F5F1EB] hover:border-[#D6B07A]/50 hover:bg-white/[0.06]"
          }`}
        >
          {slot}
        </button>
      ))}
    </div>
  );
}

function BookingSummary({
  service,
  date,
  startTime,
  customerName,
}: {
  service?: Service;
  date: string;
  startTime: string;
  customerName: string;
}) {
  return (
    <div className="rounded-2xl border border-[#D6B07A]/25 bg-[rgba(214,176,122,0.08)] p-5">
      <StepTitle step="Resumo" title="Confira antes de confirmar" />
      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <SummaryItem label="Servico" value={service?.name ?? "Escolha um servico"} />
        <SummaryItem
          label="Duracao"
          value={service ? `${service.duration_minutes} min` : "--"}
        />
        <SummaryItem label="Preco" value={service ? currency(Number(service.price)) : "--"} />
        <SummaryItem
          label="Data e horario"
          value={startTime ? `${formatDateBR(date)} as ${startTime}` : formatDateBR(date)}
        />
        <SummaryItem
          label="Cliente"
          value={customerName.trim() || "Informe seu nome"}
        />
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[#B8AEA3]">
        {label}
      </p>
      <p className="mt-1 font-semibold text-[#F5F1EB]">{value}</p>
    </div>
  );
}

export function BookingApp({ slug }: { slug: string }) {
  const [barbershop, setBarbershop] = useState<Barbershop | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [hours, setHours] = useState<BusinessHour[]>([]);
  const [bookedSlots, setBookedSlots] = useState<BookedSlot[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [startTime, setStartTime] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [success, setSuccess] = useState<SuccessDetails>(null);
  const [error, setError] = useState("");

  const service = services.find((item) => item.id === serviceId);
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const dayHours = hours.find((item) => item.weekday === weekday);
  const canConfirm = Boolean(
    service && date && startTime && customerName.trim() && customerPhone.trim(),
  );

  const slots = useMemo(() => {
    if (!service || !dayHours || !dayHours.active) return [];
    const occupiedSlots = bookedSlots.map((item) => item.appointment_time.slice(0, 5));

    return makeSlots(
      dayHours.opens_at,
      dayHours.closes_at,
      service.duration_minutes,
      occupiedSlots,
      {
        enabled: dayHours.lunch_enabled,
        startsAt: dayHours.lunch_starts_at,
        endsAt: dayHours.lunch_ends_at,
      },
    );
  }, [bookedSlots, dayHours, service]);

  async function loadPublicServices(barbershopId: string) {
    const orderedRes = await supabase
      .from("services")
      .select("*")
      .eq("barbershop_id", barbershopId)
      .eq("active", true)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (!orderedRes.error) {
      return orderedRes;
    }

    if (!isMissingDisplayOrderError(orderedRes.error)) {
      return orderedRes;
    }

    logSupabaseError(
      "[Booking] Coluna services.display_order ausente, usando fallback",
      orderedRes.error,
      { barbershopId },
    );

    const fallbackRes = await supabase
      .from("services")
      .select("*")
      .eq("barbershop_id", barbershopId)
      .eq("active", true)
      .order("created_at", { ascending: true });

    if (fallbackRes.error) {
      logSupabaseError(
        "[Booking] Erro ao carregar servicos publicos no fallback",
        fallbackRes.error,
        { barbershopId },
      );
    }

    return fallbackRes;
  }

  useEffect(() => {
    async function loadShop() {
      setLoading(true);
      setError("");

      const { data: shop, error: shopError } = await supabase
        .from("barbershops")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();

      if (shopError) {
        logSupabaseError("[Booking] Erro ao carregar barbearia publica", shopError, {
          slug,
        });
        setError(friendlySupabaseError(shopError));
        setLoading(false);
        return;
      }

      if (!shop) {
        setLoading(false);
        return;
      }

      const currentShop = shop as Barbershop;
      setBarbershop(currentShop);

      const [servicesRes, hoursRes] = await Promise.all([
        loadPublicServices(currentShop.id),
        supabase
          .from("business_hours")
          .select("*")
          .eq("barbershop_id", currentShop.id)
          .eq("active", true)
          .order("weekday"),
      ]);

      const firstError = servicesRes.error ?? hoursRes.error;
      if (firstError) {
        logSupabaseError("[Booking] Erro ao carregar dados publicos", firstError, {
          servicesError: servicesRes.error,
          hoursError: hoursRes.error,
          slug,
        });
        setError(friendlySupabaseError(firstError));
      }

      setServices(normalizeServices(servicesRes.data as Service[] | null));
      setHours((hoursRes.data ?? []) as BusinessHour[]);
      setLoading(false);
    }

    loadShop();
  }, [slug]);

  useEffect(() => {
    async function loadAppointments() {
      if (!barbershop) return;

      const { data, error: slotsError } = await supabase
        .from("booked_slots")
        .select("id, barbershop_id, appointment_date, appointment_time, status")
        .eq("barbershop_id", barbershop.id)
        .eq("appointment_date", date);

      if (slotsError) {
        logSupabaseError("[Booking] Erro ao carregar horarios ocupados", slotsError, {
          barbershopId: barbershop.id,
          date,
        });
        setError(friendlySupabaseError(slotsError));
        return;
      }

      setBookedSlots((data ?? []) as BookedSlot[]);
      setStartTime("");
    }

    loadAppointments();
  }, [date, barbershop]);

  async function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!barbershop || !service || !startTime) return;

    const trimmedName = customerName.trim();
    const trimmedPhone = customerPhone.trim();
    const trimmedNotes = notes.trim();

    if (!trimmedName || !trimmedPhone) {
      setError("Informe nome e telefone para confirmar o horario.");
      return;
    }

    const conflict = bookedSlots.some(
      (item) => item.appointment_time.slice(0, 5) === startTime,
    );

    if (conflict) {
      setError("Este horario acabou de ser ocupado. Escolha outro.");
      return;
    }

    if (
      dayHours &&
      overlapsLunchBreak(startTime, service.duration_minutes, {
        enabled: dayHours.lunch_enabled,
        startsAt: dayHours.lunch_starts_at,
        endsAt: dayHours.lunch_ends_at,
      })
    ) {
      setError("Este horario fica dentro da pausa para almoco.");
      return;
    }

    setBooking(true);
    setError("");

    try {
      const appointmentRes = await supabase.rpc("create_public_appointment", {
        p_barbershop_id: barbershop.id,
        p_service_id: service.id,
        p_appointment_date: date,
        p_appointment_time: startTime,
        p_customer_name: trimmedName,
        p_customer_phone: trimmedPhone,
        p_notes: trimmedNotes,
      });

      if (appointmentRes.error) {
        logSupabaseError(
          "[Booking] Erro ao criar agendamento publico",
          appointmentRes.error,
          {
            barbershopId: barbershop.id,
            serviceId: service.id,
            date,
            startTime,
          },
        );
        setError(friendlySupabaseError(appointmentRes.error));
        return;
      }

      const confirmedSlot = startTime;
      const appointmentId =
        typeof appointmentRes.data === "string" ? appointmentRes.data : "";
      setSuccess({
        customerName: trimmedName,
        serviceName: service.name,
        appointmentDate: date,
        appointmentTime: confirmedSlot,
      });
      setCustomerName("");
      setCustomerPhone("");
      setNotes("");
      setServiceId("");
      setStartTime("");
      await reloadAppointments(barbershop.id, date);
      notifyNewAppointment({
        barbershopId: barbershop.id,
        barbershopSlug: barbershop.slug,
        appointmentId,
        customerName: trimmedName,
        customerPhone: trimmedPhone,
        serviceName: service.name,
        servicePrice: Number(service.price),
        serviceDurationMinutes: service.duration_minutes,
        appointmentDate: date,
        appointmentTime: confirmedSlot,
        notes: trimmedNotes,
        barbershopName: barbershop.name,
      });
    } finally {
      setBooking(false);
    }
  }

  async function notifyNewAppointment(payload: {
    barbershopId: string;
    barbershopSlug: string;
    appointmentId: string;
    customerName: string;
    customerPhone: string;
    serviceName: string;
    servicePrice: number;
    serviceDurationMinutes: number;
    appointmentDate: string;
    appointmentTime: string;
    notes: string;
    barbershopName: string;
  }) {
    try {
      console.log("[Notifications] Enviando notificação", payload);
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      console.log("[Notifications] Resposta", response.status);

      if (!response.ok) {
        console.error("[Notifications] Falha ao processar notificacao", {
          status: response.status,
          body: await response.text(),
        });
      }
    } catch (error) {
      console.error("[Notifications] Falha ao chamar API de notificacao", error);
    }
  }

  async function reloadAppointments(barbershopId: string, selectedDate: string) {
    const { data, error: slotsError } = await supabase
      .from("booked_slots")
      .select("id, barbershop_id, appointment_date, appointment_time, status")
      .eq("barbershop_id", barbershopId)
      .eq("appointment_date", selectedDate);

    if (slotsError) {
      logSupabaseError("[Booking] Erro ao recarregar horarios ocupados", slotsError, {
        barbershopId,
        selectedDate,
      });
      return;
    }

    setBookedSlots((data ?? []) as BookedSlot[]);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080808] px-6 text-[#F5F1EB]">
        <div className="premium-card px-8 py-10 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-[#D6B07A]/75">
            Carregando
          </p>
          <h1 className="mt-3 text-3xl font-semibold">Aguarde um momento</h1>
        </div>
      </main>
    );
  }

  if (!barbershop) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080808] px-6 py-10 text-[#F5F1EB]">
        <div className="premium-card max-w-lg p-8 text-center sm:p-10">
          <p className="text-sm uppercase tracking-[0.3em] text-[#D6B07A]/75">
            Link invalido
          </p>
          <h1 className="mt-4 text-3xl font-semibold">Barbearia nao encontrada</h1>
          <p className="mt-3 text-sm leading-6 text-[#B8AEA3]">
            Verifique o link de agendamento ou entre em contato com a barbearia
            para obter suporte.
          </p>
        </div>
      </main>
    );
  }

  const successWhatsAppMessage = success
    ? `Ola, sou ${success.customerName}. Acabei de confirmar ${success.serviceName} para ${success.appointmentDate} as ${success.appointmentTime}.`
    : "";

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#080808] text-[#F5F1EB]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(214,176,122,0.18),transparent_28%),radial-gradient(circle_at_92%_20%,rgba(255,255,255,0.08),transparent_22%),linear-gradient(135deg,#080808_0%,#101010_48%,#161616_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.16] [background:linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:42px_42px]" />

      <div className="relative mx-auto grid min-h-screen max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[0.82fr_1.18fr] lg:px-8 lg:py-6">
        <BarberInfoPanel
          barbershop={barbershop}
          dayHours={dayHours}
          weekday={weekday}
        />

        <section className="premium-card p-5 sm:p-7 lg:p-8">
          {success ? (
            <div className="flex min-h-full flex-col justify-center gap-5">
              <div className="rounded-3xl border border-[#D6B07A]/25 bg-black/30 p-6 text-center shadow-[0_26px_80px_rgba(0,0,0,0.28)] sm:p-10">
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.28em] text-[#D6B07A]/75">
                  Tudo certo
                </p>
                <h2 className="mt-4 text-3xl font-semibold text-[#F5F1EB] sm:text-4xl">
                  Agendamento confirmado!
                </h2>
                <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-[#B8AEA3]">
                  {success.serviceName} em {formatDateBR(success.appointmentDate)} as{" "}
                  {success.appointmentTime}. A barbearia ja consegue ver seu horario no painel.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {barbershop.phone ? (
                  <a
                    href={whatsappLink(barbershop.phone, successWhatsAppMessage)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-[#20B15A] px-5 py-4 text-sm font-bold text-white shadow-[0_18px_45px_rgba(32,177,90,0.22)] transition hover:bg-[#24c463]"
                  >
                    Abrir WhatsApp
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSuccess(null)}
                  className="inline-flex min-h-14 items-center justify-center rounded-2xl border border-[#D6B07A]/40 bg-[#D6B07A] px-5 py-4 text-sm font-black text-[#080808] shadow-[0_22px_60px_rgba(214,176,122,0.22)] transition hover:bg-[#e4caa5]"
                >
                  Fazer outro agendamento
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={book} className="grid gap-8">
              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#D6B07A]/75">
                  Agendamento
                </p>
                <h2 className="premium-text-title text-4xl font-semibold leading-none text-[#F5F1EB] sm:text-5xl">
                  Escolha seu horario
                </h2>
                <p className="max-w-2xl text-base leading-7 text-[#B8AEA3]">
                  Selecione o servico, escolha uma data e confirme seu agendamento.
                </p>
              </div>

              <section className="grid gap-3">
                <StepTitle step="1. Escolha o servico" title="Servicos disponiveis" />
                <div className="grid gap-3 sm:grid-cols-2">
                  {services.map((item) => (
                    <PublicServiceCard
                      key={item.id}
                      service={item}
                      selected={serviceId === item.id}
                      onSelect={() => {
                        setServiceId(item.id);
                        setStartTime("");
                        setError("");
                      }}
                    />
                  ))}
                </div>
                {!services.length ? (
                  <div className="premium-empty-state text-left">
                    <p className="font-semibold text-[#F5F1EB]">
                      Nenhum servico publicado.
                    </p>
                    <p className="mt-2 text-sm text-[#B8AEA3]">
                    Esta barbearia ainda nao publicou servicos.
                    </p>
                  </div>
                ) : null}
              </section>

              <section className="grid gap-5">
                <StepTitle
                  step="2. Escolha a data"
                  title="Data do atendimento"
                  description="Os horarios ocupados somem automaticamente."
                />
                <label className="grid content-start gap-2">
                  <span className="premium-label">Data</span>
                  <span className="rounded-2xl border border-[#D6B07A]/18 bg-white/[0.04] p-4 text-sm font-medium leading-5 text-[#B8AEA3]">
                    {formatDateBR(date)}
                  </span>
                  <input
                    type="date"
                    min={todayIso()}
                    value={date}
                    onChange={(event) => {
                      setDate(event.target.value);
                      setError("");
                    }}
                    className="premium-control [color-scheme:dark]"
                  />
                </label>
              </section>

              <section className="grid gap-4">
                <StepTitle step="3. Escolha o horario" title="Horarios disponiveis" />
                <TimeSlotGrid
                  slots={slots}
                  selectedTime={startTime}
                  onSelect={(slot) => {
                    setStartTime(slot);
                    setError("");
                  }}
                />
              </section>

              <section className="grid gap-4">
                <StepTitle step="4. Seus dados" title="Como podemos te chamar?" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="premium-label">Nome</span>
                    <input
                      name="name"
                      placeholder="Seu nome"
                      required
                      value={customerName}
                      onChange={(event) => setCustomerName(event.target.value)}
                      className="premium-control"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="premium-label">WhatsApp</span>
                    <input
                      name="phone"
                      placeholder="WhatsApp com DDD"
                      required
                      value={customerPhone}
                      onChange={(event) => setCustomerPhone(event.target.value)}
                      className="premium-control"
                    />
                  </label>
                </div>
                <label className="grid gap-2">
                  <span className="premium-label">Observacoes opcionais</span>
                  <textarea
                    name="notes"
                    placeholder="Algum detalhe para a barbearia?"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="premium-control min-h-28 resize-y py-4"
                  />
                </label>
              </section>

              <BookingSummary
                service={service}
                date={date}
                startTime={startTime}
                customerName={customerName}
              />

              {error ? (
                <p className="rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={!canConfirm || booking}
                className="inline-flex min-h-16 w-full items-center justify-center rounded-2xl bg-[#D6B07A] px-6 py-4 text-base font-black text-[#080808] shadow-[0_22px_65px_rgba(214,176,122,0.24)] transition hover:bg-[#e4caa5] disabled:cursor-not-allowed disabled:bg-white/12 disabled:text-[#B8AEA3] disabled:shadow-none"
              >
                {booking ? "Agendando..." : "Confirmar agendamento"}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
