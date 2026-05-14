import {
  createServerSupabaseAdminClient,
  getServerSupabaseDiagnostics,
} from "../../../lib/supabase-server";

export async function GET() {
  const diagnostics = getServerSupabaseDiagnostics();
  const adminSupabase = createServerSupabaseAdminClient();

  if (!diagnostics.hasUrl || !adminSupabase) {
    console.error("[Notifications Debug] Configuracao Supabase ausente", diagnostics);
    return Response.json(
      {
        success: false,
        error: "NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente",
        diagnostics,
      },
      { status: 500 },
    );
  }

  const { data: shops, error: shopError } = await adminSupabase
    .from("barbershops")
    .select("id, owner_id, name")
    .not("owner_id", "is", null)
    .limit(1);

  const shop = shops?.[0];
  const ownerUserId = typeof shop?.owner_id === "string" ? shop.owner_id : "";

  if (shopError || !ownerUserId) {
    console.error("[Notifications Debug] owner user_id nao encontrado", {
      data: shop,
      error: shopError,
      diagnostics,
    });
    return Response.json(
      {
        success: false,
        user_id: ownerUserId || null,
        data: shop ?? null,
        error: shopError ?? "owner user_id nao encontrado",
        diagnostics,
      },
      { status: 500 },
    );
  }

  const shopName = shop?.name ?? "barbearia";

  const { data, error } = await adminSupabase
    .from("notifications")
    .insert({
      user_id: ownerUserId,
      appointment_id: null,
      type: "debug",
      title: "Teste debug",
      message: `Notificacao debug criada para ${shopName}.`,
      read: false,
    })
    .select("id, user_id, appointment_id, type, title, message, read, created_at")
    .single();

  if (error) {
    console.error("[Notifications Debug] insert error", error);
  }

  return Response.json(
    {
      success: !error,
      user_id: ownerUserId,
      data,
      error,
      diagnostics,
    },
    { status: error ? 500 : 200 },
  );
}
