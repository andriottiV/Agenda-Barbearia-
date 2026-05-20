import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  createServerSupabaseAdminClient,
  createServerSupabaseClient,
  getServerSupabaseDiagnostics,
} from "./supabase-server";
import { ADMIN_EMAIL } from "./admin-constants";

export type AdminAuthResult =
  | {
      adminSupabase: SupabaseClient;
      ok: true;
      user: User;
    }
  | {
      error: string;
      status: number;
      ok: false;
    };

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const [type, token] = authorization.split(" ");

  if (type.toLowerCase() !== "bearer" || !token) {
    return "";
  }

  return token.trim();
}

export async function requireAdmin(request: Request): Promise<AdminAuthResult> {
  const token = bearerToken(request);

  if (!token) {
    return {
      ok: false,
      error: "Authorization Bearer token ausente.",
      status: 401,
    };
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser(token);
  const user = data.user;

  if (error || !user) {
    return {
      ok: false,
      error: "Usuario nao autenticado.",
      status: 401,
    };
  }

  if (user.email?.toLowerCase() !== ADMIN_EMAIL) {
    return {
      ok: false,
      error: "Acesso negado.",
      status: 403,
    };
  }

  const adminSupabase = createServerSupabaseAdminClient();

  if (!adminSupabase) {
    return {
      ok: false,
      error: `SUPABASE_SERVICE_ROLE_KEY ausente. ${JSON.stringify(
        getServerSupabaseDiagnostics(),
      )}`,
      status: 500,
    };
  }

  return {
    adminSupabase,
    ok: true,
    user,
  };
}
