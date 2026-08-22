// Taxonomy landing pages — guardrails. Confirms the reserved-slug set stays in
// sync with the real routes, that no authored category slug collides with a route,
// and (live) that an authored page renders while its static-route neighbours still
// win. No DB/browser needed. Run: node scripts/verify-taxonomy.mjs
import { readdirSync, readFileSync } from "node:fs";

const BASE = "http://localhost:3000";
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined && d !== "" ? `  (${d})` : ""}`); };

// Real top-level routes that sit alongside [category] under app/[locale]/.
const realRoutes = readdirSync("app/[locale]", { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("["))
  .map((d) => d.name);

// The reserved set as declared in lib/taxonomy.ts (parsed from source so the test
// checks the SHIPPED list, not a copy).
const taxSrc = readFileSync("lib/taxonomy.ts", "utf8");
const block = taxSrc.match(/RESERVED_CATEGORY_SLUGS = new Set<string>\(\[([\s\S]*?)\]\)/);
const reserved = new Set(block ? [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : []);

// Authored slugs across both taxonomies.
const authoredSlugs = ["data/specialties.json", "data/topics.json"]
  .flatMap((f) => JSON.parse(readFileSync(f, "utf8")))
  .filter((e) => e.slug)
  .map((e) => e.slug);

(async () => {
  console.log("=== Reserved-slug guardrails ===");
  const drift = realRoutes.filter((r) => !reserved.has(r));
  check("RESERVED_CATEGORY_SLUGS covers every real top-level route (no drift)", drift.length === 0, `uncovered: ${drift.join(", ")}`);

  const stale = [...reserved].filter((r) => !realRoutes.includes(r));
  check("no reserved slug names a route that no longer exists", stale.length === 0, `stale: ${stale.join(", ")}`);

  const colliding = authoredSlugs.filter((s) => reserved.has(s) || realRoutes.includes(s));
  check("no authored category slug collides with a route", colliding.length === 0, `colliding: ${colliding.join(", ")}`);

  console.log(`  (authored slugs: ${authoredSlugs.join(", ") || "none"})`);

  console.log("\n=== Live: authored page renders, static neighbours still win ===");
  try {
    const taro = await fetch(`${BASE}/bg/taro`, { redirect: "manual" });
    const taroBody = await taro.text();
    check("authored category /bg/taro renders (200 + intro copy)", taro.status === 200 && taroBody.includes("Таро е метод"), `status ${taro.status}`);

    // A static sibling and a non-authored category — both must NOT show category intro copy.
    for (const seg of ["browse", "faq"]) {
      const r = await fetch(`${BASE}/bg/${seg}`, { redirect: "manual" });
      check(`static route /bg/${seg} still resolves (200)`, r.status === 200, `status ${r.status}`);
    }
    const astro = await fetch(`${BASE}/bg/astrology`, { redirect: "manual" });
    check("non-authored category /bg/astrology 404s", astro.status === 404, `status ${astro.status}`);
  } catch (e) {
    check("live checks reachable (dev server on :3000)", false, e.message);
  }

  console.log(failures === 0 ? "\nALL PASS ✓" : `\n${failures} FAIL ✗`);
  process.exit(failures === 0 ? 0 : 1);
})();
