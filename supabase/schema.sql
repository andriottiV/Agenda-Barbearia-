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
  created_at timestamptz not null default now()
);

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
  created_at timestamptz not null default now()
);

create table if not exists public.business_hours (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (barbershop_id, weekday)
);

create unique index if not exists appointments_unique_active_slot
on public.appointments (barbershop_id, appointment_date, appointment_time)
where status <> 'cancelled';

create index if not exists services_barbershop_id_idx
on public.services (barbershop_id);

create index if not exists services_barbershop_order_idx
on public.services (barbershop_id, display_order, name);

create index if not exists clients_barbershop_id_idx
on public.clients (barbershop_id);

create index if not exists appointments_barbershop_date_idx
on public.appointments (barbershop_id, appointment_date);

create or replace view public.booked_slots as
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

  if not exists (
    select 1
    from public.services
    where id = p_service_id
      and barbershop_id = p_barbershop_id
      and active
  ) then
    raise exception 'Servico indisponivel.';
  end if;

  insert into public.clients (barbershop_id, name, phone)
  values (p_barbershop_id, trim(p_customer_name), trim(p_customer_phone))
  returning id into v_client_id;

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

grant usage on schema public to anon, authenticated;
grant select on public.barbershops to anon, authenticated;
grant select on public.services to anon, authenticated;
grant select on public.business_hours to anon, authenticated;
grant select on public.booked_slots to anon, authenticated;
grant insert on public.clients to anon;
grant insert on public.appointments to anon;
grant select, insert, update on public.clients to authenticated;
grant select, insert, update on public.appointments to authenticated;
grant insert, update, delete on public.barbershops to authenticated;
grant insert, update, delete on public.services to authenticated;
grant insert, update, delete on public.business_hours to authenticated;
grant execute on function public.create_public_appointment(uuid, uuid, date, time, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
