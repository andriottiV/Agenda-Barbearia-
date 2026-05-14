import {
  createServerSupabaseAdminClient,
  createServerSupabaseClient,
  getServerSupabaseDiagnostics,
} from "../../../lib/supabase-server";
import {
  getFirebaseAdminDiagnostics,
  sendPushToUser,
} from "../../../lib/firebase-admin";

export const runtime = "nodejs";

type SendPushBody = {
  body?: unknown;
  link?: unknown;
  title?: unknown;
};

function textField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const [type, token] = authorization.split(" ");

  if (type.toLowerCase() !== "bearer" || !token) {
    return "";
  }

  return token.trim();
}

export async function POST(request: Request) {
  const token = bearerToken(request);

  if (!token) {
    return Response.json(
      { success: false, error: "Authorization Bearer token ausente." },
      { status: 401 },
    );
  }

  const supabase = createServerSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const user = authData.user;

  if (authError || !user) {
    return Response.json(
      { success: false, error: "Usuario nao autenticado." },
      { status: 401 },
    );
  }

  const adminSupabase = createServerSupabaseAdminClient();

  if (!adminSupabase) {
    console.error("[Push Send] Supabase admin nao configurado", {
      supabase: getServerSupabaseDiagnostics(),
    });

    return Response.json(
      {
        success: false,
        error: "SUPABASE_SERVICE_ROLE_KEY ausente.",
        diagnostics: {
          firebase: getFirebaseAdminDiagnostics(),
          supabase: getServerSupabaseDiagnostics(),
        },
      },
      { status: 500 },
    );
  }

  let body: SendPushBody = {};

  try {
    body = (await request.json()) as SendPushBody;
  } catch {
    body = {};
  }

  const title = textField(body.title) || "Teste HoraAi";
  const message =
    textField(body.body) ||
    "Notificacoes push estao funcionando neste dispositivo.";
  const link = textField(body.link) || "/dashboard";

  try {
    const result = await sendPushToUser({
      supabase: adminSupabase,
      userId: user.id,
      payload: {
        title,
        body: message,
        link,
        data: {
          title,
          body: message,
          url: link,
          type: "test",
        },
      },
    });

    return Response.json(
      {
        success: result.ok,
        ...result,
      },
      { status: result.ok ? 200 : 400 },
    );
  } catch (error) {
    console.error("[Push Send] Erro inesperado", error);

    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel enviar notificacao push.",
        diagnostics: {
          firebase: getFirebaseAdminDiagnostics(),
          supabase: getServerSupabaseDiagnostics(),
        },
      },
      { status: 500 },
    );
  }
}
