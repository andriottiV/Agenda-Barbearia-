import {
  createServerSupabaseAdminClient,
  getServerSupabaseDiagnostics,
} from "../../../../lib/supabase-server";
import { sendPushToUser } from "../../../../lib/web-push-server";

export const runtime = "nodejs";

type ReminderAppointmentRow = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  barbershop_id: string;
  barbershops:
    | {
        name: string | null;
        owner_id: string | null;
      }
    | Array<{
        name: string | null;
        owner_id: string | null;
      }>
    | null;
  clients:
    | {
        name: string | null;
      }
    | Array<{
        name: string | null;
      }>
    | null;
  services:
    | {
        name: string | null;
      }
    | Array<{
        name: string | null;
      }>
    | null;
};

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

function cleanEnvValue(value: string | undefined) {
  return value?.trim().replace(/^["']|["']$/g, "");
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function authorizationSecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const [type, token] = authorization.split(" ");

  if (type.toLowerCase() === "bearer" && token) {
    return token.trim();
  }

  return request.headers.get("x-cron-secret")?.trim() ?? "";
}

function zonedParts(date: Date, timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    key: `${part("year")}${part("month")}${part("day")}${part("hour")}${part(
      "minute",
    )}`,
  };
}

function appointmentWindowKey(appointment: ReminderAppointmentRow) {
  return `${appointment.appointment_date.replaceAll("-", "")}${appointment.appointment_time
    .slice(0, 5)
    .replace(":", "")}`;
}

export async function GET(request: Request) {
  const cronSecret = cleanEnvValue(process.env.CRON_SECRET);
  const requestSecret = authorizationSecret(request);

  if (!cronSecret || requestSecret !== cronSecret) {
    return Response.json(
      { success: false, error: "CRON_SECRET invalido ou ausente." },
      { status: 401 },
    );
  }

  const adminSupabase = createServerSupabaseAdminClient();

  if (!adminSupabase) {
    return Response.json(
      {
        success: false,
        error: "SUPABASE_SERVICE_ROLE_KEY ausente.",
        diagnostics: {
          supabase: getServerSupabaseDiagnostics(),
        },
      },
      { status: 500 },
    );
  }

  const now = new Date();
  const windowStart = zonedParts(now);
  const windowEnd = zonedParts(new Date(now.getTime() + 60 * 60 * 1000));

  const { data, error } = await adminSupabase
    .from("appointments")
    .select(
      [
        "id",
        "barbershop_id",
        "appointment_date",
        "appointment_time",
        "status",
        "reminder_sent_at",
        "barbershops(name, owner_id)",
        "clients(name)",
        "services(name)",
      ].join(", "),
    )
    .is("reminder_sent_at", null)
    .neq("status", "cancelled")
    .gte("appointment_date", windowStart.date)
    .lte("appointment_date", windowEnd.date)
    .order("appointment_date", { ascending: true })
    .order("appointment_time", { ascending: true })
    .limit(100);

  if (error) {
    console.error("[Reminders] Erro ao buscar agendamentos", error);
    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }

  const appointments = ((data ?? []) as unknown as ReminderAppointmentRow[]).filter(
    (appointment) => {
      const key = appointmentWindowKey(appointment);
      return key >= windowStart.key && key <= windowEnd.key;
    },
  );

  const results = [];

  for (const appointment of appointments) {
    const barbershop = firstRelation(appointment.barbershops);
    const client = firstRelation(appointment.clients);
    const service = firstRelation(appointment.services);
    const ownerUserId = barbershop?.owner_id ?? "";
    const clientName = client?.name ?? "Cliente";
    const serviceName = service?.name ?? "servico";
    const appointmentTime = appointment.appointment_time.slice(0, 5);

    if (!ownerUserId) {
      console.error("[Reminders] Agendamento sem dono de barbearia", {
        appointmentId: appointment.id,
        barbershopId: appointment.barbershop_id,
      });
      results.push({
        appointmentId: appointment.id,
        ok: false,
        error: "owner_id ausente",
      });
      continue;
    }

    const message = `${clientName} tem ${serviceName} hoje às ${appointmentTime}.`;
    const pushResult = await sendPushToUser({
      supabase: adminSupabase,
      userId: ownerUserId,
      payload: {
        title: "Lembrete de agendamento",
        body: message,
        link: "/dashboard",
        data: {
          appointmentId: appointment.id,
          barbershopId: appointment.barbershop_id,
          body: message,
          title: "Lembrete de agendamento",
          type: "appointment_reminder",
          url: "/dashboard",
        },
      },
    });

    if (!pushResult.ok) {
      console.warn("[Reminders] Push de lembrete nao enviado", {
        appointmentId: appointment.id,
        ownerUserId,
        pushResult,
      });
      results.push({
        appointmentId: appointment.id,
        marked: false,
        push: pushResult,
        updateError: null,
      });
      continue;
    }

    const { data: updated, error: updateError } = await adminSupabase
      .from("appointments")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", appointment.id)
      .is("reminder_sent_at", null)
      .select("id, reminder_sent_at")
      .maybeSingle();

    if (updateError) {
      console.error("[Reminders] Erro ao marcar reminder_sent_at", {
        appointmentId: appointment.id,
        error: updateError,
      });
    }

    results.push({
      appointmentId: appointment.id,
      marked: Boolean(updated),
      push: pushResult,
      updateError: updateError?.message ?? null,
    });
  }

  return Response.json({
    success: true,
    checked: appointments.length,
    window: {
      end: windowEnd.date,
      endKey: windowEnd.key,
      start: windowStart.date,
      startKey: windowStart.key,
      timeZone: DEFAULT_TIMEZONE,
    },
    results,
  });
}

export const POST = GET;
