const DATABASE_SETUP_MESSAGE =
  "Banco ainda nao configurado. Rode o arquivo supabase/schema.sql no Supabase SQL Editor.";
const DISPLAY_ORDER_HOTFIX_MESSAGE =
  "Banco precisa do hotfix de ordenacao. Rode supabase/hotfix.sql no Supabase SQL Editor.";

type SupabaseLikeError = {
  code?: string;
  message?: string;
  details?: string;
};

export function friendlySupabaseError(error: SupabaseLikeError | null | undefined) {
  if (!error) {
    return "";
  }

  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`;
  const normalizedText = text.toLowerCase();

  if (normalizedText.includes("display_order")) {
    return DISPLAY_ORDER_HOTFIX_MESSAGE;
  }

  if (
    error.code === "PGRST205" ||
    normalizedText.includes("schema cache") ||
    normalizedText.includes("could not find the table") ||
    normalizedText.includes("could not find the function")
  ) {
    return DATABASE_SETUP_MESSAGE;
  }

  return error.message ?? "Nao foi possivel completar a operacao.";
}
