-- Gated content: practitioners sell one-time-purchase content items — an
-- unlisted YouTube video (embed) or a downloadable PDF — unlocked by a single
-- Stripe payment (the existing separate-charges-&-transfers checkout, NOT a new
-- billing model). Two tables + the RLS/column-grant discipline that guarantees a
-- non-purchaser can never obtain the video id or PDF storage path.

begin;

-- ── content_items ───────────────────────────────────────────────────────────
create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('video_youtube', 'pdf')),
  title text not null check (length(title) between 1 and 200),
  description text check (description is null or length(description) <= 4000),
  price_cents integer not null check (price_cents between 100 and 500000),
  currency text not null default 'EUR' check (currency = 'EUR'),
  -- The SENSITIVE columns — the actual unlock. Never granted to anon/authenticated
  -- for direct SELECT (see grants below); reachable only through the purchaser /
  -- owner SECURITY DEFINER RPCs. youtube_video_id is the validated 11-char id
  -- (lib/videos.ts), NEVER a URL or embed markup; the app builds the embed URL.
  youtube_video_id text check (youtube_video_id is null or youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  pdf_storage_path text,
  -- The sensitive column matches the type (a video item never has a pdf path).
  constraint content_items_type_fields check (
    (type = 'video_youtube' and pdf_storage_path is null)
    or (type = 'pdf' and youtube_video_id is null)
  ),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_items_practitioner_idx on public.content_items (practitioner_id);

alter table public.content_items enable row level security;

-- Row visibility: anyone may see an ACTIVE item (for the locked preview / browse);
-- the owner sees all of their own (incl. inactive). Column visibility is the real
-- gate — see the grants below.
create policy "Active content items are publicly visible"
  on public.content_items for select to anon, authenticated
  using (is_active or practitioner_id = auth.uid());

-- Owner-only writes.
create policy "Practitioners manage their own content items"
  on public.content_items for all to authenticated
  using (practitioner_id = auth.uid())
  with check (practitioner_id = auth.uid());

-- Column-level SELECT grant: revoke the table-wide default, then grant ONLY the
-- preview columns. youtube_video_id + pdf_storage_path are deliberately excluded,
-- so no PostgREST query by anyone (non-purchaser, purchaser, or even the owner)
-- can read them directly — the same structural pseudonymity used for reviews'
-- booking_id. The owner reads/edits them via get_my_content_items(); a purchaser
-- reads them via get_purchased_content_item(); nowhere else.
revoke select on public.content_items from anon, authenticated;
grant select (id, practitioner_id, type, title, description, price_cents, currency, is_active, created_at, updated_at)
  on public.content_items to anon, authenticated;

-- No updated_at trigger: this codebase sets updated_at explicitly in app code on
-- each write (the convention across payments/bookings), not via a DB trigger —
-- the content actions do the same.

-- ── content_purchases ────────────────────────────────────────────────────────
-- One purchase per (item, buyer). Carries its OWN payout-tracking columns — the
-- same shape as public.payments — so the existing release-sweep / reversal
-- machinery (lib/payments/stripe/transfer.ts, refund.ts) processes content
-- payouts through a content pass, without entangling the booking payout path.
-- Release time = purchased_at + CONTENT_PAYOUT_HOLD_HOURS (default 24h), NOT the
-- session's 48h and not immediate.
create table public.content_purchases (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  -- Denormalised at purchase time so a payout never depends on the item still
  -- existing / being unchanged.
  practitioner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'refunded', 'failed')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'EUR',
  commission_rate numeric,
  commission_cents integer,
  connected_account_id text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  -- Payout tracking (mirrors payments.transfer_status et al.).
  transfer_status text not null default 'pending'
    check (transfer_status in ('pending', 'released', 'held', 'reversed', 'not_applicable')),
  release_at timestamptz,
  stripe_transfer_id text,
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A buyer holds at most one purchase row per item.
  unique (content_item_id, buyer_id)
);
create index content_purchases_buyer_idx on public.content_purchases (buyer_id);
create index content_purchases_item_idx on public.content_purchases (content_item_id);
create index content_purchases_sweep_idx on public.content_purchases (status, transfer_status);

alter table public.content_purchases enable row level security;

-- A buyer sees their own purchases; a practitioner sees purchases of their items
-- (for a sales view). Neither can write directly — all writes go through the
-- webhook / release sweep on the service role, so no policy for insert/update.
create policy "Buyers see their own content purchases"
  on public.content_purchases for select to authenticated
  using (buyer_id = auth.uid() or practitioner_id = auth.uid());

-- ── Access RPCs ──────────────────────────────────────────────────────────────
-- Owner: full rows (incl. the sensitive columns the direct grant hides) for the
-- caller's own items — powers the practitioner management screen (edit).
create function public.get_my_content_items()
returns setof public.content_items
language sql
security definer
set search_path = public
as $$
  select * from public.content_items
  where practitioner_id = auth.uid()
  order by created_at desc;
$$;
grant execute on function public.get_my_content_items() to authenticated;

-- Purchaser: the unlock fields for ONE item, returned ONLY if the caller holds a
-- completed purchase of it. Zero rows otherwise — a non-purchaser gets nothing,
-- and the video id / pdf path never leave the DB for them. This is the single
-- authorised read path for the sensitive columns on the buyer side; the PDF
-- download route and the embed render both gate on it.
create function public.get_purchased_content_item(p_item_id uuid)
returns table (type text, title text, youtube_video_id text, pdf_storage_path text)
language sql
security definer
set search_path = public
as $$
  select ci.type, ci.title, ci.youtube_video_id, ci.pdf_storage_path
  from public.content_items ci
  where ci.id = p_item_id
    and exists (
      select 1 from public.content_purchases cp
      where cp.content_item_id = ci.id
        and cp.buyer_id = auth.uid()
        and cp.status = 'completed'
    );
$$;
grant execute on function public.get_purchased_content_item(uuid) to authenticated;

commit;
