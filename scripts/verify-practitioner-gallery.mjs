// Practitioner gallery + videos — DB verification. Tables, 9-item cap triggers,
// RLS (owner-only writes, public read, cross-owner denial), platform CHECK,
// ordering, and cascade on practitioner delete. Requires migration
// 20260905130000 applied.
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
  const email = `med-${role}-${stamp}-${Math.random().toString(36).slice(2, 5)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role, display_name: name } });
  if (error) throw error;
  created.push(data.user.id);
  await new Promise((r) => setTimeout(r, 400));
  return { id: data.user.id, email };
}
async function setupPractitioner(prac, uname) {
  for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", prac.id).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
  await db.from("practitioner_profiles").update({ username: uname, timezone: "Europe/Sofia", bio: "b", headline: "h", location: "Sofia", specialties: ["coaching"] }).eq("id", prac.id);
}
async function asUser(email) {
  const c = createClient(URL, ANON);
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  return c;
}
const gImg = (n) => ({ storage_path: `x/gallery-${n}-${stamp}.webp` });
const vid = (n) => ({ url: `https://youtu.be/vid${stamp}${n}`, platform: "youtube", video_id: `id${n}${stamp}`.slice(0, 11) });

(async () => {
  try {
    console.log("=== Setup ===");
    const A = await mk("practitioner", `A ${stamp}`);
    const B = await mk("practitioner", `B ${stamp}`);
    await setupPractitioner(A, `ma${stamp}`);
    await setupPractitioner(B, `mb${stamp}`);
    const aClient = await asUser(A.email);
    const bClient = await asUser(B.email);
    const anon = createClient(URL, ANON);

    for (const table of ["practitioner_gallery", "practitioner_videos"]) {
      const isGallery = table === "practitioner_gallery";
      const row = (n) => ({ practitioner_id: A.id, sort_order: n, ...(isGallery ? gImg(n) : vid(n)) });
      console.log(`\n=== ${table}: 9-item cap trigger ===`);
      for (let i = 0; i < 9; i++) {
        const { error } = await db.from(table).insert(row(i));
        if (error) { check(`insert ${i + 1}/9`, false, error.message); break; }
      }
      const { count } = await db.from(table).select("id", { count: "exact", head: true }).eq("practitioner_id", A.id);
      check("9 inserted", count === 9, count);
      const { error: tenth } = await db.from(table).insert(row(9));
      check("10th rejected by cap trigger", !!tenth, tenth?.message);

      console.log(`=== ${table}: public read + ordering ===`);
      const { data: pub, error: pubErr } = await anon.from(table).select("id, sort_order").eq("practitioner_id", A.id).order("sort_order");
      check("anon can read (public content)", !pubErr && pub?.length === 9, pubErr?.message ?? `${pub?.length}`);
      check("returned in sort_order", !!pub && pub.every((r, i) => r.sort_order === i));

      console.log(`=== ${table}: RLS owner-only writes ===`);
      // A is at cap, so delete one first to isolate the RLS with-check from the trigger.
      const firstId = pub[0].id;
      await db.from(table).delete().eq("id", firstId);
      const { error: bForA } = await bClient.from(table).insert(row(0));
      check("B cannot insert into A's rows (RLS with-check, under cap)", !!bForA && /row-level security/.test(bForA.message), bForA?.message);
      const anyA = (await db.from(table).select("id").eq("practitioner_id", A.id).limit(1).single()).data.id;
      const { data: bDel } = await bClient.from(table).delete().eq("id", anyA).select("id");
      check("B cannot delete A's row (0 rows)", (bDel?.length ?? 0) === 0);
    }

    console.log("\n=== platform CHECK (videos) ===");
    const { error: badPlatform } = await db.from("practitioner_videos").insert({ practitioner_id: B.id, url: "x", platform: "dailymotion", video_id: "x", sort_order: 0 });
    check("invalid platform rejected by CHECK", !!badPlatform, badPlatform?.message);

    console.log("\n=== cascade on practitioner delete ===");
    await db.auth.admin.deleteUser(A.id);
    created.splice(created.indexOf(A.id), 1);
    await new Promise((r) => setTimeout(r, 500));
    const { count: gLeft } = await db.from("practitioner_gallery").select("id", { count: "exact", head: true }).eq("practitioner_id", A.id);
    const { count: vLeft } = await db.from("practitioner_videos").select("id", { count: "exact", head: true }).eq("practitioner_id", A.id);
    check("gallery + video rows removed on account delete", (gLeft ?? 0) === 0 && (vLeft ?? 0) === 0, `g=${gLeft} v=${vLeft}`);
  } catch (e) {
    console.error("THREW:", e);
    failures++;
  } finally {
    for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
    console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
