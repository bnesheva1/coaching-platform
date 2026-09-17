"use server";

import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect as redirectExternal } from "next/navigation";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { parseYoutubeInput } from "@/lib/content/video";
import { validateDocumentBytes } from "@/lib/documents/validate";
import { CONTENT_PDF_MAX_BYTES } from "@/lib/content/config";
import { initiateContentPurchase } from "@/lib/payments/content";
import { SITE_URL } from "@/lib/seo";

export type ContentActionState = { error?: string; success?: boolean; id?: string } | null;

const MAX_TITLE = 200;
const MAX_DESC = 4000;
const MIN_PRICE_CENTS = 100;
const MAX_PRICE_CENTS = 500000;

// Create or edit a content item's metadata (title/description/price + the video
// id for video items). The PDF file is uploaded separately (uploadContentPdf).
// Owner writes go through the caller's session — RLS confines them to their own
// rows; .select("id") only, since the column grant hides the unlock fields.
export async function saveContentItem(_prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  const t = await getTranslations("DigitalProducts");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("genericError") };

  const id = (formData.get("id") as string | null)?.trim() || null;
  const type = formData.get("type") as string | null;
  const title = (formData.get("title") as string | null)?.trim() ?? "";
  const description = (formData.get("description") as string | null)?.trim() || null;
  const priceRaw = (formData.get("price") as string | null)?.trim() ?? "";

  if (type !== "video_youtube" && type !== "pdf") return { error: t("genericError") };
  if (title.length < 1 || title.length > MAX_TITLE) return { error: t("titleRequired") };
  if (description && description.length > MAX_DESC) return { error: t("descTooLong") };

  const priceCents = Math.round(Number(priceRaw) * 100);
  if (!Number.isFinite(priceCents) || priceCents < MIN_PRICE_CENTS || priceCents > MAX_PRICE_CENTS) {
    return { error: t("priceRange") };
  }

  let youtubeVideoId: string | null = null;
  if (type === "video_youtube") {
    youtubeVideoId = parseYoutubeInput((formData.get("youtube") as string | null) ?? "");
    if (!youtubeVideoId) return { error: t("badVideo") };
  }

  if (id) {
    // Edit — never changes type (a video item stays a video item); only the
    // fields for its own type are touched.
    const patch: Record<string, unknown> = { title, description, price_cents: priceCents, updated_at: new Date().toISOString() };
    if (type === "video_youtube") patch.youtube_video_id = youtubeVideoId;
    const { data, error } = await supabase.from("content_items").update(patch).eq("id", id).select("id");
    if (error || !data || data.length === 0) return { error: t("genericError") };
  } else {
    const { data, error } = await supabase
      .from("content_items")
      .insert({
        practitioner_id: user.id,
        type,
        title,
        description,
        price_cents: priceCents,
        youtube_video_id: youtubeVideoId, // null for pdf
      })
      .select("id")
      .single();
    if (error || !data) return { error: t("genericError") };
    revalidatePath("/practitioner-dashboard", "layout");
    return { success: true, id: data.id };
  }

  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true, id };
}

// Show/hide without deleting — the safe way to retire an item that has purchases
// (a hard delete is FK-restricted while purchases reference it, on purpose).
export async function setContentActive(id: string, active: boolean): Promise<ContentActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthorized" };
  const { error } = await supabase.from("content_items").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) return { error: "failed" };
  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

export async function deleteContentItem(id: string): Promise<ContentActionState> {
  const t = await getTranslations("DigitalProducts");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("genericError") };
  const { error } = await supabase.from("content_items").delete().eq("id", id);
  if (error) {
    // 23503 = FK violation: content_purchases still reference this item. Deleting
    // would strip buyers' access, so it's blocked — deactivate instead.
    if (error.code === "23503") return { error: t("cannotDeletePurchased") };
    return { error: t("genericError") };
  }
  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

// Upload/replace the master PDF for a pdf item. Magic-byte validated (belt-and-
// braces with the bucket's mime allowlist). Stored at {itemId}/{token}.pdf so the
// bucket RLS (foldername[1] = item id, owned by the caller) governs it.
export async function uploadContentPdf(_prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  const t = await getTranslations("DigitalProducts");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("genericError") };

  const itemId = (formData.get("id") as string | null)?.trim();
  const file = formData.get("file");
  if (!itemId || !(file instanceof File) || file.size === 0) return { error: t("pdfRequired") };
  if (file.size > CONTENT_PDF_MAX_BYTES) return { error: t("pdfTooLarge") };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = await validateDocumentBytes(bytes, "application/pdf");
  if (!validation.ok) return { error: t("pdfNotPdf") };

  const path = `${itemId}/${randomUUID()}.pdf`;
  const { error: upErr } = await supabase.storage.from("content-pdfs").upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (upErr) {
    console.error("uploadContentPdf: storage upload failed", { itemId, upErr });
    return { error: t("genericError") };
  }
  // Record the new master path. Any previous file is left orphaned in the bucket
  // (a later retention sweep can prune) rather than risk deleting the live one
  // before the pointer flips.
  const { error: updErr } = await supabase.from("content_items").update({ pdf_storage_path: path, updated_at: new Date().toISOString() }).eq("id", itemId).select("id");
  if (updErr) {
    console.error("uploadContentPdf: pointer update failed", { itemId, updErr });
    return { error: t("genericError") };
  }
  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

// Buyer-initiated purchase. Consent (the 14-day-withdrawal-waiver checkbox) is
// read here and passed to initiateContentPurchase, which HARD-gates on it; the
// UI also disables the button until it's checked. On success we redirect to the
// hosted Checkout; otherwise the caller shows the mapped message.
export async function purchaseContentItem(_prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  const t = await getTranslations("DigitalProducts");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("mustSignIn") };

  const itemId = (formData.get("id") as string | null)?.trim();
  const username = (formData.get("username") as string | null)?.trim() ?? "";
  const consent = formData.get("consent") === "on" || formData.get("consent") === "true";
  if (!itemId) return { error: t("genericError") };

  // Absolute URLs on our own domain (SITE_URL) — Stripe requires absolute, and
  // the domain prefix keeps a tampered username from redirecting off-site.
  const base = `${SITE_URL}/p/${encodeURIComponent(username)}`;
  const result = await initiateContentPurchase({
    contentItemId: itemId,
    buyerId: user.id,
    consent,
    successPath: `${base}?purchase=success`,
    cancelPath: `${base}?purchase=cancelled`,
  });

  switch (result.type) {
    case "redirect":
      redirectExternal(result.url); // throws NEXT_REDIRECT
      return null;
    case "consent_required":
      return { error: t("consentRequired") };
    case "already_purchased":
      return { error: t("alreadyPurchased") };
    case "practitioner_not_ready":
      return { error: t("practitionerNotReady") };
    case "payments_disabled":
      return { error: t("paymentsPaused") };
    case "not_found":
      return { error: t("notAvailable") };
    default:
      return { error: t("genericError") };
  }
}
