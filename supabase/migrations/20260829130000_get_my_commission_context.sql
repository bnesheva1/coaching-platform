-- Practitioner-facing commission visibility.
--
-- So a practitioner can see what they'll actually receive on the service
-- form, they need to read their OWN billing model + commission override.
-- Both are admin-only / not client-granted (billing_model, and
-- commission_rate_override which 20260829120000 deliberately left out of every
-- client grant), so — same pattern as get_my_max_price_cents()
-- (20260803151500) — a narrow SECURITY DEFINER RPC scoped to auth.uid() is the
-- read path. The EFFECTIVE rate (override ?? brand default) is still computed in
-- app code via effectiveCommissionRate() — the same function checkout uses, the
-- single source of truth — so a practitioner with a negotiated override sees the
-- negotiated number, never the brand default. This RPC only exposes the caller's
-- own inputs to that function.
create function public.get_my_commission_context()
returns table (billing_model text, commission_rate_override numeric)
language sql
security definer
set search_path = public
stable
as $$
  select billing_model, commission_rate_override
  from public.practitioner_profiles
  where id = auth.uid()
$$;

grant execute on function public.get_my_commission_context() to authenticated;
