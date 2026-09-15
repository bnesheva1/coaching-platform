-- Practitioner public reply to a review (the Google/Airbnb host-reply pattern):
-- one reply per review, editable, NOT threaded. Publicly readable alongside the
-- review; writable only by the practitioner the review is about. No new
-- moderation system — abuse is handled through the existing admin practitioner
-- controls (/admin/practitioners).

begin;

alter table public.reviews
  add column reply_text text,
  add column reply_updated_at timestamptz,
  add constraint reviews_reply_text_length check (reply_text is null or length(reply_text) <= 2000);

-- Publicly readable, same as the other review columns (the public grant is
-- column-scoped; booking_id stays excluded).
grant select (reply_text, reply_updated_at) on public.reviews to anon, authenticated;

-- The practitioner can write ONLY reply_text, and only on their OWN reviews:
-- a column-level UPDATE grant (they can never touch rating/review_text — not
-- granted) plus an RLS UPDATE policy scoped to their own rows. reply_updated_at
-- is stamped by the trigger below, so it's deliberately NOT in the grant.
grant update (reply_text) on public.reviews to authenticated;

create policy "A practitioner can reply to reviews on their profile"
  on public.reviews for update to authenticated
  using (practitioner_id = auth.uid())
  with check (practitioner_id = auth.uid());

create or replace function public.stamp_review_reply()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.reply_text is distinct from old.reply_text then
    new.reply_updated_at := case when new.reply_text is null then null else now() end;
  end if;
  return new;
end;
$$;

create trigger reviews_stamp_reply
  before update of reply_text on public.reviews
  for each row execute function public.stamp_review_reply();

commit;
