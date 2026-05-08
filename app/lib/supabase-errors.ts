const DATABASE_SETUP_MESSAGE =
  "Banco ainda não configurado. Rode o arquivo supabase/schema.sql no Supabase SQL Editor.";

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

  if (
    error.code === "PGRST205" ||
    text.includes("schema cache") ||
    text.includes("Could not find the table") ||
    text.includes("Could not find the function")
  ) {
    return DATABASE_SETUP_MESSAGE;
  }

  return error.message ?? "Não foi possível completar a operação.";
}
