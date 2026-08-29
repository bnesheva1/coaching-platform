-- Per-practitioner commission-rate override.
--
-- COMMISSION_RATE stays the brand default (deployment env). This adds a
-- NULLABLE per-practitioner override on practitioner_profiles — null means
-- "use the brand default", a value means "use that rate", including 0 —
-- so early practitioners recruited on reduced/free terms carry those terms
-- with them, no redeploy or migration when the default changes. Mirrors the
-- max_price_cents override precedent (20260803151500): nullable, no default,
-- and deliberately NOT added to any client grant (admin-set business rule;
-- resolved server-side via the service-role read in initiateBookingPayment,
-- surfaced to admins via admin_list_practitioners).
--
-- Alongside the override we record WHY (reason + who + when), same shape as
-- the moderation control quartet (20260815140000) — an unexplained 0% rate
-- six months from now is a mystery.
--
-- The resolved rate is snapshotted onto the payment (payments.commission_rate)
-- so a later change to a practitioner's rate never alters what was already
-- charged — same discipline as price/duration.

begin;

-- ── practitioner_profiles: the override the admin sets ───────────────
alter table public.practitioner_profiles
  add column commission_rate_override numeric
    constraint practitioner_profiles_commission_rate_override_range
    check (commission_rate_override is null or (commission_rate_override >= 0 and commission_rate_override <= 1)),
  add column commission_rate_reason text,
  add column commission_rate_set_by uuid references auth.users(id),
  add column commission_rate_set_at timestamptz;

-- Deliberately NOT granted to anon/authenticated — admin-only, read via the
-- service role at booking time and via admin_list_practitioners for display.

-- ── payments: the snapshotted rate ──────────────────────────────────
-- Nullable (null on historical rows); the fraction actually applied to this
-- charge, frozen beside the existing commission_cents amount.
alter table public.payments
  add column commission_rate numeric
    constraint payments_commission_rate_range
    check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 1));

-- ── confirm_paid_booking: carry + snapshot the rate ─────────────────
-- Adding a parameter changes the function's argument signature, which would
-- otherwise create a second overload; drop the old signature first, then
-- recreate. p_commission_rate defaults null for safety (a caller that hasn't
-- been updated still records a correct commission_cents, just no rate). This
-- otherwise reproduces the current definition verbatim
-- (20260826120000_service_documents_enabled.sql) with the new column added to
-- the payments insert.
drop function if exists public.confirm_paid_booking(uuid, uuid, uuid, timestamptz, text, integer, integer, text, text);

create function public.confirm_paid_booking(
  p_practitioner_id uuid,
  p_client_id uuid,
  p_service_id uuid,
  p_start_utc timestamptz,
  p_checkout_session_id text,
  p_amount_cents integer,
  p_commission_cents integer,
  p_currency text,
  p_payment_intent_id text,
  p_commission_rate numeric default null
)
returns table (booking_id uuid, already_processed boolean, failure_reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_booking_id uuid;
  v_service record;
  v_min_notice_hours integer;
  v_end_utc timestamptz;
  v_new_booking_id uuid;
begin
  select p.booking_id into v_existing_booking_id
  from public.payments p
  where p.stripe_checkout_session_id = p_checkout_session_id;

  if found then
    return query select v_existing_booking_id, true, null::text;
    return;
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = p_client_id and p.role = 'client'
  ) then
    return query select null::uuid, false, 'client_role_required'::text;
    return;
  end if;

  select s.name, s.duration_minutes, s.is_active, s.price_cents,
         s.delivery_type, s.phone_number, s.meeting_link, s.delivery_info,
         s.documents_enabled
  into v_service
  from public.services s
  where s.id = p_service_id and s.practitioner_id = p_practitioner_id;

  if not found or not v_service.is_active then
    return query select null::uuid, false, 'service_unavailable'::text;
    return;
  end if;

  if v_service.price_cents <> p_amount_cents then
    return query select null::uuid, false, 'amount_mismatch'::text;
    return;
  end if;

  select coalesce(pp.min_notice_hours, 24) into v_min_notice_hours
  from public.practitioner_profiles pp
  where pp.id = p_practitioner_id;

  if p_start_utc < now() + (v_min_notice_hours * interval '1 hour') then
    return query select null::uuid, false, 'notice_window_passed'::text;
    return;
  end if;

  v_end_utc := p_start_utc + (v_service.duration_minutes * interval '1 minute');

  insert into public.bookings (
    practitioner_id, client_id, service_id, start_utc, end_utc, status,
    delivery_type, phone_number, meeting_link,
    service_name, price_cents, currency, delivery_info, documents_enabled
  )
  values (
    p_practitioner_id, p_client_id, p_service_id, p_start_utc, v_end_utc, 'confirmed',
    v_service.delivery_type, v_service.phone_number, v_service.meeting_link,
    v_service.name, p_amount_cents, p_currency, v_service.delivery_info, v_service.documents_enabled
  )
  returning id into v_new_booking_id;

  insert into public.payments (
    booking_id, stripe_checkout_session_id, amount_cents, commission_cents,
    commission_rate, currency, status, provider_ref
  )
  values (
    v_new_booking_id, p_checkout_session_id, p_amount_cents, p_commission_cents,
    p_commission_rate, p_currency, 'succeeded',
    jsonb_build_object('payment_intent_id', p_payment_intent_id)
  );

  return query select v_new_booking_id, false, null::text;
