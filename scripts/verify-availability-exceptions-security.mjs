// Epic 5, slice 3 (+ partial-day blocking extension): proves
// availability_exceptions' RLS ownership holds at the DB level, not
// just in the app's own .eq("practitioner_id", ...) scoping — a
// malicious practitioner B must not be able to create or delete
// practitioner A's blocked dates via a direct API call, while public
// read of a DISCOVERABLE practitioner's exceptions must still work
// (that's required for getBookableSlots to compute correct slots for
// anonymous/other-user visitors — intentional, not a leak). Also
// covers the partial-day (time-range) extension: a malformed range is
// rejected purely by the new CHECK constraints (independent of RLS —
// ownership and row validity are separate, both-solved problems), and
// multiple partial blocks can coexist on one date while a second
// whole-date block on an already-blocked date still cannot (the
// narrowed partial unique index).
//
// Run: node --env-file=.env.local scripts/verify-availability-exceptions-security.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();

async function signUp(role, name) {
  const supabase = createClient(url, key);
  const email = `availexc-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
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
const practitionerA = await signUp("practitioner", `AvailExcPracA ${stamp}`);
const practitionerB = await signUp("practitioner", `AvailExcPracB ${stamp}`);
await new Promise((r) => setTimeout(r, 500));

const usernameA = `availexcA${stamp}`;
await practitionerA.supabase.from("practitioner_profiles").update({ username: usernameA }).eq("id", practitionerA.user.id);
// practitionerB deliberately has no username set — not publicly discoverable.

const blockedDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const { data: exceptionA } = await practitionerA.supabase
  .from("availability_exceptions")
  .insert({ practitioner_id: practitionerA.user.id, exception_date: blockedDate, exception_type: "blocked" })
  .select()
  .single();
check("practitionerA can block their own date", !!exceptionA);

console.log("\n=== 1. practitionerA can read their own exception ===");
const ownRead = await practitionerA.supabase.from("availability_exceptions").select("id").eq("id", exceptionA.id);
check("practitionerA reads their own exception", (ownRead.data ?? []).some((e) => e.id === exceptionA.id));

console.log("\n=== 2. An uninvolved practitioner cannot INSERT an exception for practitionerA ===");
const forgedInsert = await practitionerB.supabase
  .from("availability_exceptions")
  .insert({ practitioner_id: practitionerA.user.id, exception_date: blockedDate, exception_type: "blocked" })
  .select();
check("practitionerB's forged insert (practitioner_id = A) is rejected", !!forgedInsert.error);

console.log("\n=== 3. An uninvolved practitioner cannot DELETE practitionerA's real exception ===");
const forgedDelete = await practitionerB.supabase
  .from("availability_exceptions")
  .delete()
  .eq("id", exceptionA.id)
  .select();
check("practitionerB's delete of A's real exception id affects zero rows", (forgedDelete.data ?? []).length === 0);

const stillThere = await practitionerA.supabase.from("availability_exceptions").select("id").eq("id", exceptionA.id);
check("practitionerA's exception is untouched after B's delete attempt", (stillThere.data ?? []).length === 1);

console.log("\n=== 4. Public read: a DISCOVERABLE practitioner's exception IS readable by an uninvolved user (intended) ===");
const publicRead = await practitionerB.supabase.from("availability_exceptions").select("id").eq("practitioner_id", practitionerA.user.id);
check("practitionerB (uninvolved) can read practitionerA's exception because A is publicly discoverable", (publicRead.data ?? []).some((e) => e.id === exceptionA.id));

const anon = createClient(url, key);
const anonRead = await anon.from("availability_exceptions").select("id").eq("practitioner_id", practitionerA.user.id);
check("anon can also read a discoverable practitioner's exceptions (required for public slot generation)", (anonRead.data ?? []).some((e) => e.id === exceptionA.id));

console.log("\n=== 5. Public read: a NON-discoverable practitioner's (B, no username) exceptions are NOT readable by others ===");
const { data: exceptionB } = await practitionerB.supabase
  .from("availability_exceptions")
  .insert({ practitioner_id: practitionerB.user.id, exception_date: blockedDate, exception_type: "blocked" })
  .select()
  .single();
const crossReadOfNonDiscoverable = await practitionerA.supabase.from("availability_exceptions").select("id").eq("id", exceptionB?.id ?? "");
check("practitionerA cannot read practitionerB's exception (B has no username, not discoverable)", (crossReadOfNonDiscoverable.data ?? []).length === 0);

console.log("\n=== 6. practitionerA can create a partial-day (time-range) block for themselves ===");
const rangeDate = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const { data: partialA } = await practitionerA.supabase
  .from("availability_exceptions")
  .insert({ practitioner_id: practitionerA.user.id, exception_date: rangeDate, exception_type: "blocked", start_time: "14:00", end_time: "16:00" })
  .select()
  .single();
check("practitionerA can create a 14:00-16:00 block", !!partialA);

console.log("\n=== 7. A malformed range is rejected by the CHECK constraints, independent of ownership ===");
const halfSpecified = await practitionerA.supabase
  .from("availability_exceptions")
  .insert({ practitioner_id: practitionerA.user.id, exception_date: rangeDate, exception_type: "blocked", start_time: "10:00", end_time: null })
  .select();
check("a half-specified range (start set, end null) is rejected", !!halfSpecified.error);

const endBeforeStart = await practitionerA.supabase
  .from("availability_exceptions")
  .insert({ practitioner_id: practitionerA.user.id, exception_date: rangeDate, exception_type: "blocked", start_time: "16:00", end_time: "14:00" })
  .select();
check("a range where end <= start is rejected", !!endBeforeStart.error);

const offGrid = await practitionerA.supabase
  .from("availability_exceptions")
  .insert({ practitioner_id: practitionerA.user.id, exception_date: rangeDate, exception_type: "blocked", start_time: "10:05", end_time: "11:00" })
  .select();
check("an off-15-minute-grid start time is rejected", !!offGrid.error);

console.log("\n=== 8. Multiple non-overlapping partial blocks CAN coexist on the same date ===");
const { data: partialA2 } = await practitionerA.supabase
  .from("availability_exceptions")
  .insert({ practitioner_id: practitionerA.user.id, exception_date: rangeDate, exception_type: "blocked", start_time: "09:00", end_time: "10:00" })
  .select()
  .single();
check("a second, non-overlapping partial block on the SAME date succeeds (narrowed unique index)", !!partialA2);

console.log("\n=== 9. A second WHOLE-DATE block on an already-whole-date-blocked date is still rejected (regression) ===");
const duplicateWholeDate = await practitionerA.supabase
  .from("availability_exceptions")
  .insert({ practitioner_id: practitionerA.user.id, exception_date: blockedDate, exception_type: "blocked" })
  .select();
check("a duplicate whole-date block on the same date is still rejected", !!duplicateWholeDate.error);
check("rejection is the unique-index violation specifically", duplicateWholeDate.error?.code === "23505");

console.log("\n=== 10. An uninvolved practitioner cannot INSERT a partial-day block for practitionerA either ===");
const forgedPartialInsert = await practitionerB.supabase
  .from("availability_exceptions")
  .insert({ practitioner_id: practitionerA.user.id, exception_date: rangeDate, exception_type: "blocked", start_time: "11:00", end_time: "12:00" })
  .select();
check("practitionerB's forged partial-block insert (practitioner_id = A) is rejected", !!forgedPartialInsert.error);

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
