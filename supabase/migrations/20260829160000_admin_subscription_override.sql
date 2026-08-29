-- Practitioner subscription billing — admin surface (slice 3 of 3).
--
-- Surfaces subscription state + the admin override on the practitioner list.
-- The override columns (exempt / custom price / reason / who / when) were added
-- in 20260829140000 with NO client grant — read here via the service role, the
-- same way the commission override is. Setting them is done in the
-- setSubscriptionOverride server action (requireAdmin), mirroring
-- setCommissionOverride — a SEPARATE axis from commission (same person, two
-- independent controls).
--
-- admin_list_practitioners' RETURNS TABLE changes, so drop + recreate. This
-- reproduces the commission version (20260829120000) VERBATIM and adds the six
-- subscription columns.

begin;

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
  commission_rate_set_at timestamptz,
  subscription_status text,
  subscription_exempt boolean,
  subscription_current_period_end timestamptz,
  subscription_price_override_cents integer,
  subscription_override_reason text,
  subscription_override_set_at timestamptz
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
    pp.commission_rate_set_at,
    pp.subscription_status,
    pp.subscription_exempt,
    pp.subscription_current_period_end,
    pp.subscription_price_override_cents,
    pp.subscription_override_reason,
    pp.subscription_override_set_at
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
