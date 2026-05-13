type SupabaseDebugError = {
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  message?: unknown;
  stack?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

function readErrorField(error: unknown, field: keyof SupabaseDebugError) {
  if (!error || typeof error !== "object") return undefined;
  return (error as SupabaseDebugError)[field];
}

function serializeUnknown(value: unknown) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  try {
    return JSON.parse(JSON.stringify(value, Object.getOwnPropertyNames(value)));
  } catch {
    return String(value);
  }
}

export function describeSupabaseError(error: unknown) {
  return {
    fullError: serializeUnknown(error),
    message: readErrorField(error, "message"),
    details: readErrorField(error, "details"),
    hint: readErrorField(error, "hint"),
    code: readErrorField(error, "code"),
    stack: readErrorField(error, "stack"),
    status: readErrorField(error, "status") ?? readErrorField(error, "statusCode"),
  };
}

export function logSupabaseError(
  context: string,
  error: unknown,
  extra?: Record<string, unknown>,
) {
  if (!error) return;

  const details = describeSupabaseError(error);

  console.error("========== SUPABASE ERROR ==========");
  console.error("CONTEXT:", context);
  console.error("FULL ERROR:", details.fullError);
  console.error("MESSAGE:", details.message);
  console.error("DETAILS:", details.details);
  console.error("HINT:", details.hint);
  console.error("CODE:", details.code);
  console.error("STACK:", details.stack);
  console.error("STATUS:", details.status);
  console.error("EXTRA:", extra ?? null);
  console.error("====================================");
}
