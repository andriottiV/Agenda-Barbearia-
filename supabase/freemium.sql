-- HoraAi Freemium foundation
-- Run this file in the Supabase SQL Editor after supabase/schema.sql.

create table if not exists public.barbershop_plans (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id)
);

insert into public.barbershop_plans (barbershop_id, plan)
select id, 'free'
from public.barbershops
on conflict (barbershop_id) do nothing;

alter table public.barbershop_plans enable row level security;

drop policy if exists "barbershop_plans owner read" on public.barbershop_plans;
create policy "barbershop_plans owner read"
on public.barbershop_plans for select
using (
  exists (
    select 1 from public.barbershops
    where barbershops.id = barbershop_plans.barbershop_id
      and barbershops.owner_id = auth.uid()
  )
);

drop policy if exists "barbershop_plans owner insert" on public.barbershop_plans;
create policy "barbershop_plans owner insert"
on public.barbershop_plans for insert
with check (
  exists (
    select 1 from public.barbershops
    where barbershops.id = barbershop_plans.barbershop_id
      and barbershops.owner_id = auth.uid()
  )
  and plan = 'free'
);

drop policy if exists "barbershop_plans owner update free only" on public.barbershop_plans;
create policy "barbershop_plans owner update free only"
on public.barbershop_plans for update
using (
  exists (
    select 1 from public.barbershops
    where barbershops.id = barbershop_plans.barbershop_id
      and barbershops.owner_id = auth.uid()
  )
)
with check (plan = 'free');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists barbershop_plans_set_updated_at on public.barbershop_plans;
create trigger barbershop_plans_set_updated_at
before update on public.barbershop_plans
for each row execute function public.set_updated_at();

create or replace function public.create_default_barbershop_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.barbershop_plans (barbershop_id, plan)
  values (new.id, 'free')
  on conflict (barbershop_id) do nothing;

  return new;
end;
$$;

drop trigger if exists barbershops_create_default_plan on public.barbershops;
create trigger barbershops_create_default_plan
after insert on public.barbershops
for each row execute function public.create_default_barbershop_plan();

create or replace function public.current_billing_month_start()
returns timestamptz
language sql
stable
as $$
  select date_trunc('month', timezone('America/Sao_Paulo', now()))
    at time zone 'America/Sao_Paulo';
$$;

create or replace function public.count_barbershop_monthly_appointments(
  p_barbershop_id uuid
)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
  from public.appointments
  where barbershop_id = p_barbershop_id
    and created_at >= public.current_billing_month_start()
    and created_at < public.current_billing_month_start() + interval '1 month';
$$;

