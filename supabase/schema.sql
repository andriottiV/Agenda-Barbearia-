create extension if not exists "pgcrypto";

create table if not exists public.barbershops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text unique not null,
  phone text,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  name text not null,
  duration_minutes integer not null default 30 check (duration_minutes > 0),
  price numeric(10, 2) not null default 0 check (price >= 0),
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.services
add column if not exists display_order integer not null default 0;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  name text not null,
  phone text not null,
  notes text,
  preferred_frequency_days integer check (preferred_frequency_days is null or preferred_frequency_days > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.clients
add column if not exists notes text;

alter table public.clients
add column if not exists preferred_frequency_days integer;

alter table public.clients
add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_preferred_frequency_days_check'
  ) then
    alter table public.clients
    add constraint clients_preferred_frequency_days_check
    check (preferred_frequency_days is null or preferred_frequency_days > 0);
  end if;
end;
$$;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  appointment_date date not null,
  appointment_time time not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'confirmed', 'done', 'cancelled')),
  notes text,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.appointments
add column if not exists reminder_sent_at timestamptz;

create table if not exists public.business_hours (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  active boolean not null default true,
  lunch_enabled boolean not null default false,
  lunch_starts_at time,
  lunch_ends_at time,
  created_at timestamptz not null default now(),
  unique (barbershop_id, weekday)
);

alter table public.business_hours
add column if not exists lunch_enabled boolean not null default false;

create table if not exists public.business_settings (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo',
  service_tax_percent numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id)
);

