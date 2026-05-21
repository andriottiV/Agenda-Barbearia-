"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { logSupabaseError } from "../lib/supabase-debug";
import { supabase } from "../lib/supabase";
import { friendlySupabaseError } from "../lib/supabase-errors";
import {
  currency,
  isInsideBusinessHours,
  makeSlots,
  overlapsLunchBreak,
  overlapsTimeRange,
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
  service_duration_minutes: number | null;
  status: "scheduled" | "confirmed" | "done";
};

type OccupiedRange = {
  startTime: string;
  durationMinutes: number;
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

type PlanUsage = {
  limit_reached: boolean;
  monthly_appointments: number;
  monthly_limit: number | null;
  plan: "free" | "pro" | string;
  remaining: number | null;
};

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

function hasValidPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
}

function formatDateBR(value: string) {
  if (!value) return "Selecione a data";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    weekday: "long",
  }).format(new Date(`${value}T12:00:00`));
}

function getServiceIcon(service: Service) {
  const name = service.name.toLowerCase();

  if (name.includes("barba")) return "B";
  if (name.includes("sobrancelha")) return "S";
  if (name.includes("combo") || name.includes("pacote")) return "C";
  if (name.includes("pigment") || name.includes("luzes")) return "P";

  return "N";
}

function addDaysIso(baseIso: string, days: number) {
  const dateValue = new Date(`${baseIso}T12:00:00`);
  dateValue.setDate(dateValue.getDate() + days);
  return dateValue.toISOString().slice(0, 10);
}

function getDateOptions(selectedDate: string) {
  const today = todayIso();
  const selectedOffset = Math.max(
    0,
    Math.round(
      (new Date(`${selectedDate}T12:00:00`).getTime() -
        new Date(`${today}T12:00:00`).getTime()) /
        86400000,
    ),
  );
  const startOffset = selectedOffset > 6 ? selectedOffset - 2 : 0;

  return Array.from({ length: 7 }, (_, index) =>
    addDaysIso(today, startOffset + index),
  );
}

