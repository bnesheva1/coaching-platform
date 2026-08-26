-- Storage usage measurement, for the "running low on storage" guard.
--
-- Supabase's free tier is 1GB total, SHARED across every bucket (avatars,
-- banners, service images, and now session-documents). There's no
-- bucket-size field on the REST API, so this sums the per-object sizes
-- that Storage records in storage.objects.metadata->>'size', grouped by
-- bucket. The daily alert sweep calls it to warn when total usage crosses
-- a threshold, and the admin health page shows the breakdown.
--
-- SECURITY DEFINER (storage.objects isn't readable by authenticated) and
-- execute granted ONLY to service_role — same posture as the retention
-- batch RPCs. It exposes aggregate byte counts, nothing per-user.
create function public.get_storage_usage()
returns table (bucket_id text, total_bytes bigint, object_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    o.bucket_id,
    coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint as total_bytes,
    count(*)::bigint as object_count
  from storage.objects o
  group by o.bucket_id
$$;

revoke all on function public.get_storage_usage() from public, authenticated, anon;
grant execute on function public.get_storage_usage() to service_role;