create unique index if not exists business_settings_barbershop_id_idx
on public.business_settings (barbershop_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  type text not null default 'new_appointment',
  title text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_at_idx
on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
on public.notifications (user_id, read)
where read = false;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fcm_token text not null unique,
  endpoint text,
  p256dh text,
  auth_key text,
  subscription jsonb,
  platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions
add column if not exists endpoint text;

alter table public.push_subscriptions
add column if not exists p256dh text;

alter table public.push_subscriptions
add column if not exists auth_key text;

alter table public.push_subscriptions
add column if not exists subscription jsonb;

create index if not exists push_subscriptions_user_id_idx
on public.push_subscriptions (user_id);

create unique index if not exists push_subscriptions_endpoint_idx
on public.push_subscriptions (endpoint);

alter table public.business_hours
add column if not exists lunch_starts_at time;

alter table public.business_hours
add column if not exists lunch_ends_at time;

create unique index if not exists appointments_unique_active_slot
on public.appointments (barbershop_id, appointment_date, appointment_time)
where status <> 'cancelled';

create index if not exists services_barbershop_id_idx
on public.services (barbershop_id);

create index if not exists services_barbershop_order_idx
on public.services (barbershop_id, display_order, created_at);

create index if not exists clients_barbershop_id_idx
on public.clients (barbershop_id);

create index if not exists clients_barbershop_active_idx
on public.clients (barbershop_id)
where deleted_at is null;

create index if not exists appointments_barbershop_date_idx
on public.appointments (barbershop_id, appointment_date);

create or replace view public.booked_slots
with (security_invoker = true) as
select
  id,
  barbershop_id,
  appointment_date,
  appointment_time,
  status
from public.appointments
where status <> 'cancelled';

alter table public.barbershops enable row level security;
alter table public.services enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.business_hours enable row level security;
alter table public.business_settings enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "barbershops public read" on public.barbershops;
create policy "barbershops public read"
on public.barbershops for select
using (true);

drop policy if exists "barbershops owner insert" on public.barbershops;
create policy "barbershops owner insert"
on public.barbershops for insert
with check (auth.uid() = owner_id);

drop policy if exists "barbershops owner update" on public.barbershops;
create policy "barbershops owner update"
on public.barbershops for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "barbershops owner delete" on public.barbershops;
create policy "barbershops owner delete"
on public.barbershops for delete
using (auth.uid() = owner_id);

drop policy if exists "services public read active" on public.services;
create policy "services public read active"
on public.services for select
using (
  active
  or exists (
    select 1 from public.barbershops
    where barbershops.id = services.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "services owner insert" on public.services;
create policy "services owner insert"
on public.services for insert
with check (
  exists (
    select 1 from public.barbershops
    where barbershops.id = services.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "services owner update" on public.services;
create policy "services owner update"
on public.services for update
using (
  exists (
    select 1 from public.barbershops
    where barbershops.id = services.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.barbershops
    where barbershops.id = services.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "services owner delete" on public.services;
create policy "services owner delete"
on public.services for delete
using (
  exists (
    select 1 from public.barbershops
    where barbershops.id = services.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "hours public read active" on public.business_hours;
create policy "hours public read active"
on public.business_hours for select
using (
  active
  or exists (
    select 1 from public.barbershops
    where barbershops.id = business_hours.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "hours owner insert" on public.business_hours;
create policy "hours owner insert"
on public.business_hours for insert
with check (
  exists (
    select 1 from public.barbershops
    where barbershops.id = business_hours.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "hours owner update" on public.business_hours;
create policy "hours owner update"
on public.business_hours for update
using (
  exists (
    select 1 from public.barbershops
    where barbershops.id = business_hours.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.barbershops
    where barbershops.id = business_hours.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "hours owner delete" on public.business_hours;
create policy "hours owner delete"
on public.business_hours for delete
using (
  exists (
    select 1 from public.barbershops
    where barbershops.id = business_hours.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "business_settings owner read" on public.business_settings;
create policy "business_settings owner read"
on public.business_settings for select
using (
  exists (
    select 1 from public.barbershops
    where barbershops.id = business_settings.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "business_settings owner insert" on public.business_settings;
create policy "business_settings owner insert"
on public.business_settings for insert
with check (
  exists (
    select 1 from public.barbershops
    where barbershops.id = business_settings.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "business_settings owner update" on public.business_settings;
create policy "business_settings owner update"
on public.business_settings for update
using (
  exists (
    select 1 from public.barbershops
    where barbershops.id = business_settings.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.barbershops
    where barbershops.id = business_settings.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "business_settings owner delete" on public.business_settings;
create policy "business_settings owner delete"
on public.business_settings for delete
using (
  exists (
    select 1 from public.barbershops
    where barbershops.id = business_settings.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "notifications owner read" on public.notifications;
create policy "notifications owner read"
on public.notifications for select
using (auth.uid() = user_id);

drop policy if exists "notifications owner update" on public.notifications;
create policy "notifications owner update"
on public.notifications for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions owner read" on public.push_subscriptions;
create policy "push_subscriptions owner read"
on public.push_subscriptions for select
using (auth.uid() = user_id);

drop policy if exists "push_subscriptions owner insert" on public.push_subscriptions;
create policy "push_subscriptions owner insert"
on public.push_subscriptions for insert
with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions owner update" on public.push_subscriptions;
create policy "push_subscriptions owner update"
on public.push_subscriptions for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions owner delete" on public.push_subscriptions;
create policy "push_subscriptions owner delete"
on public.push_subscriptions for delete
using (auth.uid() = user_id);

drop policy if exists "clients owner read" on public.clients;
create policy "clients owner read"
on public.clients for select
using (
  exists (
    select 1 from public.barbershops
    where barbershops.id = clients.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "clients owner insert" on public.clients;
create policy "clients owner insert"
on public.clients for insert
with check (
  exists (
    select 1 from public.barbershops
    where barbershops.id = clients.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "clients public insert" on public.clients;
create policy "clients public insert"
on public.clients for insert
with check (
  exists (
    select 1 from public.barbershops
    where barbershops.id = clients.barbershop_id
  )
);

drop policy if exists "appointments owner read" on public.appointments;
create policy "appointments owner read"
on public.appointments for select
using (
  exists (
    select 1 from public.barbershops
    where barbershops.id = appointments.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "appointments owner insert" on public.appointments;
create policy "appointments owner insert"
on public.appointments for insert
with check (
  exists (
    select 1 from public.barbershops
    where barbershops.id = appointments.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "appointments owner update" on public.appointments;
create policy "appointments owner update"
on public.appointments for update
using (
  exists (
    select 1 from public.barbershops
    where barbershops.id = appointments.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.barbershops
    where barbershops.id = appointments.barbershop_id
    and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "appointments public insert" on public.appointments;
create policy "appointments public insert"
on public.appointments for insert
with check (
  exists (
    select 1 from public.barbershops
    where barbershops.id = appointments.barbershop_id
  )
  and exists (
    select 1 from public.clients
    where clients.id = appointments.client_id
    and clients.barbershop_id = appointments.barbershop_id
  )
  and (
    appointments.service_id is null
    or exists (
      select 1 from public.services
      where services.id = appointments.service_id
      and services.barbershop_id = appointments.barbershop_id
      and services.active
    )
  )
);

create or replace function public.create_public_appointment(
  p_barbershop_id uuid,
  p_service_id uuid,
  p_appointment_date date,
  p_appointment_time time,
  p_customer_name text,
  p_customer_phone text,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_appointment_id uuid;
  v_duration_minutes integer;
begin
  if trim(coalesce(p_customer_name, '')) = '' then
    raise exception 'Informe seu nome.';
  end if;

  if trim(coalesce(p_customer_phone, '')) = '' then
    raise exception 'Informe seu telefone.';
  end if;

  if p_appointment_date < current_date then
    raise exception 'Escolha uma data valida.';
  end if;

  select duration_minutes
  into v_duration_minutes
  from public.services
  where id = p_service_id
    and barbershop_id = p_barbershop_id
    and active;

  if v_duration_minutes is null then
    raise exception 'Servico indisponivel.';
  end if;

  if exists (
    select 1
    from public.business_hours
    where barbershop_id = p_barbershop_id
      and weekday = extract(dow from p_appointment_date)::integer
      and active
      and lunch_enabled
      and lunch_starts_at is not null
      and lunch_ends_at is not null
      and p_appointment_time < lunch_ends_at
      and (p_appointment_time + make_interval(mins => v_duration_minutes)) > lunch_starts_at
  ) then
    raise exception 'Este horario fica dentro da pausa para almoço.';
  end if;

  select id
  into v_client_id
  from public.clients
  where barbershop_id = p_barbershop_id
    and deleted_at is null
    and regexp_replace(phone, '\D', '', 'g') =
      regexp_replace(p_customer_phone, '\D', '', 'g')
  order by created_at desc
  limit 1;

  if v_client_id is null then
    insert into public.clients (barbershop_id, name, phone)
    values (p_barbershop_id, trim(p_customer_name), trim(p_customer_phone))
    returning id into v_client_id;
  else
    update public.clients
    set name = trim(p_customer_name),
        phone = trim(p_customer_phone)
    where id = v_client_id;
  end if;

  insert into public.appointments (
    barbershop_id,
    client_id,
    service_id,
    appointment_date,
    appointment_time,
    status,
    notes
  )
  values (
    p_barbershop_id,
    v_client_id,
    p_service_id,
    p_appointment_date,
    p_appointment_time,
    'scheduled',
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_appointment_id;

  return v_appointment_id;
exception
  when unique_violation then
    raise exception 'Este horario acabou de ser ocupado. Escolha outro.';
end;
$$;

create or replace function public.create_new_appointment_notification(
  p_barbershop_id uuid,
  p_appointment_id uuid,
  p_title text,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_notification_id uuid;
begin
  select owner_id
  into v_user_id
  from public.barbershops
  where id = p_barbershop_id;

  if v_user_id is null then
    raise exception 'Barbearia nao encontrada para notificacao.';
  end if;

  insert into public.notifications (
    user_id,
    appointment_id,
    type,
    title,
    message
  )
  values (
    v_user_id,
    p_appointment_id,
    'new_appointment',
    coalesce(nullif(trim(coalesce(p_title, '')), ''), 'Novo agendamento recebido'),
    coalesce(nullif(trim(coalesce(p_message, '')), ''), 'Um novo agendamento foi confirmado.')
  )
  returning id into v_notification_id;

  return v_notification_id;
end;
$$;

grant usage on schema public to anon, authenticated;
grant select on public.barbershops to anon, authenticated;
grant select on public.services to anon, authenticated;
grant select on public.business_hours to anon, authenticated;
grant select on public.booked_slots to anon, authenticated;
grant insert on public.clients to anon;
grant insert on public.appointments to anon;
grant select, insert, update on public.clients to authenticated;
grant select, insert, update on public.appointments to authenticated;
grant select, update on public.notifications to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant insert, update, delete on public.barbershops to authenticated;
grant insert, update, delete on public.services to authenticated;
grant insert, update, delete on public.business_hours to authenticated;
grant select, insert, update, delete on public.business_settings to authenticated;
grant execute on function public.create_public_appointment(uuid, uuid, date, time, text, text, text) to anon, authenticated;
grant execute on function public.create_new_appointment_notification(uuid, uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
