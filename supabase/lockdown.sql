-- Trattoria 57: LOCKDOWN — only your signed-in tablets can read or change the restaurant's data.
-- BEFORE running this: Supabase → Authentication → Users → "Add user" → "Create new user",
--   type the restaurant email + a strong password, tick "Auto Confirm User", Create.
-- THEN paste ALL of this into Supabase → SQL Editor → New query → Run.   Safe to run more than once.

-- 1. Who may sign in: every login that exists right now (the restaurant one you just made).
create table if not exists public.t57_logins (email text primary key);
alter table public.t57_logins enable row level security;            -- nobody can read this list from outside
insert into public.t57_logins (email)
  select lower(email) from auth.users where email is not null
  on conflict do nothing;

create or replace function public.t57_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.t57_logins where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- 2. Lock the data table: signed-in restaurant devices only.
alter table public.t57_docs enable row level security;
drop policy if exists "t57 app read"   on public.t57_docs;
drop policy if exists "t57 app insert" on public.t57_docs;
drop policy if exists "t57 app update" on public.t57_docs;
drop policy if exists "t57 app delete" on public.t57_docs;
drop policy if exists "t57 staff only" on public.t57_docs;
create policy "t57 staff only" on public.t57_docs for all to authenticated
  using ((select public.t57_ok())) with check ((select public.t57_ok()));
revoke all on public.t57_docs from anon;
grant select, insert, update, delete on public.t57_docs to authenticated;
revoke execute on function public.t57_merge(text, text, jsonb) from anon, public;
grant execute on function public.t57_merge(text, text, jsonb) to authenticated;

-- 3. Customers' phones (table QR menu): can only see what the menu page needs —
--    is the table open, its orders (no names/phones), sold-out items, menu prices —
--    and can only ADD a new order (always held for staff to approve) or a waiter call.
create or replace function public.t57_guest(ns text, d text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p text := case when ns = 'train' then 'train_' else '' end; plan jsonb;
begin
  select data into plan from t57_docs where coll = p || 'plan23' and id = d;
  if plan is not null then
    plan := (plan - 'done') || jsonb_build_object('bookings', coalesce((
      select jsonb_object_agg(k, jsonb_build_object('status', v -> 'status', 'walkin', v -> 'walkin', 'time', v -> 'time', 'size', v -> 'size'))
      from jsonb_each(coalesce(plan -> 'bookings', '{}'::jsonb)) as e(k, v)), '{}'::jsonb));
  end if;
  return jsonb_build_object(
    'plan', plan,
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'data', data - 'pname' - 'pphone' - 'payNote'))
                         from t57_docs where coll = p || 'tickets' and data ->> 'date' = d), '[]'::jsonb),
    'calls', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'data', data)) from t57_docs
                       where coll = p || 'calls' and updated_at > now() - interval '4 hours'), '[]'::jsonb),
    'stock', (select data from t57_docs where coll = p || 'stock' and id = 'main'),
    'menu',  (select data from t57_docs where coll = 'settings' and id = 'menu'),
    'main',  (select data - 'ownerEmail' from t57_docs where coll = 'settings' and id = 'main'),
    'live',  (select data from t57_docs where coll = 'settings' and id = 'live'));
end $$;

create or replace function public.t57_guest_put(c text, i text, d jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if i is null or length(i) > 60 or d is null or length(d::text) > 20000 then return false; end if;
  if c in ('tickets', 'train_tickets') then
    if coalesce(d ->> 'qr', '') <> 'true' or coalesce(d ->> 'hold', '') <> 'true' then return false; end if;
  elsif c not in ('calls', 'train_calls') then
    return false;
  end if;
  insert into t57_docs (coll, id, data, updated_at) values (c, i, d, now()) on conflict do nothing;
  return true;
end $$;

-- Tells the app the lockdown is on (so tablets show the sign-in screen if they're not signed in).
create or replace function public.t57_locked() returns boolean language sql stable as $$ select true $$;

grant execute on function public.t57_guest(text, text) to anon, authenticated;
grant execute on function public.t57_guest_put(text, text, jsonb) to anon, authenticated;
grant execute on function public.t57_locked() to anon, authenticated;

select 'Locked down ✓ — signed-in logins allowed: ' || (select string_agg(email, ', ') from public.t57_logins) as result;
