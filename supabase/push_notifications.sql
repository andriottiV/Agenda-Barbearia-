begin;

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

alter table public.push_subscriptions enable row level security;

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

grant select, insert, update, delete on public.push_subscriptions to authenticated;

notify pgrst, 'reload schema';

commit;
