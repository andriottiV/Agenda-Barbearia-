import { requireAdmin } from "../../../../lib/admin-auth";

export const runtime = "nodejs";

type ShopRow = {
  address: string | null;
  created_at: string;
  id: string;
  name: string;
  owner_id: string;
  phone: string | null;
  slug: string;
};

type AppointmentRow = {
  appointment_date: string;
  appointment_time: string;
  created_at: string;
  id: string;
  status: string;
  clients?: { name: string | null } | Array<{ name: string | null }> | null;
  services?: { name: string | null } | Array<{ name: string | null }> | null;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);

  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;

  if (!id) {
    return Response.json(
      { success: false, error: "Usuario ausente." },
      { status: 400 },
    );
  }

  try {
    const { data: userData, error: userError } =
      await auth.adminSupabase.auth.admin.getUserById(id);

    if (userError || !userData.user) {
      return Response.json(
        { success: false, error: userError?.message ?? "Usuario nao encontrado." },
        { status: userError ? 500 : 404 },
      );
    }

    const { data: shopData, error: shopError } = await auth.adminSupabase
      .from("barbershops")
      .select("id, owner_id, name, slug, phone, address, created_at")
      .eq("owner_id", id)
      .maybeSingle();

    if (shopError) {
      return Response.json(
        { success: false, error: shopError.message },
        { status: 500 },
      );
    }

    const shop = shopData as ShopRow | null;

    if (!shop) {
      const { count: pushCount } = await auth.adminSupabase
        .from("push_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", id);

      return Response.json({
        success: true,
        detail: {
          appointmentsCount: 0,
          businessHours: [],
          lastAppointments: [],
          publicUrl: null,
          pushSubscriptionsCount: pushCount ?? 0,
          services: [],
          shop: null,
          user: {
            createdAt: userData.user.created_at ?? null,
            email: userData.user.email ?? "",
            id: userData.user.id,
            lastSignInAt: userData.user.last_sign_in_at ?? null,
          },
        },
      });
    }

    const [
      servicesResult,
      hoursResult,
      appointmentsCountResult,
      appointmentsResult,
      pushResult,
    ] = await Promise.all([
      auth.adminSupabase
        .from("services")
        .select("id, name, duration_minutes, price, active, created_at")
        .eq("barbershop_id", shop.id)
        .order("created_at", { ascending: false }),
      auth.adminSupabase
        .from("business_hours")
        .select("id, weekday, opens_at, closes_at, active, lunch_enabled, lunch_starts_at, lunch_ends_at")
        .eq("barbershop_id", shop.id)
        .order("weekday", { ascending: true }),
      auth.adminSupabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("barbershop_id", shop.id),
      auth.adminSupabase
        .from("appointments")
        .select(
          "id, appointment_date, appointment_time, status, created_at, clients(name), services(name)",
        )
        .eq("barbershop_id", shop.id)
        .order("appointment_date", { ascending: false })
        .order("appointment_time", { ascending: false })
        .limit(8),
      auth.adminSupabase
        .from("push_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", id),
    ]);

    const firstError =
      servicesResult.error ||
      hoursResult.error ||
      appointmentsCountResult.error ||
      appointmentsResult.error ||
      pushResult.error;

    if (firstError) {
      return Response.json(
        { success: false, error: firstError.message },
        { status: 500 },
      );
    }

    const appointments = ((appointmentsResult.data ?? []) as AppointmentRow[]).map(
      (appointment) => ({
        appointmentDate: appointment.appointment_date,
        appointmentTime: appointment.appointment_time,
        clientName: firstRelation(appointment.clients)?.name ?? null,
        createdAt: appointment.created_at,
        id: appointment.id,
        serviceName: firstRelation(appointment.services)?.name ?? null,
        status: appointment.status,
      }),
    );

    return Response.json({
      success: true,
      detail: {
        appointmentsCount: appointmentsCountResult.count ?? 0,
        businessHours: hoursResult.data ?? [],
        lastAppointments: appointments,
        publicUrl: `/agendar/${shop.slug}`,
        pushSubscriptionsCount: pushResult.count ?? 0,
        services: servicesResult.data ?? [],
        shop,
        user: {
          createdAt: userData.user.created_at ?? null,
          email: userData.user.email ?? "",
          id: userData.user.id,
          lastSignInAt: userData.user.last_sign_in_at ?? null,
        },
      },
    });
  } catch (error) {
    console.error("[Admin User Detail] Erro inesperado", error);
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar detalhes.",
      },
      { status: 500 },
    );
  }
}
