-- Trattoria 57: TABLE BOOKINGS FROM THE PUBLIC WEBSITE.
-- Paste ALL of this into Supabase → SQL Editor → New query → Run.   Safe to run more than once.
--
-- When a customer books on the website, this looks at the restaurant app's floor plan for that night
-- and puts the booking straight onto the smallest free DINING ROOM table that fits them (status "pending").
-- A table holds one booking for the whole evening, like in the app. Tables already booked, and walk-ins,
-- count as taken, so the website can never overbook. Bar tables are kept for walk-ins.
-- If nothing fits, the website tells the customer to call.
--
-- The website can't read anything or change anything else. It only gets back true (booked), null (full) or false (error).

drop function if exists public.t57_web_book(jsonb);

create or replace function public.t57_web_book(r jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  d date; t text; n int; nm text; ph text; em text; nt text; digits text;
  plan jsonb; bk jsonb; grp jsonb; k text; v jsonb;
  dining int[] := array[10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25];   -- 1A,1B,2,3..9,10A,10B,11A,11B,12,13
  seats int[]  := array[2,2,2,2,2,4,2,2,4,4,4,4,4,4,4,4,4,4,4,4,2,4,2,4,4];  -- seats of tables 1..25
  names text[] := array['B1','B2','B3','B4','B5','B6','B7','B8','B9','1A','1B','2','3','4','5','6','7','8','9','10A','10B','11A','11B','12','13'];
  u jsonb; ids int[]; i int; s int; best_lead int := 0; best_seats int := 999; best_name text;
  used int[] := '{}'; booking jsonb;
begin
  if r is null or length(r::text) > 2000 then return false; end if;
  begin d := (r ->> 'date')::date; exception when others then return false; end;
  t  := coalesce(r ->> 'time', '');
  n  := case when (r ->> 'size') ~ '^\d{1,2}$' then (r ->> 'size')::int else 0 end;
  nm := left(btrim(coalesce(r ->> 'name', '')), 60);
  ph := left(btrim(coalesce(r ->> 'phone', '')), 30);
  em := left(btrim(coalesce(r ->> 'email', '')), 80);
  nt := left(btrim(coalesce(r ->> 'notes', '')), 180);
  digits := regexp_replace(ph, '\D', '', 'g');

  -- sensible bookings only
  if d < (now() at time zone 'Europe/London')::date or d > (now() at time zone 'Europe/London')::date + 120 then return false; end if;
  if t !~ '^([01]\d|2[0-3]):[0-5]\d$' then return false; end if;
  if n < 1 or n > 20 or nm = '' or length(digits) < 10 then return false; end if;
  if em <> '' and em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return false; end if;

  -- stop floods: at most 3 bookings a day from one phone number, and 30 an hour in total
  if (select count(*) from t57_docs where coll = 'webbook' and data ->> 'digits' = digits and updated_at > now() - interval '1 day') >= 3 then return false; end if;
  if (select count(*) from t57_docs where coll = 'webbook' and updated_at > now() - interval '1 hour') >= 30 then return false; end if;

  -- that night's floor plan, locked so two website bookings can't take the same table at once
  insert into t57_docs (coll, id, data, updated_at) values ('plan23', d::text, '{}'::jsonb, now()) on conflict do nothing;
  select data into plan from t57_docs where coll = 'plan23' and id = d::text for update;

  -- the bookings as the app sees them: "bookings" plus later "b:<table>" changes (null = removed)
  bk := coalesce(plan -> 'bookings', '{}'::jsonb);
  for k, v in select * from jsonb_each(plan) loop
    if k like 'b:%' then
      if jsonb_typeof(v) = 'object' then bk := bk || jsonb_build_object(substr(k, 3), v); else bk := bk - substr(k, 3); end if;
    end if;
  end loop;

  -- joined tables that night (1A+1B, 10A+10B and 11A+11B are joined unless staff split them)
  grp := case when jsonb_typeof(plan -> 'groups') = 'array' then plan -> 'groups' else '[[10,11],[20,21],[22,23]]'::jsonb end;

  -- each joined group, then every table not in a group
  for u in select * from jsonb_array_elements(grp) loop
    if jsonb_typeof(u) <> 'array' then continue; end if;
    select array_agg(x::int) into ids from jsonb_array_elements_text(u) as x where x ~ '^\d{1,2}$' and x::int between 1 and 25 and not (x::int = any(used));
    if ids is null or array_length(ids, 1) < 2 then continue; end if;
    used := used || ids;
    -- a group counts only if every table in it is in the dining room and none is booked
    if not (ids <@ dining) then continue; end if;
    if exists (select 1 from unnest(ids) as x where bk ? x::text and coalesce(bk -> x::text ->> 'status', '') <> 'cancelled') then continue; end if;
    s := (select sum(seats[x]) from unnest(ids) as x);
    if s >= n and (s < best_seats or (s = best_seats and (select min(x) from unnest(ids) as x) < best_lead)) then
      best_seats := s; best_lead := (select min(x) from unnest(ids) as x);
      best_name := 'Table ' || (select string_agg(names[x], '+' order by x) from unnest(ids) as x);
    end if;
  end loop;
  foreach i in array dining loop
    if i = any(used) then continue; end if;
    if bk ? i::text and coalesce(bk -> i::text ->> 'status', '') <> 'cancelled' then continue; end if;
    s := seats[i];
    if s >= n and (s < best_seats or (s = best_seats and i < best_lead)) then
      best_seats := s; best_lead := i; best_name := 'Table ' || names[i];
    end if;
  end loop;
  best_name := replace(replace(replace(best_name, '1A+1B', '1'), '10A+10B', '10'), '11A+11B', '11');

  -- keep a record (also used for the flood limits above)
  insert into t57_docs (coll, id, data, updated_at) values ('webbook',
    to_char(now() at time zone 'Europe/London', 'YYYYMMDD-HH24MISS') || '-' || substr(md5(random()::text), 1, 6),
    jsonb_build_object('date', d::text, 'time', t, 'size', n, 'name', nm, 'phone', ph, 'digits', digits,
                       'email', em, 'notes', nt, 'status', case when best_lead > 0 then 'placed' else 'full' end, 'auto', true,
                       'table', coalesce(best_name, ''), 'at', (extract(epoch from now()) * 1000)::bigint),
    now());

  if best_lead = 0 then return null; end if;

  -- put it on the table, the same way a tablet saves a booking
  booking := jsonb_build_object('time', t, 'notes', left('Website' || case when nt <> '' then ': ' || nt else '' end, 200),
    'guests', jsonb_build_array(jsonb_build_object('name', nm, 'phone', ph)), 'email', em, 'size', n, 'walkin', false,
    'status', 'pending', 'sentOwner', 0, 'sentCustomer', 0, 'reminded', 0);
  update t57_docs set data = data || jsonb_build_object('b:' || best_lead, booking, 'updatedAt', (extract(epoch from now()) * 1000)::bigint),
    updated_at = now() where coll = 'plan23' and id = d::text;
  return true;
end $$;

revoke all on function public.t57_web_book(jsonb) from public;
grant execute on function public.t57_web_book(jsonb) to anon, authenticated;

select 'Website bookings ready ✓' as result;
