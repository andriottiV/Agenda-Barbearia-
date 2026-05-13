begin;

alter table public.services
add column if not exists display_order integer not null default 0;

update public.services
set display_order = 0
where display_order is null;

create index if not exists services_barbershop_display_created_idx
on public.services (barbershop_id, display_order, created_at);

alter table public.business_hours
add column if not exists lunch_enabled boolean not null default false;

alter table public.business_hours
add column if not exists lunch_starts_at time;

alter table public.business_hours
add column if not exists lunch_ends_at time;

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

create index if not exists clients_barbershop_active_idx
on public.clients (barbershop_id)
where deleted_at is null;

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

grant usage on schema public to anon, authenticated;
grant select on public.barbershops to anon, authenticated;
grant select on public.services to anon, authenticated;
grant select on public.business_hours to anon, authenticated;
grant select on public.booked_slots to anon, authenticated;

grant select on public.business_settings to anon, authenticated;
grant insert, update, delete on public.business_settings to authenticated;

grant insert on public.clients to anon;
grant insert on public.appointments to anon;
grant select, insert, update on public.clients to authenticated;
grant select, insert, update on public.appointments to authenticated;
grant insert, update, delete on public.barbershops to authenticated;
grant insert, update, delete on public.services to authenticated;
grant insert, update, delete on public.business_hours to authenticated;
grant execute on function public.create_public_appointment(
  uuid,
  uuid,
  date,
  time,
  text,
  text,
  text
) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
