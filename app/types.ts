export type Barbershop = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
  created_at?: string;
};

export type Service = {
  id: string;
  barbershop_id: string;
  name: string;
  duration_minutes: number;
  price: number;
  active: boolean;
  display_order: number;
  created_at?: string;
};

export type BusinessHour = {
  id: string;
  barbershop_id: string;
  weekday: number;
  opens_at: string;
  closes_at: string;
  active: boolean;
  lunch_enabled?: boolean | null;
  lunch_starts_at?: string | null;
  lunch_ends_at?: string | null;
  created_at?: string;
};

export type Client = {
  id: string;
  barbershop_id: string;
  name: string;
  phone: string;
  notes?: string | null;
  preferred_frequency_days?: number | null;
  deleted_at?: string | null;
  created_at?: string;
};

export type Appointment = {
  id: string;
  barbershop_id: string;
  client_id: string | null;
  service_id: string | null;
  appointment_date: string;
  appointment_time: string;
  status: "scheduled" | "confirmed" | "done" | "cancelled";
  notes: string | null;
  created_at?: string;
  clients?: Pick<Client, "name" | "phone"> | null;
  services?: Pick<Service, "name" | "price" | "duration_minutes"> | null;
};

export type Notification = {
  id: string;
  user_id: string | null;
  appointment_id: string | null;
  type: "new_appointment" | string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
};
