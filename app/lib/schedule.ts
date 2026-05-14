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
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  occupiedRanges: Array<{ startTime: string; durationMinutes: number }> = [],
) {
  const slots: string[] = [];
  let cursor = opensAt.slice(0, 5);

  while (addMinutes(cursor, durationMinutes) <= closesAt.slice(0, 5)) {
    if (
      !occupiedStarts.includes(cursor) &&
      !occupiedRanges.some((range) =>
        overlapsTimeRange(
          cursor,
          durationMinutes,
          range.startTime,
          range.durationMinutes,
        ),
      ) &&
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

export function overlapsTimeRange(
  startTime: string,
  durationMinutes: number,
  otherStartTime: string,
  otherDurationMinutes: number,
) {
  const start = minutesFromTime(startTime);
  const end = start + durationMinutes;
  const otherStart = minutesFromTime(otherStartTime);
  const otherEnd = otherStart + otherDurationMinutes;

  return start < otherEnd && end > otherStart;
}

export function isInsideBusinessHours(
  startTime: string,
  durationMinutes: number,
  opensAt?: string | null,
  closesAt?: string | null,
) {
  if (!opensAt || !closesAt) return false;

  const start = minutesFromTime(startTime);
  const end = start + durationMinutes;
  return start >= minutesFromTime(opensAt) && end <= minutesFromTime(closesAt);
}

export function normalizeBrazilPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

export function whatsappLink(phone: string, message: string) {
  const cleanPhone = normalizeBrazilPhone(phone);
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
