-- Simplification pass: enforce a real minimum price. The original
-- constraint (services_price_cents_check) only ever asserted >= 0, so
-- a service at €0.01 was accepted. €20 = 2000 cents.
--
-- No existing row violates this (confirmed live: zero services with
-- price_cents < 2000 as of this migration), so no data sanitization
-- step is needed.

begin;

alter table public.services
  drop constraint services_price_cents_check;

alter table public.services
  add constraint services_price_cents_check
  check (price_cents >= 2000);

commit;
