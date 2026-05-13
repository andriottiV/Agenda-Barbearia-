export const weekdays = [
  "Domingo",
  "Segunda",
  "Terca",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sabado",
];

export function currency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function toMoney(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "0")
    .replace(/\./g, "")
    .replace(",", ".");

  return Number.isFinite(Number(normalized)) ? Number(normalized) : 0;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function addMinutes(time: string, minutes: number) {
  const [hours, mins] = time.split(":").map(Number);
  const date = new Date(2020, 0, 1, hours, mins + minutes);
  return date.toTimeString().slice(0, 5);
}

export function makeSlots(
  opensAt: string,
  closesAt: string,
  durationMinutes: number,
  occupiedStarts: string[],
  lunchBreak?: {
    enabled?: boolean | null;
    startsAt?: string | null;
    endsAt?: string | null;
  },
) {
  const slots: string[] = [];
  let cursor = opensAt.slice(0, 5);

  while (addMinutes(cursor, durationMinutes) <= closesAt.slice(0, 5)) {
    if (
      !occupiedStarts.includes(cursor) &&
      !overlapsLunchBreak(cursor, durationMinutes, lunchBreak)
    ) {
      slots.push(cursor);
    }
    cursor = addMinutes(cursor, 30);
  }

  return slots;
}

export function minutesFromTime(time: string) {
  const [hours, minutes] = time.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

export function overlapsLunchBreak(
  startTime: string,
  durationMinutes: number,
  lunchBreak?: {
    enabled?: boolean | null;
    startsAt?: string | null;
    endsAt?: string | null;
  },
) {
  if (!lunchBreak?.enabled || !lunchBreak.startsAt || !lunchBreak.endsAt) {
    return false;
  }

  const start = minutesFromTime(startTime);
  const end = start + durationMinutes;
  const lunchStart = minutesFromTime(lunchBreak.startsAt);
  const lunchEnd = minutesFromTime(lunchBreak.endsAt);

  return start < lunchEnd && end > lunchStart;
}

export function whatsappLink(phone: string, message: string) {
  const cleanPhone = phone.replace(/\D/g, "");
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

export function formatPhoneBR(phone?: string | null) {
  const digits = String(phone ?? "").replace(/\D/g, "");

  if (!digits) {
    return "Sem telefone";
  }

  const nationalNumber =
    digits.length > 11 && digits.startsWith("55") ? digits.slice(2) : digits;

  if (nationalNumber.length === 11) {
    return `(${nationalNumber.slice(0, 2)}) ${nationalNumber.slice(
      2,
      7,
    )}-${nationalNumber.slice(7)}`;
  }

  if (nationalNumber.length === 10) {
    return `(${nationalNumber.slice(0, 2)}) ${nationalNumber.slice(
      2,
      6,
    )}-${nationalNumber.slice(6)}`;
  }

  return phone?.trim() || "Sem telefone";
}
