import { requireAdmin } from "../../../lib/admin-auth";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type AuthUser = {
  id: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
  user_metadata?: Record<string, unknown>;
};

type BarbershopRow = {
  created_at: string;
  id: string;
  name: string;
  owner_id: string;
  slug: string;
};

type ServiceRow = {
  active: boolean;
  barbershop_id: string;
};

type BusinessHourRow = {
  active: boolean;
  barbershop_id: string;
};

type PushRow = {
  user_id: string;
};

const TRIAL_DAYS = 30;

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function displayName(user: AuthUser, shop?: BarbershopRow) {
  const metadataName =
    typeof user.user_metadata?.name === "string"
      ? user.user_metadata.name
      : typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : "";

  return shop?.name || metadataName || "Sem empresa";
}

async function listAllUsers(adminSupabase: SupabaseClient) {
  const users: AuthUser[] = [];
  let page = 1;
  const perPage = 1000;

  for (;;) {
    const { data, error } = await adminSupabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw error;
    }

    users.push(...((data.users ?? []) as AuthUser[]));

    if ((data.users ?? []).length < perPage) {
      break;
    }

    page += 1;
  }

  return users;
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);

  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const [users, shopsResult, servicesResult, hoursResult, pushResult] =
      await Promise.all([
        listAllUsers(auth.adminSupabase),
        auth.adminSupabase
          .from("barbershops")
          .select("id, owner_id, name, slug, created_at"),
        auth.adminSupabase.from("services").select("barbershop_id, active"),
        auth.adminSupabase
          .from("business_hours")
          .select("barbershop_id, active"),
        auth.adminSupabase.from("push_subscriptions").select("user_id"),
      ]);

    const firstError =
      shopsResult.error ||
      servicesResult.error ||
      hoursResult.error ||
      pushResult.error;

    if (firstError) {
      return Response.json(
        { success: false, error: firstError.message },
        { status: 500 },
      );
    }

    const now = new Date();
    const inThirtyDays = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const shops = ((shopsResult.data ?? []) as BarbershopRow[]);
    const services = ((servicesResult.data ?? []) as ServiceRow[]);
    const hours = ((hoursResult.data ?? []) as BusinessHourRow[]);
    const pushRows = ((pushResult.data ?? []) as PushRow[]);

    const shopByOwner = new Map(shops.map((shop) => [shop.owner_id, shop]));
    const activeServicesByShop = new Map<string, number>();
    const activeHoursByShop = new Map<string, number>();
    const pushByUser = new Set(pushRows.map((row) => row.user_id));

    services.forEach((service) => {
      if (!service.active) return;
      activeServicesByShop.set(
        service.barbershop_id,
        (activeServicesByShop.get(service.barbershop_id) ?? 0) + 1,
      );
    });

    hours.forEach((hour) => {
      if (!hour.active) return;
      activeHoursByShop.set(
        hour.barbershop_id,
        (activeHoursByShop.get(hour.barbershop_id) ?? 0) + 1,
      );
    });

    const rows = users
      .sort(
        (left, right) =>
          new Date(right.created_at ?? 0).getTime() -
          new Date(left.created_at ?? 0).getTime(),
      )
      .map((user) => {
        const createdAt = new Date(user.created_at ?? Date.now());
        const trialEndsAt = addDays(createdAt, TRIAL_DAYS);
        const daysToTrialEnd = Math.ceil(
          (trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
        );
        const shop = shopByOwner.get(user.id);
        const agendaConfigured = Boolean(
          shop &&
            (activeServicesByShop.get(shop.id) ?? 0) > 0 &&
            (activeHoursByShop.get(shop.id) ?? 0) > 0,
        );

        return {
          agendaConfigured,
          createdAt: user.created_at ?? null,
          daysToTrialEnd,
          email: user.email ?? "",
          id: user.id,
          lastSignInAt: user.last_sign_in_at ?? null,
          name: displayName(user, shop),
          planStatus: daysToTrialEnd >= 0 ? "Teste gratis" : "Sem plano ativo",
          publicUrl: shop?.slug ? `/agendar/${shop.slug}` : null,
          pushEnabled: pushByUser.has(user.id),
          shopName: shop?.name ?? null,
          trialEndsAt: trialEndsAt.toISOString(),
          trialStatus: daysToTrialEnd >= 0 ? "Ativo" : "Expirado",
        };
      });

    const metrics = {
      agendaConfigured: rows.filter((row) => row.agendaConfigured).length,
      agendaMissing: rows.filter((row) => !row.agendaConfigured).length,
      trialActive: rows.filter((row) => row.daysToTrialEnd >= 0).length,
      trialExpiring7Days: rows.filter(
        (row) => row.daysToTrialEnd >= 0 && row.daysToTrialEnd <= 7,
      ).length,
      totalUsers: rows.length,
      usersLast30Days: rows.filter(
        (row) => row.createdAt && new Date(row.createdAt) >= inThirtyDays,
      ).length,
    };

    return Response.json({
      success: true,
      metrics,
      users: rows,
    });
  } catch (error) {
    console.error("[Admin Users] Erro inesperado", error);
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar usuarios.",
      },
      { status: 500 },
    );
  }
}
