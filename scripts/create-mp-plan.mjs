import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const envLocalPath = path.join(projectRoot, ".env.local");

function parseEnvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) return null;

  const equalsIndex = trimmed.indexOf("=");

  if (equalsIndex < 1) return null;

  const key = trimmed.slice(0, equalsIndex).trim();
  let value = trimmed.slice(equalsIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadEnvLocal(filePath) {
  if (!existsSync(filePath)) {
    return {
      found: false,
      loadedKeys: new Set(),
    };
  }

  const loadedKeys = new Set();
  const content = readFileSync(filePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);

    if (!parsed) continue;

    process.env[parsed.key] = parsed.value;
    loadedKeys.add(parsed.key);
  }

  return {
    found: true,
    loadedKeys,
  };
}

function isPlaceholderToken(value) {
  const normalized = value.toLowerCase();

  return (
    normalized.includes("your-access-token") ||
    normalized.includes("seu-access-token") ||
    normalized.includes("placeholder") ||
    normalized.includes("change-me")
  );
}

function isValidMercadoPagoToken(value) {
  return /^(APP_USR|TEST)-[A-Za-z0-9_-]+$/.test(value);
}

const envLoad = loadEnvLocal(envLocalPath);
const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim() ?? "";
const tokenFoundInEnvLocal = envLoad.loadedKeys.has("MERCADO_PAGO_ACCESS_TOKEN");

console.log(`Arquivo carregado: ${envLoad.found ? envLocalPath : "NAO_ENCONTRADO"}`);
console.log(
  `MERCADO_PAGO_ACCESS_TOKEN encontrado: ${
    tokenFoundInEnvLocal && accessToken ? "SIM" : "NAO"
  }`,
);

if (!tokenFoundInEnvLocal || !accessToken) {
  console.error("Não foi possível localizar MERCADO_PAGO_ACCESS_TOKEN no .env.local");
  process.exit(1);
}

if (isPlaceholderToken(accessToken)) {
  console.error("MERCADO_PAGO_ACCESS_TOKEN invalido: valor parece placeholder.");
  process.exit(1);
}

if (!isValidMercadoPagoToken(accessToken)) {
  console.error(
    "MERCADO_PAGO_ACCESS_TOKEN invalido: formato esperado APP_USR-... ou TEST-...",
  );
  process.exit(1);
}

console.log("Token carregado: SIM");
console.log(`Ambiente: ${accessToken.startsWith("APP_USR-") ? "Produção" : "Teste"}`);

const requestBody = {
  auto_recurring: {
    currency_id: "BRL",
    frequency: 1,
    frequency_type: "months",
    transaction_amount: 19.9,
  },
  back_url: "https://horaai.site/upgrade",
  reason: "HoraAi PRO",
};

let response;

try {
  response = await fetch("https://api.mercadopago.com/preapproval_plan", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
} catch (error) {
  console.error("MERCADO_PAGO_ERROR_REASON=");
  console.error(
    error instanceof Error
      ? error.message
      : "Falha de rede ao chamar Mercado Pago.",
  );
  process.exit(1);
}

const text = await response.text();
let payload = text;

try {
  payload = text ? JSON.parse(text) : null;
} catch {
  payload = text;
}

console.log(`HTTP_STATUS=${response.status}`);
console.log("RESPONSE=");
console.log(JSON.stringify(payload, null, 2));

if (!response.ok) {
  const reason =
    typeof payload === "object" && payload
      ? payload.message ?? payload.error ?? payload.cause ?? `HTTP ${response.status}`
      : payload || `HTTP ${response.status}`;

  console.error("MERCADO_PAGO_ERROR_REASON=");
  console.error(JSON.stringify(reason, null, 2));
  console.error("MERCADO_PAGO_FULL_ERROR_RESPONSE=");
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

const planId =
  typeof payload === "object" && payload && "id" in payload
    ? String(payload.id)
    : "";

if (!planId) {
  console.error("MERCADO_PAGO_ERROR_REASON=");
  console.error("Mercado Pago nao retornou id do plano.");
  process.exit(1);
}

console.log(`MERCADO_PAGO_PRO_PLAN_ID=${planId}`);
