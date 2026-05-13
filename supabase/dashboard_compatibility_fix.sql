begin;

alter table public.services
add column if not exists display_order integer not null default 0;

alter table public.clients
add column if not exists notes text;

alter table public.clients
add column if not exists preferred_frequency_days integer;

alter table public.clients
add column if not exists deleted_at timestamptz;

alter table public.business_hours
add column if not exists lunch_enabled boolean not null default false;

alter table public.business_hours
add column if not exists lunch_starts_at time;

alter table public.business_hours
add column if not exists lunch_ends_at time;

-- Compatibility with older databases that used lunch_start/lunch_end names.
alter table public.business_hours
add column if not exists lunch_start time;

alter table public.business_hours
add column if not exists lunch_end time;

update public.business_hours
set
  lunch_starts_at = coalesce(lunch_starts_at, lunch_start),
  lunch_ends_at = coalesce(lunch_ends_at, lunch_end)
where lunch_start is not null
   or lunch_end is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_barbershop_id_fkey'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
    add constraint appointments_barbershop_id_fkey
    foreign key (barbershop_id)
    references public.barbershops(id)
    on delete cascade
    not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_client_id_fkey'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
    add constraint appointments_client_id_fkey
    foreign key (client_id)
    references public.clients(id)
    on delete cascade
    not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_service_id_fkey'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
    add constraint appointments_service_id_fkey
    foreign key (service_id)
    references public.services(id)
    on delete set null
    not valid;
  end if;
end;
$$;

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

create table if not exists public.business_settings (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo',
  service_tax_percent numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id)
);

alter table public.business_settings enable row level security;

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

grant usage on schema public to anon, authenticated;
grant select on public.barbershops to anon, authenticated;
grant select on public.services to anon, authenticated;
grant select on public.business_hours to anon, authenticated;
grant select on public.booked_slots to anon, authenticated;
grant select, insert, update, delete on public.business_settings to authenticated;
grant select, insert, update on public.clients to authenticated;
grant select, insert, update on public.appointments to authenticated;
grant insert, update, delete on public.barbershops to authenticated;
grant insert, update, delete on public.services to authenticated;
grant insert, update, delete on public.business_hours to authenticated;

notify pgrst, 'reload schema';

commit;
