// Gallery — storage-write-as-owner + public display checks (complements the
// DB/RLS script). Requires migration 20260905120000 applied + dev server on :3000.
// Run: node --env-file=.env.local scripts/verify-gallery-storage-display.mjs
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db = createClient(URL, process.env.SUPABASE_SECRET_KEY);
const PW = "twelvecharspw1";
const stamp = Date.now();
let failures = 0;
const created = [];
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };
// 1x1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

(async () => {
  try {
    const email = `galdisp-${stamp}@example.com`;
    const { data: u } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role: "practitioner", display_name: `Gallery Disp ${stamp}` } });
    created.push(u.user.id);
    const uid = u.user.id;
    const uname = `gd${stamp}`;
    for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", uid).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
    await db.from("practitioner_profiles").update({ username: uname, timezone: "Europe/Sofia", bio: "About text here", headline: "h", location: "Sofia", specialties: ["coaching"] }).eq("id", uid);

    console.log("=== storage: owner can upload to avatars/<uid>/gallery-* ===");
    const c = createClient(URL, ANON);
    await c.auth.signInWithPassword({ email, password: PW });
    const path = `${uid}/gallery-${stamp}.png`;
    const { error: upErr } = await c.storage.from("avatars").upload(path, PNG, { contentType: "image/png", upsert: false });
    check("owner uploads to their own gallery path", !upErr, upErr?.message);
    const { data: { publicUrl } } = c.storage.from("avatars").getPublicUrl(path);

    // Someone else must NOT be able to write into this user's folder.
    const other = await db.auth.admin.createUser({ email: `galother-${stamp}@example.com`, password: PW, email_confirm: true, user_metadata: { role: "practitioner" } });
    created.push(other.data.user.id);
    const oc = createClient(URL, ANON);
    await oc.auth.signInWithPassword({ email: `galother-${stamp}@example.com`, password: PW });
    const { error: crossErr } = await oc.storage.from("avatars").upload(`${uid}/gallery-intruder.png`, PNG, { contentType: "image/png" });
    check("another user CANNOT write into this user's folder", !!crossErr, crossErr?.message);

    console.log("\n=== display: gallery renders after About on public profile ===");
    const caption = `Caption ${stamp}`;
    await db.from("practitioner_gallery").insert({ practitioner_id: uid, storage_path: path, image_url: publicUrl, caption, position: 0 });
    const html = await (await fetch(`http://localhost:3000/p/${uname}`)).text();
    check("public profile returns the caption text", html.includes(caption));
    const galleryHeadingIdx = Math.max(html.indexOf("Галерия"), html.indexOf(">Gallery<"));
    const aboutIdx = Math.max(html.indexOf("Относно мен"), html.indexOf("About me"));
    check("Gallery heading present", galleryHeadingIdx !== -1);
    check("Gallery section appears AFTER About section", aboutIdx !== -1 && galleryHeadingIdx > aboutIdx, `about@${aboutIdx} gallery@${galleryHeadingIdx}`);
    check("image url rendered in an <img>", html.includes(publicUrl));
  } catch (e) {
    console.error("THREW:", e);
    failures++;
  } finally {
    for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
    console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
