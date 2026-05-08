"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { friendlySupabaseError } from "../lib/supabase-errors";
import {
  currency,
  makeSlots,
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

export function BookingApp({ slug }: { slug: string }) {
  const [barbershop, setBarbershop] = useState<Barbershop | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [hours, setHours] = useState<BusinessHour[]>([]);
  const [bookedSlots, setBookedSlots] = useState<BookedSlot[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [startTime, setStartTime] = useState("");
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const service = services.find((item) => item.id === serviceId);
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const dayHours = hours.find((item) => item.weekday === weekday);
  const slots = useMemo(() => {
    if (!service || !dayHours || !dayHours.active) return [];
    const occupiedSlots = bookedSlots
      .map((item) => item.appointment_time.slice(0, 5));

    return makeSlots(
      dayHours.opens_at,
      dayHours.closes_at,
      service.duration_minutes,
      occupiedSlots,
    );
  }, [bookedSlots, dayHours, service]);

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
        supabase
          .from("services")
          .select("*")
          .eq("barbershop_id", currentShop.id)
          .eq("active", true)
          .order("display_order", { ascending: true })
          .order("name", { ascending: true }),
        supabase
          .from("business_hours")
          .select("*")
          .eq("barbershop_id", currentShop.id)
          .eq("active", true)
          .order("weekday"),
      ]);

      const firstError = servicesRes.error ?? hoursRes.error;
      if (firstError) {
        setError(friendlySupabaseError(firstError));
      }

      setServices((servicesRes.data ?? []) as Service[]);
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

    const form = event.currentTarget;
    const formData = new FormData(form);
    const customerName = String(formData.get("name")).trim();
    const customerPhone = String(formData.get("phone")).trim();
    const notes = String(formData.get("notes") ?? "").trim();

    if (!customerName || !customerPhone) {
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

    setBooking(true);
    setError("");

    try {
      const appointmentRes = await supabase.rpc("create_public_appointment", {
        p_barbershop_id: barbershop.id,
        p_service_id: service.id,
        p_appointment_date: date,
        p_appointment_time: startTime,
        p_customer_name: customerName,
        p_customer_phone: customerPhone,
        p_notes: notes,
      });

      if (appointmentRes.error) {
        setError(friendlySupabaseError(appointmentRes.error));
        return;
      }

      setSuccess(
        `Agendamento recebido para ${date} as ${startTime}. A barbearia ja consegue ver no painel.`,
      );
      form.reset();
      setServiceId("");
      setStartTime("");
      await reloadAppointments(barbershop.id, date);
      notifyNewAppointment({
        customerName,
        customerPhone,
        serviceName: service.name,
        appointmentDate: date,
        appointmentTime: startTime,
        barbershopName: barbershop.name,
      });
    } finally {
      setBooking(false);
    }
  }

  async function notifyNewAppointment(payload: {
    customerName: string;
    customerPhone: string;
    serviceName: string;
    appointmentDate: string;
    appointmentTime: string;
    barbershopName: string;
  }) {
    try {
      const response = await fetch("/api/notifications/new-appointment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error("[Notifications] Falha ao enviar e-mail", {
          status: response.status,
          body: await response.text(),
        });
      }
    } catch (error) {
      console.error("[Notifications] Falha ao chamar API de e-mail", error);
    }
  }

  async function reloadAppointments(barbershopId: string, selectedDate: string) {
    const { data } = await supabase
      .from("booked_slots")
      .select("id, barbershop_id, appointment_date, appointment_time, status")
      .eq("barbershop_id", barbershopId)
      .eq("appointment_date", selectedDate);
    setBookedSlots((data ?? []) as BookedSlot[]);
  }

  if (loading) {
    return <main className="min-h-screen bg-stone-50 p-8">Carregando...</main>;
  }

  if (!barbershop) {
    return (
      <main className="grid min-h-screen place-items-center bg-stone-50 p-8 text-center">
        <div>
          <h1 className="text-3xl font-bold">Barbearia nao encontrada</h1>
          <p className="mt-2 text-slate-600">Confira o link de agendamento.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 text-slate-950">
      <section className="mx-auto grid max-w-5xl gap-8 px-6 py-8 lg:grid-cols-[0.8fr_1.2fr]">
        <aside className="grid content-start gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Agendamento online
            </p>
            <h1 className="mt-3 text-4xl font-bold">{barbershop.name}</h1>
            {barbershop.address ? (
              <p className="mt-2 text-slate-600">{barbershop.address}</p>
            ) : null}
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-500">
              Funcionamento no dia
            </p>
            <p className="mt-1 font-bold">
              {dayHours && dayHours.active
                ? `${dayHours.opens_at.slice(0, 5)} as ${dayHours.closes_at.slice(0, 5)}`
                : "Fechado"}
            </p>
            <p className="mt-1 text-sm text-slate-600">{weekdays[weekday]}</p>
          </div>
          {barbershop.phone ? (
            <a
              href={whatsappLink(barbershop.phone, "Ola, quero falar sobre um agendamento.")}
              target="_blank"
              className="small-button text-center"
            >
              Falar no WhatsApp
            </a>
          ) : null}
        </aside>

        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
          {success ? (
            <div className="grid gap-4">
              <h2 className="text-2xl font-bold">Horario solicitado</h2>
              <p className="text-slate-600">{success}</p>
              <button
                type="button"
                onClick={() => setSuccess("")}
                className="primary-button"
              >
                Fazer outro agendamento
              </button>
            </div>
          ) : (
            <form onSubmit={book} className="grid gap-5">
              <div>
                <h2 className="text-2xl font-bold">Escolha seu horario</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Sem cadastro. Horarios ocupados somem automaticamente.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {services.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setServiceId(item.id);
                      setStartTime("");
                    }}
                    className={`rounded-md border p-4 text-left ${
                      serviceId === item.id
                        ? "border-emerald-700 bg-emerald-50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <strong>{item.name}</strong>
                    <span className="mt-1 block text-sm text-slate-600">
                      {currency(Number(item.price))} - {item.duration_minutes} min
                    </span>
                  </button>
                ))}
              </div>
              {!services.length ? (
                <p className="text-sm text-slate-600">
                  Esta barbearia ainda nao publicou servicos.
                </p>
              ) : null}

              <input
                type="date"
                min={todayIso()}
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="field max-w-56"
              />

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {slots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setStartTime(slot)}
                    className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                      startTime === slot
                        ? "border-emerald-700 bg-emerald-700 text-white"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    {slot}
                  </button>
                ))}
              </div>
              {service && !slots.length ? (
                <p className="text-sm text-slate-600">
                  Nao ha horarios disponiveis para esta data.
                </p>
              ) : null}

              <div className="grid gap-3">
                <input name="name" placeholder="Seu nome" required className="field" />
                <input
                  name="phone"
                  placeholder="WhatsApp com DDD"
                  required
                  className="field"
                />
                <textarea
                  name="notes"
                  placeholder="Observacoes"
                  className="field min-h-20 py-3"
                />
              </div>
              {error ? <p className="text-sm text-red-700">{error}</p> : null}
              <button
                disabled={!service || !startTime || booking}
                className="primary-button"
              >
                {booking ? "Agendando..." : "Solicitar horario"}
              </button>
            </form>
          )}
        </section>
      </section>
    </main>
  );
}