create or replace function public.get_barbershop_plan_usage(
  p_barbershop_id uuid
)
returns table (
  plan text,
  monthly_appointments integer,
  monthly_limit integer,
  remaining integer,
  limit_reached boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_count integer;
  v_limit integer;
begin
  insert into public.barbershop_plans (barbershop_id, plan)
  values (p_barbershop_id, 'free')
  on conflict (barbershop_id) do nothing;

  select coalesce(barbershop_plans.plan, 'free')
  into v_plan
  from public.barbershop_plans
  where barbershop_plans.barbershop_id = p_barbershop_id;

  v_plan := coalesce(v_plan, 'free');
  v_count := public.count_barbershop_monthly_appointments(p_barbershop_id);
  v_limit := case when v_plan = 'free' then 20 else null end;

  return query
  select
    v_plan,
    v_count,
    v_limit,
    case when v_limit is null then null else greatest(v_limit - v_count, 0) end,
    case when v_limit is null then false else v_count >= v_limit end;
end;
$$;

create or replace function public.assert_barbershop_can_create_appointment(
  p_barbershop_id uuid,
  p_limit_message text default 'Seu plano gratuito atingiu 20 agendamentos este mês. Faça upgrade para continuar recebendo novos horários.'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_count integer;
begin
  insert into public.barbershop_plans (barbershop_id, plan)
  values (p_barbershop_id, 'free')
  on conflict (barbershop_id) do nothing;

  select plan
  into v_plan
  from public.barbershop_plans
  where barbershop_id = p_barbershop_id
  for update;

  v_plan := coalesce(v_plan, 'free');

  if v_plan = 'pro' then
    return;
  end if;

  v_count := public.count_barbershop_monthly_appointments(p_barbershop_id);

  if v_count >= 20 then
    raise exception '%', p_limit_message;
  end if;
end;
$$;

create or replace function public.enforce_freemium_appointment_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_barbershop_can_create_appointment(new.barbershop_id);
  return new;
end;
$$;

drop trigger if exists appointments_enforce_freemium_limit on public.appointments;
create trigger appointments_enforce_freemium_limit
before insert on public.appointments
for each row execute function public.enforce_freemium_appointment_limit();

create or replace function public.admin_set_barbershop_plan_by_id(
  p_barbershop_id uuid,
  p_plan text
)
returns table (
  barbershop_id uuid,
  owner_id uuid,
  owner_email text,
  barbershop_name text,
  plan text,
  monthly_appointments integer,
  monthly_limit integer,
  limit_reached boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_plan not in ('free', 'pro') then
    raise exception 'Plano invalido. Use free ou pro.';
  end if;

  if not exists (
    select 1
    from public.barbershops
    where id = p_barbershop_id
  ) then
    raise exception 'Barbearia nao encontrada.';
  end if;

  insert into public.barbershop_plans (barbershop_id, plan)
  values (p_barbershop_id, p_plan)
  on conflict (barbershop_id)
  do update set plan = excluded.plan;

  return query
  select
    barbershops.id,
    barbershops.owner_id,
    auth.users.email::text,
    barbershops.name,
    barbershop_plans.plan,
    usage.monthly_appointments,
    usage.monthly_limit,
    usage.limit_reached
  from public.barbershops
  join auth.users
    on auth.users.id = barbershops.owner_id
  join public.barbershop_plans
    on barbershop_plans.barbershop_id = barbershops.id
  cross join lateral public.get_barbershop_plan_usage(barbershops.id) as usage
  where barbershops.id = p_barbershop_id;
end;
$$;

create or replace function public.admin_set_barbershop_plan_by_owner_email(
  p_owner_email text,
  p_plan text
)
returns table (
  barbershop_id uuid,
  owner_id uuid,
  owner_email text,
  barbershop_name text,
  plan text,
  monthly_appointments integer,
  monthly_limit integer,
  limit_reached boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  if p_plan not in ('free', 'pro') then
    raise exception 'Plano invalido. Use free ou pro.';
  end if;

  select id
  into v_owner_id
  from auth.users
  where lower(email) = lower(trim(p_owner_email))
  limit 1;

  if v_owner_id is null then
    raise exception 'Usuario nao encontrado para este e-mail.';
  end if;

  if not exists (
    select 1
    from public.barbershops
    where owner_id = v_owner_id
  ) then
    raise exception 'Este usuario ainda nao possui barbearia.';
  end if;

  insert into public.barbershop_plans (barbershop_id, plan)
  select id, p_plan
  from public.barbershops
  where owner_id = v_owner_id
  on conflict (barbershop_id)
  do update set plan = excluded.plan;

  return query
  select
    barbershops.id,
    barbershops.owner_id,
    auth.users.email::text,
    barbershops.name,
    barbershop_plans.plan,
    usage.monthly_appointments,
    usage.monthly_limit,
    usage.limit_reached
  from public.barbershops
  join auth.users
    on auth.users.id = barbershops.owner_id
  join public.barbershop_plans
    on barbershop_plans.barbershop_id = barbershops.id
  cross join lateral public.get_barbershop_plan_usage(barbershops.id) as usage
  where barbershops.owner_id = v_owner_id
  order by barbershops.created_at desc;
end;
$$;

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

  perform public.assert_barbershop_can_create_appointment(
    p_barbershop_id,
    'A agenda online desta barbearia atingiu o limite mensal gratuito. Fale com a barbearia pelo WhatsApp.'
  );

  if not exists (
    select 1
    from public.business_hours
    where barbershop_id = p_barbershop_id
      and weekday = extract(dow from p_appointment_date)::integer
      and active
      and p_appointment_time >= opens_at
      and (p_appointment_time + make_interval(mins => v_duration_minutes)) <= closes_at
  ) then
    raise exception 'Este horario fica fora do expediente da barbearia.';
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

  if exists (
    select 1
    from public.appointments
    left join public.services
      on services.id = appointments.service_id
    where appointments.barbershop_id = p_barbershop_id
      and appointments.appointment_date = p_appointment_date
      and appointments.status <> 'cancelled'
      and p_appointment_time < (
        appointments.appointment_time +
        make_interval(mins => coalesce(services.duration_minutes, 30))
      )
      and (p_appointment_time + make_interval(mins => v_duration_minutes)) >
        appointments.appointment_time
  ) then
    raise exception 'Este horario acabou de ser ocupado. Escolha outro.';
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

grant select, insert on public.barbershop_plans to authenticated;
grant execute on function public.count_barbershop_monthly_appointments(uuid) to anon, authenticated;
grant execute on function public.get_barbershop_plan_usage(uuid) to anon, authenticated;
grant execute on function public.assert_barbershop_can_create_appointment(uuid, text) to anon, authenticated;
grant execute on function public.create_public_appointment(uuid, uuid, date, time, text, text, text) to anon, authenticated;

revoke all on function public.admin_set_barbershop_plan_by_id(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_set_barbershop_plan_by_owner_email(text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
