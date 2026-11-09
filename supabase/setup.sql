-- Trattoria 57: database setup. Paste ALL of this into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.

-- One table holds everything the app saves (orders, bookings, staff, shifts, settings, print jobs).
create table if not exists public.t57_docs (
  coll       text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);
create index if not exists t57_docs_coll_idx on public.t57_docs (coll);
create index if not exists t57_docs_date_idx on public.t57_docs ((data->>'date')) where coll = 'tickets';

-- Merge a few fields into a saved item (used when an order changes status, gets paid, is printed...).
create or replace function public.t57_merge(c text, i text, patch jsonb)
returns void language sql security invoker as $$
  insert into public.t57_docs (coll, id, data, updated_at) values (c, i, patch, now())
  on conflict (coll, id) do update set data = public.t57_docs.data || excluded.data, updated_at = now();
$$;

-- Trial access: the app (website, tablets, QR menu) can read and write with the publishable key.
alter table public.t57_docs enable row level security;
drop policy if exists "t57 app read"   on public.t57_docs;
drop policy if exists "t57 app insert" on public.t57_docs;
drop policy if exists "t57 app update" on public.t57_docs;
drop policy if exists "t57 app delete" on public.t57_docs;
create policy "t57 app read"   on public.t57_docs for select to anon, authenticated using (true);
create policy "t57 app insert" on public.t57_docs for insert to anon, authenticated with check (true);
create policy "t57 app update" on public.t57_docs for update to anon, authenticated using (true) with check (true);
create policy "t57 app delete" on public.t57_docs for delete to anon, authenticated using (true);
grant select, insert, update, delete on public.t57_docs to anon, authenticated;
grant execute on function public.t57_merge(text, text, jsonb) to anon, authenticated;

-- Live updates: other devices hear about changes instantly.
alter table public.t57_docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.t57_docs;
exception when duplicate_object then null; end $$;

select 'Trattoria 57 database ready ✓' as result;
