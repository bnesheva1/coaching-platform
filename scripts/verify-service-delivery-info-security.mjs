// Epic 7: proves services.delivery_info is genuinely unreadable except
// through the three narrow SECURITY DEFINER functions, each scoped to
// exactly who's allowed to see it — not anon, not an uninvolved user,
// not even the OWNING practitioner via a plain select (the column
// grant excludes it entirely; only the RPCs bypass that, each with its
// own check). The actual adversarial case this exists to close: does
// cancelling a booking correctly revoke access to the delivery info
// that came with it?
//
// Run: node --env-file=.env.local scripts/verify-service-delivery-info-security.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();

async function signUp(role, name) {
  const supabase = createClient(url, key);
  const email = `delivery-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data } = await supabase.auth.signUp({
    email, password, options: { data: { role, display_name: name, locale: "en" } },
  });
  return { supabase, user: data.user };
}

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures++;
}

console.log("=== Setup ===");
const practitionerA = await signUp("practitioner", `DeliveryPracA ${stamp}`);
const practitionerB = await signUp("practitioner", `DeliveryPracB ${stamp}`);
const client1 = await signUp("client", `DeliveryClient1 ${stamp}`);
const client2 = await signUp("client", `DeliveryClient2 ${stamp}`);
await new Promise((r) => setTimeout(r, 500));

const usernameA = `deliveryA${stamp}`;
await practitionerA.supabase.from("practitioner_profiles").update({ username: usernameA }).eq("id", practitionerA.user.id);

// .select("id") only, not a bare .select() — delivery_info isn't in
// the SELECT grant, and an unqualified .select() implicitly requests
// every granted-visible column via RETURNING, which would otherwise
// fail with a permission error unrelated to what this check is testing
// (the same "RETURNING is still subject to grants/RLS" gotcha this
// project has hit before, just for column grants instead of RLS).
const SECRET_ADDRESS = "123 Secret Studio Lane, Sofia";
const { data: service, error: serviceError } = await practitionerA.supabase
  .from("services")
  .insert({
    practitioner_id: practitionerA.user.id, name: "Delivery Test Svc", duration_minutes: 30,
    price_cents: 1000, currency: "EUR", is_active: true,
    delivery_type: "in_person", delivery_info: SECRET_ADDRESS,
  })
  .select("id").single();
check("practitionerA can create an active service WITH delivery info", !!service && !serviceError);

console.log("\n=== 1. delivery_info is unselectable via a direct query — anon, uninvolved user, AND the owner ===");
const anon = createClient(url, key);
const anonSelect = await anon.from("services").select("delivery_info").eq("id", service.id);
check("anon selecting delivery_info directly is rejected", !!anonSelect.error);

const client1Select = await client1.supabase.from("services").select("delivery_info").eq("id", service.id);
check("an uninvolved client selecting delivery_info directly is rejected", !!client1Select.error);

const ownerSelect = await practitionerA.supabase.from("services").select("delivery_info").eq("id", service.id);
check("even the OWNING practitioner's plain select of delivery_info is rejected (column grant, not ownership)", !!ownerSelect.error);

console.log("\n=== 2. delivery_type (unlike delivery_info) remains publicly readable — the split is scoped correctly ===");
const publicTypeRead = await anon.from("services").select("delivery_type").eq("id", service.id).single();
check("anon CAN read delivery_type (intentionally public)", publicTypeRead.data?.delivery_type === "in_person");

console.log("\n=== 3. get_my_services_delivery_info returns only the caller's own services ===");
const ownRpc = await practitionerA.supabase.rpc("get_my_services_delivery_info");
const ownRow = (ownRpc.data ?? []).find((r) => r.service_id === service.id);
check("practitionerA's own RPC call returns the real delivery_info for their service", ownRow?.delivery_info === SECRET_ADDRESS);

const otherPracRpc = await practitionerB.supabase.rpc("get_my_services_delivery_info");
check("practitionerB's own RPC call does NOT include practitionerA's service", !(otherPracRpc.data ?? []).some((r) => r.service_id === service.id));

console.log("\n=== 4. get_my_active_booking_delivery_info: the actual adversarial case ===");
const noBookingRpc = await client1.supabase.rpc("get_my_active_booking_delivery_info");
check("client1 (no booking at all) gets nothing for this service", !(noBookingRpc.data ?? []).some((r) => r.service_id === service.id));

const startUtc = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
// service only carries `id` (see the .select("id") note above) — the
// literal 30 mirrors the duration_minutes set in the insert itself.
const endUtc = new Date(new Date(startUtc).getTime() + 30 * 60 * 1000).toISOString();
const { data: booking } = await client1.supabase.from("bookings").insert({
  practitioner_id: practitionerA.user.id, client_id: client1.user.id, service_id: service.id,
  start_utc: startUtc, end_utc: endUtc,
}).select().single();
check("setup booking created", !!booking);

const activeBookingRpc = await client1.supabase.rpc("get_my_active_booking_delivery_info");
const activeRow = (activeBookingRpc.data ?? []).find((r) => r.service_id === service.id);
check("client1 WITH an active booking gets the real delivery_info", activeRow?.delivery_info === SECRET_ADDRESS);

const otherClientRpc = await client2.supabase.rpc("get_my_active_booking_delivery_info");
check("client2 (uninvolved, no booking) gets nothing for this service", !(otherClientRpc.data ?? []).some((r) => r.service_id === service.id));

// Cancel it — the real adversarial case: does losing "active" status
// correctly revoke access?
await client1.supabase.from("bookings").update({ status: "cancelled_by_client" }).eq("id", booking.id).eq("client_id", client1.user.id);
const cancelledBookingRpc = await client1.supabase.rpc("get_my_active_booking_delivery_info");
check(
  "client1, after cancelling their own booking, no longer gets delivery_info for this service",
  !(cancelledBookingRpc.data ?? []).some((r) => r.service_id === service.id),
);

console.log("\n=== 5. get_booking_email_context still correctly scopes to the booking's two parties, with the new fields present ===");
const { data: booking2 } = await client1.supabase.from("bookings").insert({
  practitioner_id: practitionerA.user.id, client_id: client1.user.id, service_id: service.id,
  start_utc: new Date(Date.now() + 52 * 60 * 60 * 1000).toISOString(),
  end_utc: new Date(Date.now() + 52.5 * 60 * 60 * 1000).toISOString(),
}).select().single();
const contextCall = await client1.supabase.rpc("get_booking_email_context", { target_booking_id: booking2.id }).single();
check("get_booking_email_context includes service_delivery_info for a real party", contextCall.data?.service_delivery_info === SECRET_ADDRESS);
check("get_booking_email_context includes service_delivery_type", contextCall.data?.service_delivery_type === "in_person");

const outsiderContextCall = await client2.supabase.rpc("get_booking_email_context", { target_booking_id: booking2.id }).maybeSingle();
check("an uninvolved user calling get_booking_email_context for this booking gets nothing", !outsiderContextCall.data);

console.log("\n=== 6. The NOT VALID constraint rejects a direct-API attempt to create an active service without delivery info ===");
const incompleteInsert = await practitionerA.supabase.from("services").insert({
  practitioner_id: practitionerA.user.id, name: "Incomplete Svc", duration_minutes: 30,
  price_cents: 1000, currency: "EUR", is_active: true,
  // no delivery_type / delivery_info at all
}).select("id");
check("creating an active service with no delivery info is rejected at the DB level", !!incompleteInsert.error);
check("rejection is the check-constraint violation specifically", incompleteInsert.error?.code === "23514");

// Sanity: the SAME insert succeeds if is_active is false — the
// constraint only fires for active services, matching the design.
const incompleteInactiveInsert = await practitionerA.supabase.from("services").insert({
  practitioner_id: practitionerA.user.id, name: "Draft Svc", duration_minutes: 30,
  price_cents: 1000, currency: "EUR", is_active: false,
}).select("id");
check("the same insert succeeds when is_active is false (constraint only applies to active services)", !incompleteInactiveInsert.error);

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
