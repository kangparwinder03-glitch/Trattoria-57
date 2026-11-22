-- Trattoria 57: TABLE BOOKINGS FROM THE PUBLIC WEBSITE.
-- Paste ALL of this into Supabase → SQL Editor → New query → Run.   Safe to run more than once.
--
-- The website can only ADD a booking request. It can't read anything, change anything or see other bookings.
-- Requests land in "webbook" and show on the tablets under Bookings → "From the website", where staff give them a table.

create or replace function public.t57_web_book(r jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  d date; t text; n int; nm text; ph text; em text; nt text; digits text;
begin
  if r is null or length(r::text) > 2000 then return false; end if;
  begin d := (r ->> 'date')::date; exception when others then return false; end;
  t  := coalesce(r ->> 'time', '');
  n  := case when (r ->> 'size') ~ '^\d{1,2}$' then (r ->> 'size')::int else 0 end;
  nm := left(btrim(coalesce(r ->> 'name', '')), 60);
  ph := left(btrim(coalesce(r ->> 'phone', '')), 30);
  em := left(btrim(coalesce(r ->> 'email', '')), 80);
  nt := left(btrim(coalesce(r ->> 'notes', '')), 200);
  digits := regexp_replace(ph, '\D', '', 'g');

  -- sensible bookings only
  if d < (now() at time zone 'Europe/London')::date or d > (now() at time zone 'Europe/London')::date + 120 then return false; end if;
  if t !~ '^([01]\d|2[0-3]):[0-5]\d$' then return false; end if;
  if n < 1 or n > 20 or nm = '' or length(digits) < 10 then return false; end if;
  if em <> '' and em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return false; end if;

  -- stop floods: at most 3 requests a day from one phone number, and 30 an hour in total
  if (select count(*) from t57_docs where coll = 'webbook' and data ->> 'digits' = digits and updated_at > now() - interval '1 day') >= 3 then return false; end if;
  if (select count(*) from t57_docs where coll = 'webbook' and updated_at > now() - interval '1 hour') >= 30 then return false; end if;

  insert into t57_docs (coll, id, data, updated_at) values ('webbook',
    to_char(now() at time zone 'Europe/London', 'YYYYMMDD-HH24MISS') || '-' || substr(md5(random()::text), 1, 6),
    jsonb_build_object('date', d::text, 'time', t, 'size', n, 'name', nm, 'phone', ph, 'digits', digits,
                       'email', em, 'notes', nt, 'status', 'new', 'at', (extract(epoch from now()) * 1000)::bigint),
    now());
  return true;
end $$;

revoke all on function public.t57_web_book(jsonb) from public;
grant execute on function public.t57_web_book(jsonb) to anon, authenticated;

select 'Website bookings ready ✓' as result;
