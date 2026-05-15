begin;

alter table public.services
add column if not exists display_order integer not null default 0;

alter table public.clients
add column if not exists notes text;

alter table public.clients
add column if not exists preferred_frequency_days integer;

alter table public.clients
add column if not exists deleted_at timestamptz;

alter table public.appointments
add column if not exists reminder_sent_at timestamptz;

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

alter table public.business_settings enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

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
grant select, insert, update, delete on public.business_settings to authenticated;
grant select, update on public.notifications to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update on public.clients to authenticated;
grant select, insert, update on public.appointments to authenticated;
grant insert, update, delete on public.barbershops to authenticated;
grant insert, update, delete on public.services to authenticated;
grant insert, update, delete on public.business_hours to authenticated;
grant execute on function public.create_new_appointment_notification(uuid, uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
