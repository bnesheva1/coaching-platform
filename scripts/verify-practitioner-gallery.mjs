// Practitioner gallery — verification. Table + 3-image cap trigger + caption
// CHECK, RLS (owner-only writes, public read, cross-owner denial), position
// ordering, and cascade on practitioner delete. Requires migration
// 20260905120000 applied.
// Run: node --env-file=.env.local scripts/verify-practitioner-gallery.mjs
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(URL, process.env.SUPABASE_SECRET_KEY); // service role (bypasses RLS)
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const PW = "twelvecharspw1";
const stamp = Date.now();
let failures = 0;
const created = [];
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };

async function mk(role, name) {
  const email = `gal-${role}-${stamp}-${Math.random().toString(36).slice(2, 5)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role, display_name: name } });
  if (error) throw error;
  created.push(data.user.id);
  await new Promise((r) => setTimeout(r, 400));
  return { id: data.user.id, email, name };
}
async function setupPractitioner(prac, uname) {
  for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", prac.id).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
  await db.from("practitioner_profiles").update({ username: uname, timezone: "Europe/Sofia", bio: "b", headline: "h", location: "Sofia", specialties: ["coaching"] }).eq("id", prac.id);
}
// An anon-key client signed in as a specific user — RLS applies to it, unlike `db`.
async function asUser(email) {
  const c = createClient(URL, ANON);
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  return c;
}
const img = (n) => ({ storage_path: `x/gallery-${n}-${stamp}`, image_url: `https://example.com/${n}.jpg` });

(async () => {
  try {
    console.log("=== Setup ===");
    const A = await mk("practitioner", `Prac A ${stamp}`);
    const B = await mk("practitioner", `Prac B ${stamp}`);
    await setupPractitioner(A, `ga${stamp}`);
    await setupPractitioner(B, `gb${stamp}`);
    const aClient = await asUser(A.email);
    const bClient = await asUser(B.email);
    const anon = createClient(URL, ANON);

    console.log("\n=== 3-image cap trigger (service role) ===");
    for (let i = 0; i < 3; i++) {
      const { error } = await db.from("practitioner_gallery").insert({ practitioner_id: A.id, position: i, ...img(i) });
      check(`insert image ${i + 1}/3`, !error, error?.message);
    }
    const { error: fourth } = await db.from("practitioner_gallery").insert({ practitioner_id: A.id, position: 3, ...img(3) });
    check("4th image rejected by cap trigger", !!fourth, fourth?.message);

    console.log("\n=== caption CHECK (<=100) ===");
    const firstId = (await db.from("practitioner_gallery").select("id").eq("practitioner_id", A.id).order("position").limit(1).single()).data.id;
    const { error: longCap } = await db.from("practitioner_gallery").update({ caption: "x".repeat(101) }).eq("id", firstId);
    check("101-char caption rejected", !!longCap, longCap?.message);
    const { error: okCap } = await db.from("practitioner_gallery").update({ caption: "x".repeat(100) }).eq("id", firstId);
    check("100-char caption accepted", !okCap, okCap?.message);

    console.log("\n=== RLS: public read ===");
    const { data: pubRows, error: pubErr } = await anon.from("practitioner_gallery").select("id, image_url, caption, position").eq("practitioner_id", A.id).order("position");
    check("anon (guest) can read a practitioner's gallery", !pubErr && (pubRows?.length ?? 0) === 3, pubErr?.message ?? `${pubRows?.length} rows`);
    check("rows come back in position order", !!pubRows && pubRows.every((r, i) => r.position === i));

    console.log("\n=== RLS: owner-only writes ===");
    // B currently has 0 images; B inserting for THEMSELF is fine.
    const { error: bOwn } = await bClient.from("practitioner_gallery").insert({ practitioner_id: B.id, position: 0, ...img("b0") });
    check("owner (B) can insert their own image", !bOwn, bOwn?.message);
    // B trying to insert a row owned by A must fail the WITH CHECK policy.
    const { error: bForA } = await bClient.from("practitioner_gallery").insert({ practitioner_id: A.id, position: 9, ...img("bForA") });
    check("B cannot insert into A's gallery (RLS with-check)", !!bForA, bForA?.message);
    // B trying to update/delete A's row: RLS makes it match 0 rows (no error, no effect).
    const { data: bUpd } = await bClient.from("practitioner_gallery").update({ caption: "hacked" }).eq("id", firstId).select("id");
    check("B cannot update A's image (0 rows affected)", (bUpd?.length ?? 0) === 0);
    const { data: bDel } = await bClient.from("practitioner_gallery").delete().eq("id", firstId).select("id");
    check("B cannot delete A's image (0 rows affected)", (bDel?.length ?? 0) === 0);
    const stillThere = (await db.from("practitioner_gallery").select("caption").eq("id", firstId).single()).data;
    check("A's image survived B's attempts", stillThere?.caption === "x".repeat(100), stillThere?.caption?.slice(0, 12));

    console.log("\n=== RLS: owner can edit/remove own ===");
    const { data: aUpd } = await aClient.from("practitioner_gallery").update({ caption: "mine" }).eq("id", firstId).select("id");
    check("A can update own caption", (aUpd?.length ?? 0) === 1);
    const { data: aDel } = await aClient.from("practitioner_gallery").delete().eq("id", firstId).select("id");
    check("A can delete own image", (aDel?.length ?? 0) === 1);

    // Now A is UNDER the 3-image cap, so the cap trigger can't be what stops a
    // cross-owner insert — this isolates the RLS with-check policy specifically.
    const { error: bForAClean } = await bClient.from("practitioner_gallery").insert({ practitioner_id: A.id, position: 5, ...img("bForAClean") });
    check("B cannot insert into A's gallery even under cap (RLS with-check, not trigger)", !!bForAClean, bForAClean?.message);

    console.log("\n=== cascade on practitioner delete ===");
    await db.auth.admin.deleteUser(B.id);
    created.splice(created.indexOf(B.id), 1);
    await new Promise((r) => setTimeout(r, 500));
    const { count: bCount } = await db.from("practitioner_gallery").select("id", { count: "exact", head: true }).eq("practitioner_id", B.id);
    check("B's gallery rows removed on account delete (cascade)", (bCount ?? 0) === 0, `${bCount} rows`);
  } catch (e) {
    console.error("THREW:", e);
    failures++;
  } finally {
    for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
    console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
