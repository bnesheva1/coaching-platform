-- Fix for 20260915120000: the column-level `grant update (reply_text)` alone
-- does NOT restrict which columns a practitioner can write, because Supabase
-- grants table-wide UPDATE to anon/authenticated by default and the original
-- reviews migration (20260712160000) only ever revoked SELECT — never UPDATE.
-- With the new UPDATE RLS policy in place, that leftover table-wide grant let a
-- practitioner rewrite rating/review_text on their OWN reviews via a direct API
-- call. Revoke the table-wide UPDATE (exactly as the SELECT was revoked) so the
-- column-level grant becomes the real ceiling: reply_text only. Verified by
-- scripts/verify-review-reply-security.mjs group 6.

begin;

-- Remove the default table-wide UPDATE, then re-grant only the reply column.
-- anon can never satisfy the RLS policy (auth.uid() is null) but is revoked too
-- for parity with the SELECT revoke and defence in depth.
revoke update on public.reviews from anon, authenticated;
grant update (reply_text) on public.reviews to authenticated;

commit;
