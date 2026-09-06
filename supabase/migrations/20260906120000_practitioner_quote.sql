begin;

-- Optional pull-quote shown in the profile's coloured quote box (brand two's
-- About column). Public like bio/headline; owner-writable. Nullable — most
-- practitioners won't set one, and an empty box is simply not rendered.
alter table public.practitioner_profiles
  add column quote text;

-- Length cap, mirroring headline/bio (app-layer validation too). A pull-quote
-- is short by design.
alter table public.practitioner_profiles
  add constraint practitioner_profiles_quote_length_check
  check (length(quote) <= 300);

-- practitioner_profiles is column-grant-restricted (see 20260802140000): every
-- readable/writable column is named explicitly. Public read, owner update.
grant select (quote) on public.practitioner_profiles to anon, authenticated;
grant update (quote) on public.practitioner_profiles to authenticated;

commit;
