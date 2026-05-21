-- HoraAi Mercado Pago recurring billing
-- Run this file after supabase/freemium.sql.

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null default 'pro' check (plan in ('free', 'pro')),
  status text not null default 'pending',
  mp_customer_id text,
  mp_subscription_id text unique,
  next_payment_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.subscriptions
add column if not exists next_payment_date timestamptz;

create index if not exists subscriptions_user_id_idx
on public.subscriptions (user_id);

create index if not exists subscriptions_mp_subscription_id_idx
on public.subscriptions (mp_subscription_id);

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions owner read" on public.subscriptions;
create policy "subscriptions owner read"
on public.subscriptions for select
using (auth.uid() = user_id);

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create or replace function public.sync_user_barbershop_plan(
  p_user_id uuid,
  p_plan text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_plan not in ('free', 'pro') then
    raise exception 'Plano invalido. Use free ou pro.';
  end if;

  insert into public.barbershop_plans (barbershop_id, plan)
  select id, p_plan
  from public.barbershops
  where owner_id = p_user_id
  on conflict (barbershop_id)
  do update set plan = excluded.plan;
end;
$$;

grant select on public.subscriptions to authenticated;

revoke all on function public.sync_user_barbershop_plan(uuid, text) from public, anon, authenticated;
grant execute on function public.sync_user_barbershop_plan(uuid, text) to service_role;

notify pgrst, 'reload schema';
