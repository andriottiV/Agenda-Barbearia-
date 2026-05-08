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
) {
  const slots: string[] = [];
  let cursor = opensAt.slice(0, 5);

  while (addMinutes(cursor, durationMinutes) <= closesAt.slice(0, 5)) {
    if (!occupiedStarts.includes(cursor)) {
      slots.push(cursor);
    }
    cursor = addMinutes(cursor, 30);
  }

  return slots;
}

export function whatsappLink(phone: string, message: string) {
  const cleanPhone = phone.replace(/\D/g, "");
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}
