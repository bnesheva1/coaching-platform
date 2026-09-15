// Practitioner review reply (Google/Airbnb host-reply pattern). Proves at
// the DB level that the reply is writable ONLY by the practitioner the
// review is about, ONLY on the reply_text column, publicly readable, and
// bounded by the length CHECK — the whole authorization surface lives in
// the column-level UPDATE grant + the RLS UPDATE policy, not the app.
//
// Bookings are seeded via service-role (a 'completed' booking otherwise
// only arises through real time + the cron), mirroring
// verify-reviews-security.mjs.
//
// Run: node --env-file=.env.local scripts/verify-review-reply-security.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();

const serviceRole = createClient(url, serviceKey);

async function signUp(role, name) {
  const supabase = createClient(url, anonKey);
  const email = `reply-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data } = await supabase.auth.signUp({
    email, password, options: { data: { role, display_name: name } },
  });
  return { supabase, user: data.user };
}

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures++;
}

console.log("=== Setup ===");
const practitionerA = await signUp("practitioner", `ReplyPracA ${stamp}`);
const practitionerB = await signUp("practitioner", `ReplyPracB ${stamp}`);
const client1 = await signUp("client", `ReplyClient1 ${stamp}`);
await new Promise((r) => setTimeout(r, 500));

await practitionerA.supabase.from("practitioner_profiles").update({ username: `replyA${stamp}` }).eq("id", practitionerA.user.id);
await practitionerB.supabase.from("practitioner_profiles").update({ username: `replyB${stamp}` }).eq("id", practitionerB.user.id);

const { data: service, error: serviceErr } = await practitionerA.supabase
  .from("services")
  .insert({ practitioner_id: practitionerA.user.id, name: "Reply Test Svc", duration_minutes: 30, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "https://example.com/meeting" })
  .select("id, duration_minutes").single();
if (serviceErr || !service) { console.error("service insert failed:", serviceErr, "user:", practitionerA.user?.id); process.exit(1); }

// Seeded completed booking + a real review by client1 on practitionerA.
const start = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
const end = new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString();
const { data: booking, error: bookingErr } = await serviceRole.from("bookings").insert({
  practitioner_id: practitionerA.user.id,
  client_id: client1.user.id,
  service_id: service.id,
  start_utc: start,
  end_utc: end,
  status: "completed",
  delivery_type: "online",
  service_name: "Reply Test Svc",
  price_cents: 5000,
  currency: "EUR",
}).select("id").single();
if (bookingErr || !booking) { console.error("booking insert failed:", bookingErr); process.exit(1); }

const { data: review, error: reviewErr } = await client1.supabase.from("reviews").insert({
  booking_id: booking.id,
  practitioner_id: practitionerA.user.id,
  rating: 4,
  review_text: "Helpful session.",
}).select("id").single();
check("review seeded", !reviewErr && !!review);
const reviewId = review?.id;

console.log("\n=== 1. The practitioner the review is about CAN post a reply ===");
const post = await practitionerA.supabase.from("reviews").update({ reply_text: "Thank you for the kind words!" }).eq("id", reviewId).select("id");
check("practitionerA can set reply_text on their own review", !post.error && post.data?.length === 1);

console.log("\n=== 2. reply_updated_at is stamped by the trigger (not writable, but set) ===");
const afterPost = await serviceRole.from("reviews").select("reply_text, reply_updated_at").eq("id", reviewId).single();
check("reply_text persisted", afterPost.data?.reply_text === "Thank you for the kind words!");
check("reply_updated_at stamped on post", !!afterPost.data?.reply_updated_at);

console.log("\n=== 3. The practitioner can EDIT their reply (single slot, not threaded) ===");
const edit = await practitionerA.supabase.from("reviews").update({ reply_text: "Edited: thanks again!" }).eq("id", reviewId).select("id");
check("practitionerA can overwrite their reply", !edit.error && edit.data?.length === 1);
const afterEdit = await serviceRole.from("reviews").select("reply_text").eq("id", reviewId).single();
check("edited reply persisted (overwrite, not append)", afterEdit.data?.reply_text === "Edited: thanks again!");

console.log("\n=== 4. A DIFFERENT practitioner CANNOT reply to this review ===");
const otherPrac = await practitionerB.supabase.from("reviews").update({ reply_text: "Not my review" }).eq("id", reviewId).select("id");
check("practitionerB's update matches no rows (RLS scopes to own reviews)", !otherPrac.error && (otherPrac.data?.length ?? 0) === 0);
const afterOther = await serviceRole.from("reviews").select("reply_text").eq("id", reviewId).single();
check("reply_text unchanged after practitionerB's attempt", afterOther.data?.reply_text === "Edited: thanks again!");

console.log("\n=== 5. The reviewing client CANNOT write a reply (not the practitioner) ===");
const clientAttempt = await client1.supabase.from("reviews").update({ reply_text: "I'll reply to my own review" }).eq("id", reviewId).select("id");
check("client1's reply update matches no rows", !clientAttempt.error && (clientAttempt.data?.length ?? 0) === 0);

console.log("\n=== 6. The practitioner CANNOT smuggle other columns via the reply UPDATE ===");
const smuggleRating = await practitionerA.supabase.from("reviews").update({ rating: 5 }).eq("id", reviewId).select("id");
check("updating rating is rejected by the column grant (not granted)", !!smuggleRating.error);
const smuggleText = await practitionerA.supabase.from("reviews").update({ review_text: "rewritten by practitioner" }).eq("id", reviewId).select("id");
check("updating review_text is rejected by the column grant", !!smuggleText.error);
const stillOriginal = await serviceRole.from("reviews").select("rating, review_text").eq("id", reviewId).single();
check("rating + review_text untouched", stillOriginal.data?.rating === 4 && stillOriginal.data?.review_text === "Helpful session.");

console.log("\n=== 7. The reply is publicly readable alongside the review ===");
const anon = createClient(url, anonKey);
const publicRead = await anon.from("reviews").select("id, rating, review_text, reply_text, reply_updated_at").eq("id", reviewId).single();
check("anon can read reply_text + reply_updated_at", !publicRead.error && publicRead.data?.reply_text === "Edited: thanks again!");

console.log("\n=== 8. The length CHECK bounds the reply at 2000 chars ===");
const tooLong = await practitionerA.supabase.from("reviews").update({ reply_text: "x".repeat(2001) }).eq("id", reviewId).select("id");
check("a 2001-char reply is rejected by the CHECK constraint", !!tooLong.error);
const atLimit = await practitionerA.supabase.from("reviews").update({ reply_text: "y".repeat(2000) }).eq("id", reviewId).select("id");
check("a 2000-char reply is accepted", !atLimit.error && atLimit.data?.length === 1);

console.log("\n=== 9. Clearing the reply (empty submission) nulls reply_updated_at too ===");
const clear = await practitionerA.supabase.from("reviews").update({ reply_text: null }).eq("id", reviewId).select("id");
check("practitionerA can clear their reply", !clear.error && clear.data?.length === 1);
const afterClear = await serviceRole.from("reviews").select("reply_text, reply_updated_at").eq("id", reviewId).single();
check("reply_text nulled", afterClear.data?.reply_text === null);
check("reply_updated_at nulled by the trigger when reply cleared", afterClear.data?.reply_updated_at === null);

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
