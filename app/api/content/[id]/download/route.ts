import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

// Gated PDF delivery. Every hit re-verifies a completed purchase, loads the
// master with the service role, stamps a fresh per-buyer footer, and streams the
// result — nothing buyer-specific is ever stored, and there is no signed or
// bookmarkable link at any point (the URL is stable but useless without an
// authenticated, entitled session).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Entitlement is the RPC: it returns the unlock fields ONLY for a completed
  // purchaser of this item (zero rows otherwise). This is the same authorised
  // read path the embed uses — a non-purchaser gets nothing here.
  const { data: rows } = await supabase.rpc("get_purchased_content_item", { p_item_id: id });
  const item = Array.isArray(rows) ? rows[0] : null;
  if (!item || item.type !== "pdf" || !item.pdf_storage_path) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const svc = createServiceRoleClient();
  const { data: file, error } = await svc.storage.from("content-pdfs").download(item.pdf_storage_path as string);
  if (error || !file) {
    console.error("content download: master fetch failed", { itemId: id, error });
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }
  const { data: purchase } = await svc
    .from("content_purchases")
    .select("purchased_at")
    .eq("content_item_id", id)
    .eq("buyer_id", user.id)
    .eq("status", "completed")
    .maybeSingle();

  // Stamp a subtle footer on every page. We use the EMAIL (ASCII-safe) rather
  // than the display name: StandardFonts.Helvetica is WinAnsi-encoded and would
  // throw on a Cyrillic name — the platform is Bulgarian-first. "name or email"
  // per spec; a Cyrillic-capable embedded font is a later refinement.
  const purchasedDate = (purchase?.purchased_at ? new Date(purchase.purchased_at as string) : new Date()).toISOString().slice(0, 10);
  const footer = `${user.email ?? user.id} · ${purchasedDate}`;

  let out: Uint8Array;
  try {
    const pdf = await PDFDocument.load(await file.arrayBuffer());
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const page of pdf.getPages()) {
      page.drawText(footer, { x: 24, y: 16, size: 7, font, color: rgb(0.5, 0.5, 0.5), opacity: 0.7 });
    }
    out = await pdf.save();
  } catch (err) {
    console.error("content download: pdf stamp failed", { itemId: id, err });
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }

  const filename = `${(item.title as string).replace(/[^\w.-]+/g, "_").slice(0, 60) || "document"}.pdf`;
  return new NextResponse(out as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      // Fresh each time; never cached, never a reusable link.
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store, private",
    },
  });
}
