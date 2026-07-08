begin;

-- 1. price (numeric euros) -> price_cents (integer, smallest unit) —
--    matches Stripe's convention and avoids decimal rounding issues.
alter table public.services
  add column price_cents integer;

update public.services
  set price_cents = round(price * 100)::integer;

alter table public.services
  alter column price_cents set not null,
  add constraint services_price_cents_check check (price_cents >= 0);

alter table public.services
  drop column price;

-- 2. currency — adding a column with a constant default backfills
--    existing rows automatically in Postgres, no separate update needed.
alter table public.services
  add column currency text not null default 'EUR';

-- 3. is_active — same automatic-backfill behavior.
alter table public.services
  add column is_active boolean not null default true;

commit;