function shortDateParts(value: string) {
  const dateValue = new Date(`${value}T12:00:00`);

  return {
    weekday: new Intl.DateTimeFormat("pt-BR", { weekday: "short" })
      .format(dateValue)
      .replace(".", ""),
    day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(dateValue),
    month: new Intl.DateTimeFormat("pt-BR", { month: "short" })
      .format(dateValue)
      .replace(".", ""),
  };
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
      <p className="inline-flex rounded-full border border-[#F2B84B]/25 bg-[#F2B84B]/10 px-3 py-1 text-[0.64rem] font-black uppercase tracking-[0.16em] text-[#F2B84B]">
        {step}
      </p>
      <h2 className="text-xl font-semibold leading-tight text-white sm:text-[1.7rem]">
        {title}
      </h2>
      {description ? (
        <p className="max-w-2xl text-sm leading-6 text-[#B9B9B9]">
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
  return (
    <aside className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-2xl sm:p-5 lg:sticky lg:top-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(242,184,75,0.18),transparent_34%),linear-gradient(145deg,rgba(255,255,255,0.07),transparent_44%)]" />

      <div className="relative grid gap-5">
        <div className="flex items-center justify-between gap-3">
          <Image
            src="/logoAB.png"
            alt="HoraAi"
            width={1400}
            height={411}
            priority
            className="h-auto w-32 object-contain"
            sizes="128px"
          />
          {barbershop.phone ? (
            <a
              href={whatsappLink(
                barbershop.phone,
                "Ola, quero falar sobre um agendamento.",
              )}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border border-[#20B15A]/30 bg-[#20B15A]/15 px-3 text-[0.68rem] font-black uppercase tracking-[0.1em] text-[#A8F0C1] transition hover:bg-[#20B15A] hover:text-white"
            >
              Fale conosco
            </a>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <h1 className="premium-text-title break-words text-3xl font-semibold leading-none text-white sm:text-4xl lg:text-[2.55rem]">
              {barbershop.name}
            </h1>
            <p className="mt-3 text-sm font-black uppercase tracking-[0.14em] text-[#F2B84B]">
              Novandri Origine - Arte e beleza
            </p>
            <p className="mt-3 text-sm leading-6 text-[#B9B9B9]">
              Atendimento com hora marcada, ambiente moderno e uma experiencia
              pensada para ser simples do inicio ao fim.
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
          {["Hora marcada", "Profissionais qualificados", "Ambiente exclusivo"].map(
            (item) => (
              <div
                key={item}
                className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs font-bold leading-5 text-white"
              >
                <span className="mb-2 block h-1 w-7 rounded-full bg-[#F2B84B]" />
                {item}
              </div>
            ),
          )}
        </div>

        <div className="grid gap-3">
          <div className="rounded-2xl border border-[#F2B84B]/20 bg-[#F2B84B]/10 p-3">
            <p className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-[#F2B84B]/80">
              Avaliacao
            </p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-2xl font-black text-white">4,9</p>
              <p className="text-sm tracking-[0.12em] text-[#F2B84B]">*****</p>
            </div>
          </div>
          <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/25 p-3">
            <InfoRow
              label="Endereco"
              value={barbershop.address ?? "Endereco nao informado"}
            />
            <InfoRow
              label={weekdays[weekday]}
              value={
                dayHours?.active
                  ? `${dayHours.opens_at.slice(0, 5)} as ${dayHours.closes_at.slice(0, 5)}`
                  : "Fechado nesta data"
              }
            />
            {dayHours?.active && dayHours.lunch_enabled ? (
              <p className="rounded-xl border border-[#F2B84B]/20 bg-[#F2B84B]/10 px-3 py-2 text-xs leading-5 text-[#F5D08B]">
                Pausa: {dayHours.lunch_starts_at?.slice(0, 5)} as{" "}
                {dayHours.lunch_ends_at?.slice(0, 5)}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-white/10 pb-3 last:border-b-0 last:pb-0">
      <span className="text-[0.64rem] font-black uppercase tracking-[0.16em] text-[#F2B84B]/70">
        {label}
      </span>
      <span className="text-sm leading-5 text-white">{value}</span>
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
      className={`group relative flex min-h-[132px] overflow-hidden rounded-[1.25rem] border p-4 text-left shadow-[0_18px_55px_rgba(0,0,0,0.22)] transition duration-200 ${
        selected
          ? "border-[#F2B84B]/80 bg-[#F2B84B]/12 text-white shadow-[0_20px_65px_rgba(242,184,75,0.16)]"
          : "border-white/10 bg-white/[0.04] text-white hover:-translate-y-0.5 hover:border-[#F2B84B]/50 hover:bg-white/[0.07]"
      }`}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      <div className="grid w-full gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="grid h-10 w-10 place-items-center rounded-2xl border border-[#F2B84B]/25 bg-[#F2B84B]/12 text-sm font-black text-[#F2B84B]">
              {getServiceIcon(service)}
            </span>
            <h3 className="mt-3 line-clamp-2 text-base font-semibold leading-snug sm:text-[1.05rem]">
              {service.name}
            </h3>
          </div>
          <span
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[0.62rem] font-black ${
              selected
                ? "border-[#F2B84B] bg-[#F2B84B] text-black"
                : "border-white/15 text-transparent group-hover:border-[#F2B84B]/45"
            }`}
          >
            OK
          </span>
        </div>
        <div className="mt-auto flex items-end justify-between gap-3">
          <p className="text-xl font-black text-[#F2B84B]">
            {currency(Number(service.price))}
          </p>
          <p className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-bold text-[#B9B9B9]">
            {service.duration_minutes} min
          </p>
        </div>
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
      <div className="rounded-[1.35rem] border border-white/10 bg-black/25 p-6 text-left">
        <p className="font-semibold text-white">
          Nenhum horario disponivel para esta data.
        </p>
        <p className="mt-2 text-sm leading-6 text-[#B8B8B8]">
          Tente escolher outro dia ou fale com a barbearia pelo WhatsApp.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
      {slots.map((slot) => (
        <button
          key={slot}
          type="button"
          onClick={() => onSelect(slot)}
          className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-black transition ${
            selectedTime === slot
              ? "border-[#F2B84B] bg-[#F2B84B] text-[#080808] shadow-[0_16px_34px_rgba(242,184,75,0.18)]"
              : "border-white/10 bg-white/[0.04] text-white hover:border-[#F2B84B]/50 hover:bg-white/[0.075]"
          }`}
        >
          {slot}
        </button>
      ))}
    </div>
  );
}

function DateSelector({
  date,
  onSelect,
}: {
  date: string;
  onSelect: (date: string) => void;
}) {
  const options = getDateOptions(date);
  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));

  return (
    <div className="rounded-[1.25rem] border border-white/10 bg-black/25 p-3">
      <p className="mb-3 text-center text-sm font-black uppercase tracking-[0.12em] text-white">
        {monthLabel}
      </p>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7 lg:grid-cols-4 xl:grid-cols-7">
        {options.map((item) => {
          const parts = shortDateParts(item);
          const selected = item === date;

          return (
            <button
              key={item}
              type="button"
              onClick={() => onSelect(item)}
              className={`relative min-h-[72px] rounded-2xl border p-2 text-center transition ${
                selected
                  ? "border-[#F2B84B] bg-[#F2B84B] text-black shadow-[0_16px_34px_rgba(242,184,75,0.18)]"
                  : "border-white/10 bg-white/[0.04] text-white hover:border-[#F2B84B]/45 hover:bg-white/[0.075]"
              }`}
            >
              <span className="block text-[0.6rem] font-black uppercase tracking-[0.1em]">
                {parts.weekday}
              </span>
              <span className="mt-1 block text-xl font-black leading-none">
                {parts.day}
              </span>
              <span
                className={`mx-auto mt-2 block h-1.5 w-1.5 rounded-full ${
                  selected ? "bg-black/65" : "bg-[#F2B84B]"
                }`}
              />
            </button>
          );
        })}
      </div>
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
    <div className="h-full rounded-[1.4rem] border border-[#F2B84B]/22 bg-[#F2B84B]/10 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
      <StepTitle step="Resumo" title="Seu agendamento" />
      <div className="mt-4 grid gap-2.5 text-sm">
        <SummaryItem label="Servico" value={service?.name ?? "Escolha um servico"} />
        <SummaryItem
          label="Duracao"
          value={service ? `${service.duration_minutes} min` : "--"}
        />
        <SummaryItem
          label="Data e horario"
          value={startTime ? `${formatDateBR(date)} as ${startTime}` : formatDateBR(date)}
        />
        <SummaryItem
          label="Cliente"
          value={customerName.trim() || "Informe seu nome"}
        />
        <div className="rounded-2xl border border-[#F2B84B]/25 bg-black/30 p-4">
          <p className="text-[0.66rem] font-black uppercase tracking-[0.16em] text-[#B9B9B9]">
            Total
          </p>
          <p className="mt-1 text-3xl font-black text-[#F2B84B]">
            {service ? currency(Number(service.price)) : "--"}
          </p>
        </div>
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <p className="text-[0.64rem] font-black uppercase tracking-[0.16em] text-[#B9B9B9]">
        {label}
      </p>
      <p className="mt-1 font-semibold leading-5 text-white">{value}</p>
    </div>
  );
}

function TrustFooter({ barbershop }: { barbershop: Barbershop }) {
  return (
    <footer className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {["Confirmacao imediata", "Lembretes automaticos", "Atendimento exclusivo"].map(
          (item) => (
            <div
              key={item}
              className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"
            >
              <span className="mb-2 block h-1 w-7 rounded-full bg-[#F2B84B]" />
              <p className="text-xs font-bold text-white sm:text-sm">{item}</p>
            </div>
          ),
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-white/10 pt-4 text-xs text-[#8F8F8F] sm:flex-row sm:items-center sm:justify-between">
        <p>HoraAi - Agendamento online</p>
        <p>{barbershop.address ?? barbershop.phone ?? barbershop.name}</p>
      </div>
    </footer>
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
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [success, setSuccess] = useState<SuccessDetails>(null);
  const [error, setError] = useState("");
  const [planUsage, setPlanUsage] = useState<PlanUsage | null>(null);

  const service = services.find((item) => item.id === serviceId);
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const dayHours = hours.find((item) => item.weekday === weekday);
  const freeLimitReached = Boolean(planUsage?.limit_reached);
  const canConfirm = Boolean(
    service &&
      date &&
      startTime &&
      customerName.trim().length >= 2 &&
      hasValidPhone(customerPhone) &&
      !freeLimitReached,
  );

  const slots = useMemo(() => {
    if (!service || !dayHours || !dayHours.active) return [];
    const occupiedSlots = bookedSlots.map((item) => item.appointment_time.slice(0, 5));
    const occupiedRanges: OccupiedRange[] = bookedSlots.map((item) => ({
      startTime: item.appointment_time.slice(0, 5),
      durationMinutes: item.service_duration_minutes ?? 30,
    }));

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
      occupiedRanges,
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

  async function loadPlanUsage(barbershopId: string) {
    const { data, error: usageError } = await supabase
      .rpc("get_barbershop_plan_usage", {
        p_barbershop_id: barbershopId,
      })
      .maybeSingle();

    if (usageError) {
      logSupabaseError("[Booking] Erro ao carregar uso do plano", usageError, {
        barbershopId,
      });
      return null;
    }

    return data as PlanUsage | null;
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

      const [servicesRes, hoursRes, usageRes] = await Promise.all([
        loadPublicServices(currentShop.id),
        supabase
          .from("business_hours")
          .select("*")
          .eq("barbershop_id", currentShop.id)
          .eq("active", true)
          .order("weekday"),
        loadPlanUsage(currentShop.id),
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
      setPlanUsage(usageRes);
      setLoading(false);
    }

    loadShop();
  }, [slug]);

  useEffect(() => {
    async function loadAppointments() {
      if (!barbershop) return;
      setSlotsLoading(true);

      const { data, error: slotsError } = await supabase
        .from("booked_slots")
        .select(
          "id, barbershop_id, appointment_date, appointment_time, service_duration_minutes, status",
        )
        .eq("barbershop_id", barbershop.id)
        .eq("appointment_date", date);

      if (slotsError) {
        logSupabaseError("[Booking] Erro ao carregar horarios ocupados", slotsError, {
          barbershopId: barbershop.id,
          date,
        });
        setError(friendlySupabaseError(slotsError));
        setSlotsLoading(false);
        return;
      }

      setBookedSlots((data ?? []) as BookedSlot[]);
      setStartTime("");
      setSlotsLoading(false);
    }

    loadAppointments();
  }, [date, barbershop]);

  async function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (freeLimitReached) {
      setError(
        "A agenda online desta barbearia atingiu o limite mensal gratuito. Fale com a barbearia pelo WhatsApp.",
      );
      return;
    }

    if (!barbershop || !service || !startTime) {
      setError("Escolha servico, data e horario para confirmar.");
      return;
    }

    const trimmedName = customerName.trim();
    const trimmedPhone = customerPhone.trim();
    const trimmedNotes = notes.trim();

    if (trimmedName.length < 2) {
      setError("Informe seu nome para confirmar o horario.");
      return;
    }

    if (!hasValidPhone(trimmedPhone)) {
      setError("Informe um WhatsApp valido com DDD.");
      return;
    }

    if (!dayHours?.active) {
      setError("A barbearia esta fechada nesta data.");
      return;
    }

    if (
      !isInsideBusinessHours(
        startTime,
        service.duration_minutes,
        dayHours.opens_at,
        dayHours.closes_at,
      )
    ) {
      setError("Este horario fica fora do expediente da barbearia.");
      return;
    }

    const conflict = bookedSlots.some((item) =>
      overlapsTimeRange(
        startTime,
        service.duration_minutes,
        item.appointment_time.slice(0, 5),
        item.service_duration_minutes ?? 30,
      ),
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
      setPlanUsage(await loadPlanUsage(barbershop.id));
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
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        await response.text();
      }
    } catch (error) {
      void error;
    }
  }

  async function reloadAppointments(barbershopId: string, selectedDate: string) {
    const { data, error: slotsError } = await supabase
      .from("booked_slots")
      .select(
        "id, barbershop_id, appointment_date, appointment_time, service_duration_minutes, status",
      )
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
    ? [
        "Olá! Acabei de agendar meu horário pelo HoraAi.",
        "",
        `Nome: ${success.customerName}`,
        `Barbearia: ${barbershop.name}`,
        `Serviço: ${success.serviceName}`,
        `Data: ${formatDateBR(success.appointmentDate)}`,
        `Horário: ${success.appointmentTime}`,
        "",
        "Até lá!",
      ].join("\n")
    : "";

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#050505] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(242,184,75,0.13),transparent_28%),radial-gradient(circle_at_88%_16%,rgba(255,255,255,0.06),transparent_24%),linear-gradient(135deg,#050505_0%,#0B0B0B_48%,#111111_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background:linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:42px_42px]" />

      <div className="relative mx-auto grid min-h-screen max-w-[1180px] gap-5 px-3 py-3 sm:px-5 sm:py-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-7">
        <BarberInfoPanel
          barbershop={barbershop}
          dayHours={dayHours}
          weekday={weekday}
        />

        <section className="rounded-[1.6rem] border border-white/10 bg-white/[0.035] p-3 shadow-[0_24px_90px_rgba(0,0,0,0.42)] backdrop-blur-2xl sm:p-5">
          {success ? (
            <div className="flex min-h-full flex-col justify-center gap-4">
              <div className="rounded-[1.75rem] border border-[#F2B84B]/25 bg-black/30 p-6 text-center shadow-[0_26px_80px_rgba(0,0,0,0.28)] sm:p-10">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-[#F2B84B]/45 bg-[#F2B84B] text-sm font-black text-[#080808]">
                  OK
                </div>
                <p className="mt-5 text-[0.68rem] font-black uppercase tracking-[0.24em] text-[#F2B84B]/80">
                  Tudo certo
                </p>
                <h2 className="mt-3 text-3xl font-semibold leading-tight text-white sm:text-4xl">
                  Horario confirmado
                </h2>
                <div className="mx-auto mt-5 grid max-w-md gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-4 text-left">
                  <SummaryItem label="Barbearia" value={barbershop.name} />
                  <SummaryItem label="Cliente" value={success.customerName} />
                  <SummaryItem label="Servico" value={success.serviceName} />
                  <SummaryItem
                    label="Data e horario"
                    value={`${formatDateBR(success.appointmentDate)} as ${success.appointmentTime}`}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {barbershop.phone ? (
                  <a
                    href={whatsappLink(barbershop.phone, successWhatsAppMessage)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-[#20B15A] px-5 py-4 text-sm font-black text-white shadow-[0_18px_45px_rgba(32,177,90,0.22)] transition hover:bg-[#24c463]"
                  >
                    Enviar no WhatsApp
                  </a>
                ) : (
                  <p className="rounded-2xl border border-[#F2B84B]/20 bg-[#F2B84B]/10 p-4 text-sm leading-6 text-[#F2CF91]">
                    A barbearia ainda nao cadastrou um WhatsApp. Seu horario ja foi
                    registrado no painel.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setSuccess(null)}
                  className="inline-flex min-h-14 items-center justify-center rounded-2xl border border-[#F2B84B]/40 bg-[#F2B84B] px-5 py-4 text-sm font-black text-[#080808] shadow-[0_22px_60px_rgba(242,184,75,0.22)] transition hover:bg-[#ffd06b]"
                >
                  Fazer outro agendamento
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={book} className="grid gap-4">
              <div className="rounded-[1.35rem] border border-white/10 bg-black/25 p-4 sm:p-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[#F2B84B]/80">
                  1. Agendamento
                </p>
                <h2 className="premium-text-title mt-2 text-3xl font-semibold leading-none text-white sm:text-5xl">
                  Escolha seu horario
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[#B9B9B9] sm:text-base">
                  Selecione servico, data e horario em uma unica pagina.
                </p>
              </div>

              <section className="grid gap-3 rounded-[1.35rem] border border-white/10 bg-white/[0.025] p-3 sm:p-4">
                <StepTitle step="1. Servico" title="Escolha seu atendimento" />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
                  <div className="rounded-[1.35rem] border border-white/10 bg-black/25 p-6 text-left">
                    <p className="font-semibold text-white">
                      Nenhum servico publicado.
                    </p>
                    <p className="mt-2 text-sm text-[#B8B8B8]">
                      Esta barbearia ainda nao publicou servicos.
                    </p>
                  </div>
                ) : null}
              </section>

              <section className="grid gap-4 rounded-[1.35rem] border border-white/10 bg-white/[0.025] p-3 sm:p-4">
                <StepTitle
                  step="2. Data e horario"
                  title="Quando voce quer vir?"
                  description="Os horarios ocupados somem automaticamente."
                />
                <div className="grid gap-4 lg:grid-cols-[0.45fr_0.55fr]">
                  <div className="grid gap-3">
                    <DateSelector
                      date={date}
                      onSelect={(value) => {
                        setDate(value);
                        setError("");
                      }}
                    />
                    <label className="grid content-start gap-2">
                      <span className="text-[0.66rem] font-black uppercase tracking-[0.16em] text-[#F2B84B]/75">
                        Escolher outra data
                      </span>
                      <input
                        type="date"
                        min={todayIso()}
                        value={date}
                        onChange={(event) => {
                          setDate(event.target.value);
                          setError("");
                        }}
                        className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.045] px-4 text-sm font-semibold text-white outline-none [color-scheme:dark] placeholder:text-[#777] focus:border-[#F2B84B] focus:shadow-[0_0_0_3px_rgba(242,184,75,0.14)]"
                      />
                    </label>
                  </div>
                  <div className="rounded-[1.25rem] border border-white/10 bg-black/25 p-3">
                    <p className="mb-3 text-sm font-black uppercase tracking-[0.12em] text-white">
                      Horarios disponiveis
                    </p>
                    {slotsLoading ? (
                      <div className="rounded-[1.1rem] border border-white/10 bg-white/[0.035] p-5 text-left">
                        <p className="font-semibold text-white">
                          Atualizando horarios...
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[#B9B9B9]">
                          Estamos verificando a agenda desta data.
                        </p>
                      </div>
                    ) : (
                      <TimeSlotGrid
                        slots={slots}
                        selectedTime={startTime}
                        onSelect={(slot) => {
                          setStartTime(slot);
                          setError("");
                        }}
                      />
                    )}
                  </div>
                </div>
              </section>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                <section className="grid gap-4 rounded-[1.35rem] border border-white/10 bg-white/[0.025] p-3 sm:p-4">
                  <StepTitle step="3. Seus dados" title="Como podemos te chamar?" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-[0.66rem] font-black uppercase tracking-[0.16em] text-[#F2B84B]/75">
                        Nome
                      </span>
                      <input
                        name="name"
                        placeholder="Seu nome"
                        required
                        minLength={2}
                        maxLength={80}
                        value={customerName}
                        onChange={(event) => setCustomerName(event.target.value)}
                        className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.045] px-4 text-sm font-semibold text-white outline-none placeholder:text-[#777] focus:border-[#F2B84B] focus:shadow-[0_0_0_3px_rgba(242,184,75,0.14)]"
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-[0.66rem] font-black uppercase tracking-[0.16em] text-[#F2B84B]/75">
                        WhatsApp
                      </span>
                      <input
                        name="phone"
                        placeholder="WhatsApp com DDD"
                        required
                        inputMode="tel"
                        autoComplete="tel"
                        minLength={10}
                        maxLength={20}
                        value={customerPhone}
                        onChange={(event) => setCustomerPhone(event.target.value)}
                        className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.045] px-4 text-sm font-semibold text-white outline-none placeholder:text-[#777] focus:border-[#F2B84B] focus:shadow-[0_0_0_3px_rgba(242,184,75,0.14)]"
                      />
                    </label>
                  </div>
                  <label className="grid gap-2">
                    <span className="text-[0.66rem] font-black uppercase tracking-[0.16em] text-[#F2B84B]/75">
                      Observacoes opcionais
                    </span>
                    <textarea
                      name="notes"
                      placeholder="Algum detalhe para a barbearia?"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      className="min-h-28 resize-y rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-4 text-sm font-semibold text-white outline-none placeholder:text-[#777] focus:border-[#F2B84B] focus:shadow-[0_0_0_3px_rgba(242,184,75,0.14)]"
                    />
                  </label>
                </section>

                <BookingSummary
                  service={service}
                  date={date}
                  startTime={startTime}
                  customerName={customerName}
                />
              </div>

              {error ? (
                <p className="rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100">
                  {error}
                </p>
              ) : null}

              {freeLimitReached ? (
                <p className="rounded-2xl border border-[#F2B84B]/25 bg-[#F2B84B]/10 p-4 text-sm leading-6 text-[#F2CF91]">
                  A agenda online desta barbearia atingiu o limite mensal gratuito.
                  Fale com a barbearia pelo WhatsApp.
                </p>
              ) : null}

              <button
                type="submit"
                disabled={!canConfirm || booking}
                className="inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-[#F2B84B] px-6 py-4 text-base font-black uppercase tracking-[0.08em] text-[#080808] shadow-[0_20px_58px_rgba(242,184,75,0.22)] transition hover:bg-[#ffd06b] disabled:cursor-not-allowed disabled:bg-white/12 disabled:text-[#B9B9B9] disabled:shadow-none"
              >
                {booking
                  ? "Agendando..."
                  : freeLimitReached
                    ? "Limite mensal atingido"
                    : "Confirmar agendamento"}
              </button>

              <TrustFooter barbershop={barbershop} />
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
