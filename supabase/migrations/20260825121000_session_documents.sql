-- Session document attachments — metadata tables, RLS, grants, RPC.
--
-- Two tables:
--   session_documents        — the current live slot: one row per
--                              (booking, side). Replacing a file UPDATEs
--                              this row; a purge NULLs its storage_path.
--   session_document_events  — append-only audit log. Every upload,
--                              replacement and deletion is recorded here
--                              and STAYS after the file itself is gone,
--                              so a later reviewer can see a document was
--                              exchanged (who, when, name, size) without
--                              the platform still holding the bytes.
--
-- Access control mirrors the delivery-info discipline exactly (see
-- 20260803100000_bookings_snapshot_price_and_delivery_info.sql):
--   (a) row-level RLS keyed to the two parties of the parent booking,
--   (b) a column-level GRANT that EXCLUDES storage_path — so the path is
--       unreadable via any plain .select(), even by the row's own two
--       parties, exactly like phone_number/meeting_link/delivery_info,
--   (c) a narrow SECURITY DEFINER RPC as the only path from a party to
--       the raw storage key, which the download action turns into a
--       short-lived signed URL.

begin;

create table public.session_documents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  side text not null check (side in ('client', 'practitioner')),
  uploader_id uuid not null,
  -- Original filename, kept only for display. Bounded like the other
  -- user-supplied text columns on bookings (see the CHECK-constraints
  -- migration) so a pathological name can't bloat the row.
  file_name text not null check (char_length(file_name) between 1 and 255),
  byte_size bigint not null check (byte_size > 0),
  mime_type text not null,
  -- The sensitive column: excluded from the grant below, readable only
  -- via get_session_document_path(). Nullable so a retention purge can
  -- clear it (file gone) while leaving the slot's metadata visible.
  storage_path text,
  -- "Last changed" shown in the UI, so a practitioner can tell a
  -- document moved under them after they'd read it. Set on every
  -- upload/replace by the action (not a DB default, so a replace
  -- refreshes it explicitly).
  uploaded_at timestamptz not null default now(),
  -- Idempotency marker for the pre-deletion warning email (see
  -- lib/documents/retention.ts) — set once, per row, when the parties
  -- have been warned this document is about to expire.
  retention_warned_at timestamptz,
  -- One slot per side: a replacement is an UPDATE of this row, never a
  -- second row. This is what keeps a slot from becoming a filing system.
  unique (booking_id, side)
);

create index session_documents_booking_id_idx on public.session_documents (booking_id);

alter table public.session_documents enable row level security;

-- Either party of the booking may read the slot metadata.
create policy "Booking parties can view session documents"
on public.session_documents for select
to authenticated
using (
  exists (
    select 1 from public.bookings b
    where b.id = session_documents.booking_id
      and (b.client_id = auth.uid() or b.practitioner_id = auth.uid())
  )
);

-- Write policies: a party may only create/replace/remove THEIR OWN side.
create policy "Booking parties can insert their own side"
on public.session_documents for insert
to authenticated
with check (
  uploader_id = auth.uid()
  and exists (
    select 1 from public.bookings b
    where b.id = session_documents.booking_id
      and (
        (session_documents.side = 'client' and b.client_id = auth.uid())
        or (session_documents.side = 'practitioner' and b.practitioner_id = auth.uid())
      )
  )
);

create policy "Booking parties can update their own side"
on public.session_documents for update
to authenticated
using (
  exists (
    select 1 from public.bookings b
    where b.id = session_documents.booking_id
      and (
        (session_documents.side = 'client' and b.client_id = auth.uid())
        or (session_documents.side = 'practitioner' and b.practitioner_id = auth.uid())
      )
  )
)
with check (
  uploader_id = auth.uid()
  and exists (
    select 1 from public.bookings b
    where b.id = session_documents.booking_id
      and (
        (session_documents.side = 'client' and b.client_id = auth.uid())
        or (session_documents.side = 'practitioner' and b.practitioner_id = auth.uid())
      )
  )
);

create policy "Booking parties can delete their own side"
on public.session_documents for delete
to authenticated
using (
  exists (
    select 1 from public.bookings b
    where b.id = session_documents.booking_id
      and (
        (session_documents.side = 'client' and b.client_id = auth.uid())
        or (session_documents.side = 'practitioner' and b.practitioner_id = auth.uid())
      )
  )
);

-- Column grant: storage_path is deliberately absent — the ONLY way a
-- party reaches it is get_session_document_path() below. Everything else
-- is metadata safe for both parties to read directly. The write path
-- (INSERT/UPDATE of storage_path via the server action's user client)
-- keeps working because Supabase's default INSERT/UPDATE column
-- privileges are untouched; only SELECT is narrowed here. The action
-- therefore never .select()s storage_path back after writing it.
revoke select on public.session_documents from anon, authenticated;
grant select (
  id, booking_id, side, uploader_id, file_name, byte_size, mime_type,
  uploaded_at, retention_warned_at
) on public.session_documents to authenticated;

-- ── Append-only audit log ────────────────────────────────────────────
create table public.session_document_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  side text not null check (side in ('client', 'practitioner')),
  -- Null for a system actor (the retention purge runs as service role).
  actor_id uuid,
  action text not null check (action in ('uploaded', 'replaced', 'deleted_by_user', 'deleted_retention')),
  -- Snapshot at the time of the event — retained after the file is gone.
  file_name text,
  byte_size bigint,
  mime_type text,
  occurred_at timestamptz not null default now()
);

