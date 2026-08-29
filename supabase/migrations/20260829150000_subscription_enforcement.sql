-- Practitioner subscription billing — enforcement (slice 2 of 3).
--
-- Slice 1 laid down subscription_status but nothing acted on it. This slice
-- folds it into the SINGLE bookable derivation, exactly the way the moderation
-- ladder (20260815140000) folded moderation_status in — compose, don't fork.
--
-- Only 'lapsed' restricts ("lapse-only"): a practitioner whose previously-active
-- subscription failed past the grace period is not bookable and not findable.
-- 'not_required' (never subscribed), 'active', 'grace' (Stripe still retrying),
-- and 'exempt' (charged nothing, but subscribed-and-active) all stay bookable
-- and findable — so a never-subscribed practitioner is completely unaffected.
--
-- Both functions keep their exact signatures, so CREATE OR REPLACE suffices (no
-- drop/recreate cascade to get_my_bookable_status / search_practitioners). The
-- lapsed state deliberately mirrors 'suspended' VISIBILITY (not bookable + not
-- findable) but NOT its dashboard lock — a lapsed practitioner can still log in,
-- edit everything, and stays visible to anyone who saved them (profile-by-URL
-- has no gate). Their existing bookings are untouched (separate rows). Fully
-- reversible: a paid invoice flips the status back and lifts both restrictions.

begin;

-- ── Fold subscription into the bookable derivation ──────────────────
-- One new internal condition (subscription_ok), AND-ed into is_bookable
-- alongside not_moderated. Reproduces 20260815140000's body verbatim with the
-- one line added; RETURNS TABLE is unchanged (subscription_ok is not exposed as
-- an output column — the practitioner learns WHY via the SubscriptionNotice
-- banner + get_my_subscription_context, the same way get_my_moderation_status
-- carries the moderation explanation).
create or replace function public.practitioner_bookable_flags(target_practitioner_id uuid)
returns table (
  profile_complete boolean,
  has_active_service boolean,
  availability_set boolean,
  connect_ready boolean,
  is_bookable boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with flags as (
    select
      (
        pp.avatar_url is not null and pp.avatar_url <> ''
        and pp.bio is not null and pp.bio <> ''
        and pp.headline is not null and pp.headline <> ''
        and pp.location is not null and pp.location <> ''
        and coalesce(array_length(pp.specialties, 1), 0) > 0
      ) as profile_complete,
      exists (
        select 1 from public.services s
        where s.practitioner_id = pp.id and s.is_active = true
      ) as has_active_service,
      exists (
        select 1 from public.practitioner_availability pa
        where pa.practitioner_id = pp.id
      ) as availability_set,
      case
        when pp.billing_model = 'commission' then coalesce(pp.stripe_connect_transfers_active, false)
        else true
      end as connect_ready,
      (pp.moderation_status not in ('bookings_frozen', 'suspended')) as not_moderated,
      -- NEW: a lapsed subscription (previously active, failed past grace) stops
      -- new bookings. Lapse-only — every other status passes.
      (pp.subscription_status <> 'lapsed') as subscription_ok
    from public.practitioner_profiles pp
    where pp.id = target_practitioner_id
  )
  select
    profile_complete, has_active_service, availability_set, connect_ready,
    profile_complete and has_active_service and availability_set and connect_ready
      and not_moderated and subscription_ok
  from flags
$$;

-- ── Fold subscription into search visibility ────────────────────────
-- A lapsed practitioner drops out of browse/search too (same as suspended).
-- Same signature — CREATE OR REPLACE. Grants are unchanged by a replace.
create or replace function public.is_practitioner_searchable(target_practitioner_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select moderation_status not in ('hidden', 'suspended')
    and subscription_status <> 'lapsed'
  from public.practitioner_profiles
  where id = target_practitioner_id
$$;

commit;
