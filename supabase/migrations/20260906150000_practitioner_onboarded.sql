begin;

-- "Onboarded" = the practitioner finished the setup checklist: a complete profile
-- (identity + >=1 specialty), >=1 active service, availability set, and Connect
-- ready (commission model). It is the ONBOARDING subset of practitioner_bookable_flags
-- — the same four flags the dashboard checklist and get_my_bookable_status already
-- expose — and deliberately NOT is_bookable: it stays orthogonal to the transient
-- moderation/subscription conditions, so a set-up-but-lapsed practitioner with
-- outstanding bookings is still reachable by URL through is_practitioner_fully_hidden's
-- own logic. Onboarding-incompleteness is a different, "never published" reason.
--
-- Exposed as a BOOLEAN only, exactly like is_practitioner_bookable: a caller learns
-- whether the profile is published, never WHICH checklist step is missing (that
-- detail stays owner-only via get_my_bookable_status). practitioner_bookable_flags
-- itself remains revoked from anon/authenticated (20260803141500), so this must be
-- its own security-definer function rather than the page reading the sub-flags.
--
-- Drives the public profile URL: a not-yet-onboarded profile — e.g. one carrying
-- only pending taxonomy suggestions, so profile_complete is false because it has no
-- real specialty — is served the same neutral "not currently listed" notice instead
-- of rendering as a live profile. This matches its existing absence from Browse and
-- the sitemap (both gate on is_practitioner_bookable, which requires these same four
-- flags), so it's one reuse of the checklist gate, not a second visibility mechanism.
-- The moment an admin tags the profile with a real domain + specialty (and the other
-- steps are done), profile_complete flips true and the profile goes live through the
-- normal path — no separate publish step.
create or replace function public.is_practitioner_onboarded(target_practitioner_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select profile_complete and has_active_service and availability_set and connect_ready
  from public.practitioner_bookable_flags(target_practitioner_id)
$$;

grant execute on function public.is_practitioner_onboarded(uuid) to anon, authenticated;

commit;
