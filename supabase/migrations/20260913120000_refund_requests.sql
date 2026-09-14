-- Client-initiated refund requests. A client can ask for a refund on one of
-- their own past bookings, choosing a reason type; every request goes into an
-- admin review queue (/admin/refunds) — no auto-approval. Approve triggers the
-- existing refundBookingPayment (which branches on whether the payout already
-- released); deny records a client-visible reason.
--
-- One request per booking (booking_id unique). RLS is owner-scoped like
-- saved_practitioners: a client may create a request only for their OWN booking
-- and read only their own requests; admins act via the service role.

begin;

create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  client_id uuid not null references auth.users(id) on delete cascade,
  reason_type text not null check (reason_type in ('technical_failure', 'other')),
  reason_text text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  denial_reason text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  -- 'other' must carry a description; 'technical_failure' is a named category
  -- and doesn't require free text.
  constraint refund_request_other_needs_text
    check (reason_type <> 'other' or (reason_text is not null and length(btrim(reason_text)) > 0))
);

create index refund_requests_status_idx on public.refund_requests (status, created_at);

alter table public.refund_requests enable row level security;

-- A client may read their own requests (this is how the status view + the
-- duplicate check work), and create one only for a booking that is theirs.
create policy "Clients read their own refund requests"
  on public.refund_requests for select to authenticated
  using (auth.uid() = client_id);

create policy "Clients create refund requests for their own bookings"
  on public.refund_requests for insert to authenticated
  with check (
    auth.uid() = client_id
    and exists (select 1 from public.bookings b where b.id = booking_id and b.client_id = auth.uid())
  );

-- No client UPDATE/DELETE policy: status/denial_reason are set by admins via the
-- service role only, so a client can never approve their own refund.

commit;
