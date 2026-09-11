-- Manual admin-review gate: new practitioner profiles start `pending` and stay
-- out of search AND booking until an admin approves them — matching the shipped
-- promise that "every new profile is personally reviewed by our team before it
-- becomes visible to seekers." (Before this, moderation_status defaulted to
-- `active`, so new profiles went live with no review — a gap between copy and
-- behaviour.)
--
-- States (moderation_status): `active` stays the approved/live state; two new
-- pre-approval states are added —
--   pending            default for every new profile. It sits here UNSUBMITTED
--                      (review_submitted_at null = draft, NOT in the admin queue)
--                      until the practitioner clicks "Submit for review" (which
--                      stamps review_submitted_at and surfaces it to admins).
--   changes_requested  an admin sent it back with a reason (moderation_reason);
--                      the practitioner edits and resubmits (→ pending).
-- hidden / bookings_frozen / suspended are unchanged post-approval controls.
--
-- Grandfathering: existing rows are left untouched (all currently `active`, i.e.
-- already vetted/live). Only NEW rows take the new `pending` default.

begin;

-- 1. Widen the allowed values + default new profiles to pending.
alter table public.practitioner_profiles
  drop constraint practitioner_profiles_moderation_status_check;
alter table public.practitioner_profiles
  add constraint practitioner_profiles_moderation_status_check
  check (moderation_status in ('pending', 'active', 'changes_requested', 'hidden', 'bookings_frozen', 'suspended'));
alter table public.practitioner_profiles
  alter column moderation_status set default 'pending';

-- 2. When the practitioner asked for review: null = draft (not yet in the
--    queue), set = submitted (appears in the admin queue). Admin-visibility
--    only — deliberately NO anon/authenticated grant; the owner sets it solely
--    through submit_practitioner_for_review() below.
alter table public.practitioner_profiles
  add column review_submitted_at timestamptz;

-- 3. Exclude the two pre-approval states from search + booking, alongside the
--    existing exclusions. Recreated verbatim from 20260829150000 with only the
--    exclusion lists widened (pending + changes_requested added).
create or replace function public.is_practitioner_searchable(target_practitioner_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select moderation_status not in ('hidden', 'suspended', 'pending', 'changes_requested')
    and subscription_status <> 'lapsed'
  from public.practitioner_profiles
  where id = target_practitioner_id
$$;

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
      (pp.moderation_status not in ('bookings_frozen', 'suspended', 'pending', 'changes_requested')) as not_moderated,
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

-- 4. Owner-scoped "submit for review": moves the caller from pending (draft) or
--    changes_requested into the queue (pending + a fresh submitted stamp), and
--    clears any prior changes-requested reason. Can ONLY reach `pending` and
--    ONLY from a pre-approval state — it can never self-approve or escape
--    hidden/suspended. moderation_status has no owner column grant, which is why
--    this is a SECURITY DEFINER RPC.
create or replace function public.submit_practitioner_for_review()
returns void
language sql
security definer
set search_path = public
as $$
  update public.practitioner_profiles
  set moderation_status = 'pending',
      review_submitted_at = now(),
      moderation_reason = null
  where id = auth.uid()
    and moderation_status in ('pending', 'changes_requested');
$$;

grant execute on function public.submit_practitioner_for_review() to authenticated;

-- 5. get_my_moderation_status gains review_submitted_at so the dashboard notice
--    can distinguish "draft (show the submit prompt)" from "submitted (in
--    review)". Changing a RETURNS TABLE shape needs DROP + recreate.
drop function public.get_my_moderation_status();
create function public.get_my_moderation_status()
returns table (
  moderation_status text,
  moderation_reason text,
  payouts_frozen boolean,
  payouts_reason text,
  review_submitted_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select moderation_status, moderation_reason, payouts_frozen, payouts_reason, review_submitted_at
  from public.practitioner_profiles
  where id = auth.uid()
$$;

grant execute on function public.get_my_moderation_status() to authenticated;

commit;
