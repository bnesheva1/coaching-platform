// Gated content — access-control proof (schema + RLS + column grants + RPCs).
// The security crux: a non-purchaser must NEVER obtain youtube_video_id or
// pdf_storage_path, by any direct query; a completed purchaser gets them only
// through get_purchased_content_item; the owner edits via get_my_content_items.
//
// Run: node --env-file=.env.local scripts/verify-gated-content-access.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();
const serviceRole = createClient(url, serviceKey);

async function signUp(role, name) {
  const supabase = createClient(url, anonKey);
  const email = `content-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data } = await supabase.auth.signUp({ email, password, options: { data: { role, display_name: name } } });
  return { supabase, user: data.user };
}

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) failures++;
}

console.log("=== Setup ===");
const pracA = await signUp("practitioner", `ContentPracA ${stamp}`);
const buyerB = await signUp("client", `ContentBuyerB ${stamp}`);
const nonBuyerC = await signUp("client", `ContentNonBuyerC ${stamp}`);
await new Promise((r) => setTimeout(r, 500));

const REAL_ID = "dQw4w9WgXcQ"; // 11 chars
const { data: item, error: insErr } = await pracA.supabase
  .from("content_items")
  .insert({ practitioner_id: pracA.user.id, type: "video_youtube", title: "Gated Video", description: "Preview desc", price_cents: 1500, youtube_video_id: REAL_ID })
  .select("id")
  .single();
check("practitioner can create a video content item", !insErr && !!item);
const itemId = item?.id;

console.log("\n=== 1. Public preview columns ARE readable (positive control) ===");
const anon = createClient(url, anonKey);
const preview = await anon.from("content_items").select("id, type, title, description, price_cents, currency, is_active").eq("id", itemId).single();
check("anon reads the preview shape (title/price/etc.)", !preview.error && preview.data?.title === "Gated Video" && preview.data?.price_cents === 1500);

console.log("\n=== 2. The unlock columns are NOT directly selectable, by ANYONE ===");
const anonId = await anon.from("content_items").select("youtube_video_id").eq("id", itemId);
check("anon selecting youtube_video_id is rejected (column not granted)", !!anonId.error);
const cId = await nonBuyerC.supabase.from("content_items").select("youtube_video_id").eq("id", itemId);
check("a logged-in non-purchaser selecting youtube_video_id is rejected", !!cId.error);
const ownerDirect = await pracA.supabase.from("content_items").select("youtube_video_id").eq("id", itemId);
check("even the OWNER cannot select youtube_video_id directly (must use the RPC)", !!ownerDirect.error);
const starSel = await anon.from("content_items").select("*").eq("id", itemId);
check("select(*) is rejected outright (includes ungranted columns)", !!starSel.error);

console.log("\n=== 3. get_purchased_content_item returns nothing without a completed purchase ===");
const cBefore = await nonBuyerC.supabase.rpc("get_purchased_content_item", { p_item_id: itemId });
check("non-purchaser C gets zero rows from the purchase RPC", !cBefore.error && (cBefore.data ?? []).length === 0);
const bBefore = await buyerB.supabase.rpc("get_purchased_content_item", { p_item_id: itemId });
check("buyer B (not yet purchased) gets zero rows", !bBefore.error && (bBefore.data ?? []).length === 0);

console.log("\n=== 4. After a COMPLETED purchase, only that buyer gets the unlock fields ===");
await serviceRole.from("content_purchases").insert({
  content_item_id: itemId, buyer_id: buyerB.user.id, practitioner_id: pracA.user.id,
  status: "completed", amount_cents: 1500, currency: "EUR", purchased_at: new Date().toISOString(),
});
const bAfter = await buyerB.supabase.rpc("get_purchased_content_item", { p_item_id: itemId });
check("buyer B now gets youtube_video_id via the RPC", !bAfter.error && bAfter.data?.[0]?.youtube_video_id === REAL_ID);
const cAfter = await nonBuyerC.supabase.rpc("get_purchased_content_item", { p_item_id: itemId });
check("non-purchaser C STILL gets nothing (someone else's purchase doesn't leak)", (cAfter.data ?? []).length === 0);

console.log("\n=== 5. Owner RPC returns full rows (incl. unlock fields) for own items only ===");
const mine = await pracA.supabase.rpc("get_my_content_items");
check("owner get_my_content_items includes youtube_video_id", !mine.error && (mine.data ?? []).some((r) => r.youtube_video_id === REAL_ID));
const notMine = await nonBuyerC.supabase.rpc("get_my_content_items");
check("a non-owner's get_my_content_items does not include this item", !(notMine.data ?? []).some((r) => r.id === itemId));

console.log("\n=== 6. A user cannot create a content item attributed to someone else ===");
const spoof = await nonBuyerC.supabase.from("content_items").insert({ practitioner_id: pracA.user.id, type: "video_youtube", title: "spoof", price_cents: 100, youtube_video_id: REAL_ID }).select("id");
check("C inserting an item as practitioner A is rejected by RLS with-check", !!spoof.error);

console.log("\n=== 7b. Entitlement does NOT expire: an old, payout-released purchase still unlocks ===");
// Age buyer B's completed purchase a year back and mark its payout released —
// the unlock must still work, since entitlement keys on status='completed', not
// time or payout state (only the embed/PDF regenerate fresh per request).
await serviceRole.from("content_purchases")
  .update({ purchased_at: new Date(Date.now() - 365 * 24 * 3600e3).toISOString(), transfer_status: "released" })
  .eq("content_item_id", itemId).eq("buyer_id", buyerB.user.id);
const bAged = await buyerB.supabase.rpc("get_purchased_content_item", { p_item_id: itemId });
check("a year-old, released purchase STILL returns the unlock fields", bAged.data?.[0]?.youtube_video_id === REAL_ID);

console.log("\n=== 7. Pending (not completed) purchase does NOT unlock ===");
const { data: item2 } = await pracA.supabase.from("content_items").insert({ practitioner_id: pracA.user.id, type: "video_youtube", title: "Gated Video 2", price_cents: 2000, youtube_video_id: "abcdefghijk" }).select("id").single();
await serviceRole.from("content_purchases").insert({ content_item_id: item2.id, buyer_id: buyerB.user.id, practitioner_id: pracA.user.id, status: "pending", amount_cents: 2000, currency: "EUR" });
const pendingUnlock = await buyerB.supabase.rpc("get_purchased_content_item", { p_item_id: item2.id });
check("a pending purchase does not unlock the item", (pendingUnlock.data ?? []).length === 0);

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
