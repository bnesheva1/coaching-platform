begin;

-- First-seen IP/device tracking for admin logins, feeding the Telegram admin-
-- activity tripwire (lib/admin/activityAlerts.ts → recordAdminLogin). Service-
-- role only, like admin_audit_log: RLS on with NO policies, so it's never read
-- or written from a client session. Holds no PII beyond the admin's own user id
-- plus the login's network address / device string.
create table public.admin_login_events (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete cascade,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.admin_login_events enable row level security;

-- "Has this admin logged in from this IP / this device before?" lookups.
create index admin_login_events_admin_ip_idx on public.admin_login_events (admin_id, ip);
create index admin_login_events_admin_ua_idx on public.admin_login_events (admin_id, user_agent);

commit;
