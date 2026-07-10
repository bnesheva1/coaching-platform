-- Critical fix: the "Users can update their own profile" RLS policy on
-- profiles only restricts WHICH ROW can be updated (auth.uid() = id) —
-- it says nothing about which COLUMNS. RLS and column-level grants are
-- separate Postgres mechanisms, and only the first was ever applied
-- here. Confirmed empirically: any authenticated client could call
-- `supabase.from("profiles").update({ role: "practitioner" })` on their
-- own row directly (bypassing the app entirely, which never touches
-- role after signup) and it succeeded. That's a real privilege
-- escalation — it grants every practitioner-only capability, including
-- (via is_practitioner()) read access to every real client's display
-- name, a permission that's supposed to require actually being a
-- practitioner.
--
-- Fix: restrict authenticated's UPDATE grant to just the column that
-- should ever be user-editable. The app (saveProfile in
-- app/[locale]/practitioner-dashboard/actions.ts) only ever updates
-- display_name — this doesn't take anything away from legitimate use.

revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;
