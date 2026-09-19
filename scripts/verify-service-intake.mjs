// Per-service intake question + per-booking client answer — end-to-end proof.
//
// Requires migration 20260919120000_service_intake_question.sql applied.
// Run: node --env-file=.env.local scripts/verify-service-intake.mjs
//
// Covers the spec's test matrix:
//   * setting/editing the prompt on a service; the 300-char DB CHECK
//   * a booking SNAPSHOTS the prompt (real confirm_paid_booking paid path)
//   * answering is OPTIONAL (a booking with no answer is a valid, confirmed one)
//   * the answer RPC: client can write; a non-client cannot; >300 rejected;
//     past the active window rejected
//   * a <script> string is stored verbatim as plain text (rendered escaped —
//     asserted by there being no dangerouslySetInnerHTML in the render path)
//   * the shared sanitizer strips control chars, keeps <script>, caps length

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { sanitizeIntakeText } from "../lib/text/intakeText.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const PW = "twelvecharspw1";
const stamp = Date.now();
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${JSON.stringify(d)})` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const created = [];

async function mkUser(role) {
  const email = `intake-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role, display_name: `Intake ${role}` } });
  if (error) throw error;
  created.push(data.user.id);
  if (role === "practitioner") for (let i = 0; i < 25; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", data.user.id).maybeSingle()).data) break; await sleep(200); }
  return { id: data.user.id, email };
}
async function signIn(email) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  return c;
}

console.log("=== Setup ===");
const prac = await mkUser("practitioner");
const client = await mkUser("client");
const other = await mkUser("client");

const PROMPT = "Please share your date, time and place of birth.";
const { data: svc, error: svcErr } = await db.from("services").insert({
  practitioner_id: prac.id, name: "Astro reading", duration_minutes: 30, price_cents: 5000,
  currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "x", intake_prompt: PROMPT,
}).select("id, intake_prompt").single();
if (svcErr) { console.error("service insert failed:", svcErr); process.exit(1); }

console.log("\n=== 1. Service prompt set + edit + CHECK ===");
check("prompt stored on the service", svc.intake_prompt === PROMPT);
check("prompt is editable", !(await db.from("services").update({ intake_prompt: "Updated question?" }).eq("id", svc.id)).error);
await db.from("services").update({ intake_prompt: PROMPT }).eq("id", svc.id); // restore
check("prompt = 300 chars accepted", !(await db.from("services").update({ intake_prompt: "x".repeat(300) }).eq("id", svc.id)).error);
check("prompt = 301 chars rejected by DB CHECK", !!(await db.from("services").update({ intake_prompt: "x".repeat(301) }).eq("id", svc.id)).error);
await db.from("services").update({ intake_prompt: PROMPT }).eq("id", svc.id);

console.log("\n=== 2. Booking snapshots the prompt (real confirm_paid_booking path) ===");
const startUtc = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
const { data: rpc, error: rpcErr } = await db.rpc("confirm_paid_booking", {
  p_practitioner_id: prac.id, p_client_id: client.id, p_service_id: svc.id, p_start_utc: startUtc,
  p_checkout_session_id: "cs_intake_" + stamp, p_amount_cents: 5000, p_commission_cents: 750,
  p_currency: "EUR", p_payment_intent_id: "pi_" + stamp, p_commission_rate: 0.15,
}).single();
check("confirm_paid_booking succeeded", !rpcErr && rpc?.booking_id, rpcErr?.message ?? rpc);
const bookingId = rpc?.booking_id;
const snap = (await db.from("bookings").select("intake_prompt, intake_answer, status").eq("id", bookingId).single()).data;
check("booking snapshotted the prompt", snap?.intake_prompt === PROMPT);
check("answer is NULL — answering is not mandatory, booking is complete", snap?.intake_answer === null && snap?.status === "confirmed");

console.log("\n=== 3. Answer RPC authorization + limits ===");
const clientC = await signIn(client.email);
const otherC = await signIn(other.email);
const pracC = await signIn(prac.email);

const ANSWER = "14 March 1990, 03:45, Sofia";
check("client can save their answer", (await clientC.rpc("set_booking_intake_answer", { p_booking_id: bookingId, p_answer: ANSWER })).data === true);
check("answer stored", (await db.from("bookings").select("intake_answer").eq("id", bookingId).single()).data?.intake_answer === ANSWER);

check("a different client is refused (RPC returns false)", (await otherC.rpc("set_booking_intake_answer", { p_booking_id: bookingId, p_answer: "hacked" })).data === false);
check("the practitioner cannot write the answer", (await pracC.rpc("set_booking_intake_answer", { p_booking_id: bookingId, p_answer: "hacked" })).data === false);
check("answer unchanged after refused attempts", (await db.from("bookings").select("intake_answer").eq("id", bookingId).single()).data?.intake_answer === ANSWER);

check("answer > 300 chars rejected by RPC", (await clientC.rpc("set_booking_intake_answer", { p_booking_id: bookingId, p_answer: "x".repeat(301) })).data === false);
check("answer unchanged after too-long attempt", (await db.from("bookings").select("intake_answer").eq("id", bookingId).single()).data?.intake_answer === ANSWER);

console.log("\n=== 4. <script> stored verbatim as plain text (rendered escaped) ===");
const XSS = "<script>alert(1)</script>";
check("client can store a <script> string", (await clientC.rpc("set_booking_intake_answer", { p_booking_id: bookingId, p_answer: XSS })).data === true);
check("stored verbatim (plain text, not stripped/interpreted)", (await db.from("bookings").select("intake_answer").eq("id", bookingId).single()).data?.intake_answer === XSS);
const view = readFileSync(new URL("../components/bookings/BookingIntake.tsx", import.meta.url), "utf8");
check("render path has NO dangerouslySetInnerHTML", !view.includes("dangerouslySetInnerHTML"));

console.log("\n=== 5. Active-window enforcement (past retention) ===");
const pastEnd = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
const pastStart = new Date(Date.now() - 20 * 24 * 3600 * 1000 - 30 * 60000).toISOString();
const { data: oldB } = await db.from("bookings").insert({
  practitioner_id: prac.id, client_id: client.id, service_id: svc.id, start_utc: pastStart, end_utc: pastEnd,
  status: "completed", delivery_type: "online", service_name: "Astro reading", price_cents: 5000, currency: "EUR", intake_prompt: PROMPT,
}).select("id").single();
check("answering a booking past the window is refused", (await clientC.rpc("set_booking_intake_answer", { p_booking_id: oldB.id, p_answer: "late" })).data === false);

console.log("\n=== 6. Shared sanitizer ===");
const NUL = String.fromCharCode(0), DEL = String.fromCharCode(127);
check("control chars stripped, newline kept", sanitizeIntakeText(`a${NUL}${DEL}b\nc`) === "ab\nc");
check("<script> kept literal (escaping is the defence, not stripping)", sanitizeIntakeText(XSS) === XSS);
check("capped at 300", sanitizeIntakeText("x".repeat(500)).length === 300);

console.log("\n=== Cleanup ===");
await db.from("payments").delete().eq("booking_id", bookingId);
await db.from("bookings").delete().in("practitioner_id", [prac.id]);
await db.from("services").delete().eq("id", svc.id);
for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
