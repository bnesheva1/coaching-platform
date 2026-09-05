// Gallery image processing — unit checks for the sharp transform the upload
// action applies (no DB, no server). Verifies: any source (incl. portrait) is
// forced to a 1200x675 16:9 WebP; metadata/EXIF is stripped by the re-encode;
// SVG and non-images are detected/rejected.
// Run: node scripts/verify-image-pipeline.ts
import sharp from "sharp";

const W = 1200;
const H = 675;
let failures = 0;
const check = (l: string, c: boolean, d?: unknown) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${JSON.stringify(d)})` : ""}`); };

// The exact transform addGalleryImage uses.
async function transformImage(input: Buffer): Promise<Buffer> {
  return sharp(input, { animated: false })
    .rotate()
    .resize(W, H, { fit: "cover", position: "centre" })
    .webp({ quality: 82 })
    .toBuffer();
}

(async () => {
  // A tall PORTRAIT source (600x1200) with embedded EXIF — the hard case the
  // spec calls out: still force the 16:9 centre-crop rather than rejecting.
  const portrait = await sharp({ create: { width: 600, height: 1200, channels: 3, background: { r: 200, g: 80, b: 60 } } })
    .withExif({ IFD0: { Copyright: "SENSITIVE-EXIF-MARKER" } })
    .jpeg()
    .toBuffer();

  const out = await transformImage(portrait);
  const meta = await sharp(out).metadata();
  check("portrait forced to exactly 1200x675", meta.width === W && meta.height === H, { w: meta.width, h: meta.height });
  check("output re-encoded as WebP", meta.format === "webp", meta.format);
  check("EXIF stripped by re-encode", !meta.exif, { hasExif: !!meta.exif });
  check("no embedded ICC/metadata leakage", !meta.icc);
  const exifText = out.toString("latin1");
  check("EXIF marker not present in output bytes", !exifText.includes("SENSITIVE-EXIF-MARKER"));

  // A very wide LANDSCAPE source (3000x1000) also comes out exactly 16:9.
  const wide = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: { r: 30, g: 90, b: 200 } } }).png().toBuffer();
  const wideMeta = await sharp(await transformImage(wide)).metadata();
  check("wide landscape forced to 1200x675", wideMeta.width === W && wideMeta.height === H, { w: wideMeta.width, h: wideMeta.height });

  // SVG must be detectable (the action rejects format === 'svg').
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  const svgMeta = await sharp(svg).metadata().catch(() => null);
  check("SVG detected as format 'svg' (so action rejects it)", svgMeta?.format === "svg", svgMeta?.format);

  // Non-image bytes must throw on metadata (the action treats that as invalid).
  let threw = false;
  try { await sharp(Buffer.from("this is definitely not an image")).metadata(); } catch { threw = true; }
  check("garbage bytes rejected by sharp metadata", threw);

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
