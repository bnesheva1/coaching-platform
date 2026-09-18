-- Fix for 20260918120000: the tin format CHECK allowed an orphan tin_type with a
-- NULL tin. Reason: for {tin: null, tin_type: 'egn'} the branch
-- `tin_type = 'egn' and tin ~ '^[0-9]{10}$'` evaluates to NULL (null ~ regex is
-- NULL), and a CHECK constraint only REJECTS on FALSE — NULL passes. So the
-- "set together" guarantee didn't hold (caught by verify-tin-security.mjs).
--
-- Guard each value branch with `tin is not null` so it short-circuits to FALSE
-- (not NULL) when the value is missing, making the orphan case a hard reject.

begin;

alter table public.practitioner_profiles drop constraint practitioner_tin_format;

-- Sanitise rows the stricter constraint would reject before adding it. The only
-- way such a row exists is a direct write under the OLD (leaky) constraint — the
-- app always sets tin + tin_type together. Clear a dangling half so the row is
-- cleanly "no TIN" (both null) rather than a partial one.
update public.practitioner_profiles set tin_type = null where tin is null and tin_type is not null;
update public.practitioner_profiles set tin = null where tin is not null and tin_type is null;

alter table public.practitioner_profiles add constraint practitioner_tin_format check (
  (tin is null and tin_type is null)
  or (tin is not null and tin_type = 'egn' and tin ~ '^[0-9]{10}$')
  or (tin is not null and tin_type = 'vat' and tin ~ '^BG[0-9]{9,10}$')
);

commit;
