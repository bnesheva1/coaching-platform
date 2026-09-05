// Gallery/Videos — storage-write-as-owner + public display + section order.
// Requires migration 20260905130000 applied + dev server on :3000.
// Run: node --env-file=.env.local scripts/verify-gallery-storage-display.mjs
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db = createClient(URL, process.env.SUPABASE_SECRET_KEY);
const PW = "twelvecharspw1";
const stamp = Date.now();
let failures = 0;
const created = [];
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };

(async () => {
  try {
    const email = `meddisp-${stamp}@example.com`;
    const { data: u } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role: "practitioner", display_name: `Media ${stamp}` } });
    created.push(u.user.id);
    const uid = u.user.id;
    const uname = `md${stamp}`;
    for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", uid).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
    await db.from("practitioner_profiles").update({ username: uname, timezone: "Europe/Sofia", bio: "About text", headline: "h", location: "Sofia", specialties: ["coaching"] }).eq("id", uid);

    console.log("=== storage: owner uploads a processed 16:9 webp ===");
    const webp = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 20, g: 120, b: 90 } } })
      .resize(1200, 675, { fit: "cover" }).webp().toBuffer();
    const c = createClient(URL, ANON);
    await c.auth.signInWithPassword({ email, password: PW });
    const path = `${uid}/gallery-${stamp}.webp`;
    const { error: upErr } = await c.storage.from("avatars").upload(path, webp, { contentType: "image/webp", upsert: false });
    check("owner uploads processed webp to their gallery path", !upErr, upErr?.message);
    const { data: { publicUrl } } = c.storage.from("avatars").getPublicUrl(path);

    const other = await db.auth.admin.createUser({ email: `medother-${stamp}@example.com`, password: PW, email_confirm: true, user_metadata: { role: "practitioner" } });
    created.push(other.data.user.id);
    const oc = createClient(URL, ANON);
    await oc.auth.signInWithPassword({ email: `medother-${stamp}@example.com`, password: PW });
    const { error: crossErr } = await oc.storage.from("avatars").upload(`${uid}/gallery-intruder.webp`, webp, { contentType: "image/webp" });
    check("another user CANNOT write into this user's folder", !!crossErr, crossErr?.message);

    console.log("\n=== rows + public display + section order ===");
    await db.from("practitioner_gallery").insert({ practitioner_id: uid, storage_path: path, sort_order: 0 });
    const ytId = "dQw4w9WgXcQ";
    const thumb = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;
    const vTitle = `Vid ${stamp}`;
    await db.from("practitioner_videos").insert({ practitioner_id: uid, url: `https://youtu.be/${ytId}`, platform: "youtube", video_id: ytId, title: vTitle, thumbnail_url: thumb, sort_order: 0 });

    const html = await (await fetch(`http://localhost:3000/p/${uname}`)).text();
    check("gallery image URL rendered", html.includes(publicUrl));
    check("video thumbnail rendered", html.includes(thumb));
    check("video title rendered", html.includes(vTitle));

    const iAbout = Math.max(html.indexOf("Относно мен"), html.indexOf("About me"));
    const iServices = html.indexOf('id="services"');
    const iVideos = Math.max(html.indexOf(">Видеа<"), html.indexOf(">Videos<"));
    const iGallery = Math.max(html.indexOf(">Галерия<"), html.indexOf(">Gallery<"));
    check("all four section anchors present", [iAbout, iServices, iVideos, iGallery].every((x) => x !== -1), `${iAbout},${iServices},${iVideos},${iGallery}`);
    check("order is About < Services < Videos < Gallery", iAbout < iServices && iServices < iVideos && iVideos < iGallery, `${iAbout} < ${iServices} < ${iVideos} < ${iGallery}`);

    console.log("\n=== iframe NOT server-rendered (embed only opens client-side in the modal) ===");
    check("no <iframe> in initial HTML (built client-side on click)", !html.includes("<iframe"));
  } catch (e) {
    console.error("THREW:", e);
    failures++;
  } finally {
    for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
    console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
