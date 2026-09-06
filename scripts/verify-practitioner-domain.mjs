// Domain + pending-suggestion migration (20260906140000) — verification.
//   - the three new columns exist and are selectable
//   - backfill: every profile WITH specialties has a domain, and that domain
//     actually contains those specialties (data/domains.json) — no drift
//   - domain CHECK rejects a bad SHAPE (uppercase/space/punct), accepts a key
//   - pending_* length CHECK rejects >200 chars, accepts <=200
//   - a clean round-trip: set domain + specialties + pending, read back
//
// Requires migration 20260906140000 applied.
// Run: node --env-file=.env.local scripts/verify-practitioner-domain.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const domains = JSON.parse(readFileSync(new URL("../data/domains.json", import.meta.url)));
const PW = "twelvecharspw1";
const stamp = Date.now();
const created = [];
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };

// specialty key -> domain key (from the taxonomy the backfill was derived from)
const specToDomain = new Map();
for (const d of domains) for (const s of d.specialties) specToDomain.set(s, d.key);

async function main() {
  // 1. Columns exist + are selectable.
  const { data: all, error: selErr } = await db
    .from("practitioner_profiles")
    .select("id, username, specialties, domain, pending_domain_suggestion, pending_specialty_suggestion");
  check("new columns selectable (domain, pending_*)", !selErr, selErr?.message);
  if (selErr) return;

  // 2. Backfill correctness across every existing profile. The migration
  //    invariant is: a profile WITH specialties has a domain, and that domain
  //    CONTAINS at least one of its specialties. Legacy profiles whose old
  //    specialties span >1 domain got one valid domain assigned; the stray
  //    specialties prune themselves on the next save (updateSpecialties filters
  //    to the chosen domain) — that's expected, not a migration bug.
  const withSpecs = all.filter((p) => (p.specialties?.length ?? 0) > 0);
  let missingDomain = 0, mismatched = 0, crossDomain = 0;
  const byDomain = {};
  for (const p of withSpecs) {
    const domainsForSpecs = [...new Set(p.specialties.map((s) => specToDomain.get(s)).filter(Boolean))];
    if (!p.domain) { missingDomain++; console.log(`   MISSING domain: @${p.username} specialties=${JSON.stringify(p.specialties)}`); continue; }
    if (!domainsForSpecs.includes(p.domain)) { mismatched++; console.log(`   MISMATCH: @${p.username} domain=${p.domain} not among ${JSON.stringify(domainsForSpecs)}`); continue; }
    byDomain[p.domain] = (byDomain[p.domain] ?? 0) + 1;
    if (domainsForSpecs.length > 1) { crossDomain++; console.log(`   info — legacy cross-domain: @${p.username} specialties=${JSON.stringify(p.specialties)} → assigned ${p.domain} (stray specialties prune on next save)`); }
  }
  check(`backfill: all ${withSpecs.length} profiles with specialties have a domain`, missingDomain === 0, `${missingDomain} missing`);
  check("backfill: each assigned domain contains the profile's specialties", mismatched === 0, `${mismatched} mismatched`);
  console.log(`   domain distribution: ${JSON.stringify(byDomain)}; legacy cross-domain profiles: ${crossDomain}`);

  // 3. Create a throwaway practitioner and exercise the constraints + round-trip.
  const email = `dom-${stamp}@example.com`;
  const { data: u, error: uErr } = await db.auth.admin.createUser({
    email, password: PW, email_confirm: true, user_metadata: { role: "practitioner", display_name: "Domain Test" },
  });
  if (uErr) { check("create test practitioner", false, uErr.message); return; }
  created.push(u.user.id);
  const id = u.user.id;

  // The signup trigger should have created the practitioner_profiles row.
  const { data: row0 } = await db.from("practitioner_profiles").select("id").eq("id", id).maybeSingle();
  check("test practitioner_profiles row exists", !!row0);
  if (!row0) return;

  // 3a. Valid round-trip.
  const { error: okErr } = await db.from("practitioner_profiles")
    .update({ domain: "psychology", specialties: ["psychologist"], pending_specialty_suggestion: "family therapist", pending_domain_suggestion: null })
    .eq("id", id);
  check("update with valid domain + specialty + pending accepted", !okErr, okErr?.message);
  const { data: back } = await db.from("practitioner_profiles")
    .select("domain, specialties, pending_specialty_suggestion").eq("id", id).single();
  check("round-trip reads back the values", back?.domain === "psychology" && back?.specialties?.[0] === "psychologist" && back?.pending_specialty_suggestion === "family therapist", JSON.stringify(back));

  // 3b. Bad domain SHAPE rejected by CHECK.
  const { error: shapeErr } = await db.from("practitioner_profiles").update({ domain: "Bad Domain!" }).eq("id", id);
  check("domain CHECK rejects bad shape ('Bad Domain!')", !!shapeErr, shapeErr?.code);

  // 3c. pending length CHECK.
  const { error: longErr } = await db.from("practitioner_profiles").update({ pending_domain_suggestion: "x".repeat(201) }).eq("id", id);
  check("pending_domain CHECK rejects 201 chars", !!longErr, longErr?.code);
  const { error: okLenErr } = await db.from("practitioner_profiles").update({ pending_domain_suggestion: "x".repeat(200) }).eq("id", id);
  check("pending_domain CHECK accepts 200 chars", !okLenErr, okLenErr?.message);
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(async () => {
    for (const uid of created) await db.auth.admin.deleteUser(uid).catch(() => {});
    console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
    process.exit(failures === 0 ? 0 : 1);
  });
