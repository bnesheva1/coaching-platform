// Webhook alerting hardening — verification.
//
//  #3 signature-failure recording: a forged Stripe / LiveKit webhook (bad
//     signature) → 400 AND a webhook_failures row is recorded (previously a
//     wrong signing secret 400'd silently). Proven end-to-end against the live
//     dev route.
//  #2 config check wired: /admin/health renders the "Stripe webhooks"
//     dependency + the "LiveKit webhook config" manual-check note.
//
//  (#1 subscription-handler-throw and the derived required-events list are
//   code-level; exercised by the subscription verify scripts + reviewed.)
//
// Requires the dev server running. Playwright installed --no-save.
// Run: node --env-file=.env.local scripts/verify-webhook-alerting.mjs
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const PW = "twelvecharspw1";
const stamp = Date.now();
const startIso = new Date(Date.now() - 2000).toISOString();
const created = [];
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };

async function recentFailure(source, needle) {
  for (let i = 0; i < 15; i++) {
    const { data } = await db
      .from("webhook_failures")
      .select("source, reason, created_at")
      .eq("source", source)
      .gte("created_at", startIso)
      .order("created_at", { ascending: false })
      .limit(5);
    const hit = (data ?? []).find((r) => (r.reason ?? "").includes(needle));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function main() {
  console.log("=== #3 Stripe: forged signature is recorded ===");
  const sres = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
    body: JSON.stringify({ id: "evt_forged", object: "event", type: "checkout.session.completed" }),
  });
  check("forged Stripe webhook → 400", sres.status === 400, sres.status);
  const sfail = await recentFailure("stripe", "signature verification failed");
  check("Stripe signature failure RECORDED to webhook_failures", !!sfail, sfail?.reason?.slice(0, 60));

  console.log("\n=== #3 LiveKit: forged signature is recorded ===");
  const lres = await fetch(`${BASE}/api/webhooks/livekit`, {
    method: "POST",
    headers: { "content-type": "application/webhook+json", authorization: "bogus.jwt.token" },
    body: JSON.stringify({ event: "room_started" }),
  });
  check("forged LiveKit webhook → 400", lres.status === 400, lres.status);
  const lfail = await recentFailure("livekit", "signature verification failed");
  check("LiveKit signature failure RECORDED to webhook_failures", !!lfail, lfail?.reason?.slice(0, 60));

  console.log("\n=== #2 Health page wiring (admin) ===");
  const email = `wh-admin-${stamp}@example.com`;
  const { data: u, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role: "client", display_name: `WH Admin ${stamp}` } });
  if (error) throw error;
  created.push(u.user.id);
  await new Promise((r) => setTimeout(r, 300));
  await db.from("profiles").update({ role: "admin" }).eq("id", u.user.id);

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 160)));
  try {
    await page.goto(`${BASE}/bg/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await page.click('button[type="submit"]');
    await page.waitForURL((x) => !x.pathname.includes("/login"), { timeout: 30000 });
    await page.goto(`${BASE}/bg/admin/health`, { waitUntil: "networkidle", timeout: 60000 });
    const stripeWebhooks = await page.getByText("Stripe webhooks", { exact: true }).count();
    const livekitNote = await page.getByText("LiveKit webhook config", { exact: true }).count();
    check("health page shows the 'Stripe webhooks' dependency check", stripeWebhooks >= 1, stripeWebhooks);
    check("health page shows the 'LiveKit webhook config' manual note", livekitNote >= 1, livekitNote);
  } finally {
    await browser.close();
  }

  console.log("\n=== Cleanup (remove test failure rows + admin) ===");
  await db.from("webhook_failures").delete().gte("created_at", startIso).in("source", ["stripe", "livekit"]);
  for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
