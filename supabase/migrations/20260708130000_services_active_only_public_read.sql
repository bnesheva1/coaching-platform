-- Replaces the blanket "anyone can read all services" policy with one
-- that respects is_active: anonymous/public visitors can only see active
-- services, while the owning practitioner can still see their own
-- inactive ones too (needed so their management UI can list hidden
-- services in order to toggle them back on). This backs the public
-- profile page's own is_active filter with database-level enforcement,
-- so a query that forgot the filter still couldn't leak hidden services.
drop policy "Anyone can view services" on public.services;

create policy "Anyone can view active services, owners can view all their own"
on public.services
for select
to public
using (is_active = true or auth.uid() = practitioner_id);