create index session_document_events_booking_id_idx on public.session_document_events (booking_id);

alter table public.session_document_events enable row level security;

-- Either party may read the full exchange history for their booking.
create policy "Booking parties can view session document events"
on public.session_document_events for select
to authenticated
using (
  exists (
    select 1 from public.bookings b
    where b.id = session_document_events.booking_id
      and (b.client_id = auth.uid() or b.practitioner_id = auth.uid())
  )
);

-- A party may only append their OWN actions for their OWN side, and only
-- the user-initiated action kinds — 'deleted_retention' is reserved for
-- the service-role purge, which bypasses RLS. No UPDATE/DELETE policies
-- exist, so the log is immutable to every non-service caller.
create policy "Booking parties can append their own document events"
on public.session_document_events for insert
to authenticated
with check (
  actor_id = auth.uid()
  and action in ('uploaded', 'replaced', 'deleted_by_user')
  and exists (
    select 1 from public.bookings b
    where b.id = session_document_events.booking_id
      and (
        (session_document_events.side = 'client' and b.client_id = auth.uid())
        or (session_document_events.side = 'practitioner' and b.practitioner_id = auth.uid())
      )
  )
);

-- ── The only reader of storage_path ──────────────────────────────────
-- Narrow, keyed to the two parties in its own WHERE (definer bypasses
-- RLS, so it re-imposes the boundary itself), returns just the single
-- path. Either party may fetch either side's path — the download action
-- calls this, then mints a 60-second signed URL. Modelled on
-- get_my_confirmed_bookings_contact_info().
create function public.get_session_document_path(p_booking_id uuid, p_side text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select d.storage_path
  from public.session_documents d
  join public.bookings b on b.id = d.booking_id
  where d.booking_id = p_booking_id
    and d.side = p_side
    and (b.client_id = auth.uid() or b.practitioner_id = auth.uid())
$$;

grant execute on function public.get_session_document_path(uuid, text) to authenticated;

-- ── Retention batch RPCs (service-role only) ─────────────────────────
-- Both are SECURITY DEFINER and expose recipient PII / storage paths, so
-- — exactly like get_reminder_batch — execute is granted ONLY to
-- service_role (the daily cron). They take pre-computed end_utc bounds
-- rather than a retention-day count: the retention window is an app-level
-- env knob (SESSION_DOCUMENT_RETENTION_DAYS), so the caller converts "N
-- days after the session" into a concrete end_utc cutoff and the SQL
-- stays oblivious to the number.

-- Documents whose file still exists and whose session ended before the
-- cutoff (i.e. past their deletion date). The caller deletes the object +
-- row and logs a 'deleted_retention' event.
create function public.get_purgeable_session_documents(end_utc_before timestamptz, batch_limit int)
returns table (
  document_id uuid,
  booking_id uuid,
  side text,
  storage_path text,
  file_name text,
  byte_size bigint,
  mime_type text
)
language sql
security definer
set search_path = public
stable
as $$
  select d.id, d.booking_id, d.side, d.storage_path, d.file_name, d.byte_size, d.mime_type
  from public.session_documents d
  join public.bookings b on b.id = d.booking_id
  where d.storage_path is not null
    and b.end_utc < end_utc_before
  order by b.end_utc
  limit batch_limit
$$;

revoke all on function public.get_purgeable_session_documents(timestamptz, int) from public, authenticated, anon;
grant execute on function public.get_purgeable_session_documents(timestamptz, int) to service_role;

-- Documents approaching their deletion date and not yet warned, joined to
-- both parties' contact details. The caller emails each party once per
-- booking and stamps retention_warned_at.
create function public.get_expiring_session_documents_batch(
  end_utc_from timestamptz,
  end_utc_to timestamptz,
  batch_limit int
)
returns table (
  document_id uuid,
  booking_id uuid,
  side text,
  file_name text,
  start_utc timestamptz,
  end_utc timestamptz,
  service_name text,
  client_email text,
  client_display_name text,
  client_locale text,
  client_timezone text,
  practitioner_email text,
  practitioner_display_name text,
  practitioner_locale text,
  practitioner_timezone text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    d.id, d.booking_id, d.side, d.file_name, b.start_utc, b.end_utc, b.service_name,
    cp.email, cp.display_name, cp.locale, cp.timezone,
    pp.email, pp.display_name, pp.locale, ppr.timezone
  from public.session_documents d
  join public.bookings b on b.id = d.booking_id
  join public.profiles cp on cp.id = b.client_id
  join public.profiles pp on pp.id = b.practitioner_id
  join public.practitioner_profiles ppr on ppr.id = b.practitioner_id
  where d.storage_path is not null
    and d.retention_warned_at is null
    and b.end_utc between end_utc_from and end_utc_to
  order by b.end_utc
  limit batch_limit
$$;

revoke all on function public.get_expiring_session_documents_batch(timestamptz, timestamptz, int) from public, authenticated, anon;
grant execute on function public.get_expiring_session_documents_batch(timestamptz, timestamptz, int) to service_role;

commit;