exception
  when exclusion_violation then
    return query select null::uuid, false, 'slot_taken'::text;
end;
$$;

revoke all on function public.confirm_paid_booking(uuid, uuid, uuid, timestamptz, text, integer, integer, text, text, numeric)
  from public, authenticated, anon;
grant execute on function public.confirm_paid_booking(uuid, uuid, uuid, timestamptz, text, integer, integer, text, text, numeric)
  to service_role;

-- ── admin_list_practitioners: surface the override ──────────────────
-- RETURNS TABLE changes (three new columns), so drop + recreate. Otherwise
-- identical to 20260815140000. The brand-default rate is computed in TS from
-- COMMISSION_RATE and combined with the override for the effective-rate
-- display; SQL only returns the raw override + its reason/when.
drop function if exists public.admin_list_practitioners(text);

create function public.admin_list_practitioners(search text default null)
returns table (
  id uuid,
  username text,
  display_name text,
  moderation_status text,
  payouts_frozen boolean,
  is_bookable boolean,
  connect_transfers_active boolean,
  billing_model text,
  has_connect_account boolean,
  upcoming_count bigint,
  total_sessions bigint,
  average_rating numeric,
  review_count bigint,
  commission_rate_override numeric,
  commission_rate_reason text,
  commission_rate_set_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    pp.id,
    pp.username,
    p.display_name,
    pp.moderation_status,
    pp.payouts_frozen,
    public.is_practitioner_bookable(pp.id),
    pp.stripe_connect_transfers_active,
    pp.billing_model,
    pp.stripe_connected_account_id is not null,
    coalesce(ub.cnt, 0),
    coalesce(ts.cnt, 0),
    r.average_rating,
    coalesce(r.review_count, 0),
    pp.commission_rate_override,
    pp.commission_rate_reason,
    pp.commission_rate_set_at
  from public.practitioner_profiles pp
  join public.profiles p on p.id = pp.id
  left join (
    select practitioner_id, count(*) as cnt
    from public.bookings
    where start_utc > now() and status in ('pending', 'confirmed')
    group by practitioner_id
  ) ub on ub.practitioner_id = pp.id
  left join (
    select practitioner_id, count(*) as cnt
    from public.bookings
    where status = 'completed'
    group by practitioner_id
  ) ts on ts.practitioner_id = pp.id
  left join (
    select practitioner_id, avg(rating)::numeric(3, 2) as average_rating, count(*) as review_count
    from public.reviews
    group by practitioner_id
  ) r on r.practitioner_id = pp.id
  where p.role = 'practitioner'
    and (
      search is null or search = ''
      or p.display_name ilike '%' || search || '%'
      or pp.username ilike '%' || search || '%'
    )
  order by p.display_name;
$$;

commit;
