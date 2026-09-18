// Boundary check for the widened headline (350) / bio (3000) CHECK constraints
// (migration 20260918160000). Creates a throwaway practitioner, asserts the new
// max lengths WRITE and one-over each is REJECTED, then cleans up.
// Run: node --env-file=.env.local scripts/verify-headline-bio-length.mjs

import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
let failures = 0;
const check = (l, c) => { console.log(`${c ? "PASS" : "FAIL"} — ${l}`); if (!c) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const email = `hb-len-${stamp}@example.com`;
const { data: u, error: uerr } = await db.auth.admin.createUser({ email, password: "twelvecharspw1", email_confirm: true, user_metadata: { role: "practitioner", display_name: "HB Len" } });
if (uerr) { console.error(uerr); process.exit(1); }
const id = u.user.id;
for (let i = 0; i < 25; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", id).maybeSingle()).data) break; await sleep(200); }

const upd = (col, len) => db.from("practitioner_profiles").update({ [col]: "x".repeat(len) }).eq("id", id);

check("headline = 350 accepted", !(await upd("headline", 350)).error);
check("headline = 351 rejected", !!(await upd("headline", 351)).error);
check("bio = 3000 accepted", !(await upd("bio", 3000)).error);
check("bio = 3001 rejected", !!(await upd("bio", 3001)).error);

await db.auth.admin.deleteUser(id).catch(() => {});
console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
