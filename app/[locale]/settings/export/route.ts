import { NextResponse } from "next/server";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { collectSessionDocuments } from "@/lib/documents/gdpr";

// Own-data export (GDPR access/portability). The ONLY id used anywhere
// in this handler is `user.id`, read once below from the verified
// session — never from a route param, query string, or request body.
// Every query is filtered by that exact same variable; there is no
// other way to reach this handler's data for any id but your own.
//
// service-role, not the regular per-request client, for the actual
// gather — several fields a genuine "export ALL of my own data" needs
// (profiles.email, practitioner_profiles.stripe_connected_account_id)
// are deliberately excluded from the authenticated column grant
// elsewhere in this app (admin-only columns, same reasoning as every
// other column-grant precedent here) — the caller's identity is
// verified via the regular client first, then service-role is used
// only to read columns that identity is genuinely entitled to see back
// about itself, not to bypass anything.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createServiceRoleClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, display_name, email, locale, timezone, created_at, marketing_consent, marketing_consent_updated_at")
    .eq("id", user.id)
    .single();

  const isPractitioner = profile?.role === "practitioner";

  const [{ data: practitionerProfile }, { data: servicesOffered }, { data: bookingsAsClient }, { data: bookingsAsPractitioner }] =
    await Promise.all([
      isPractitioner
        ? admin
            .from("practitioner_profiles")
            .select(
              "bio, headline, location, specialties, topics, avatar_url, banner_url, username, timezone, min_notice_hours, billing_model, stripe_connected_account_id, created_at",
            )
            .eq("id", user.id)
            .single()
        : Promise.resolve({ data: null }),
      isPractitioner
        ? admin
            .from("services")
            .select("id, name, description, duration_minutes, price_cents, currency, is_active, delivery_type, created_at")
            .eq("practitioner_id", user.id)
        : Promise.resolve({ data: [] }),
      admin
        .from("bookings")
        .select("id, practitioner_id, service_name, price_cents, currency, delivery_type, start_utc, end_utc, status, created_at")
        .eq("client_id", user.id),
      isPractitioner
        ? admin
            .from("bookings")
            .select("id, client_id, service_name, price_cents, currency, delivery_type, start_utc, end_utc, status, created_at")
            .eq("practitioner_id", user.id)
        : Promise.resolve({ data: [] }),
    ]);

  // reviews has no client_id column of its own (only booking_id) — the
  // two-step lookup below (own booking ids, then reviews on those ids)
  // avoids depending on PostgREST's embedded-relationship filter syntax
  // resolving correctly, which is harder to verify than a plain .in().
  const ownClientBookingIds = (bookingsAsClient ?? []).map((b) => b.id);
  const { data: reviewsWritten } = ownClientBookingIds.length
    ? await admin.from("reviews").select("id, booking_id, rating, review_text, created_at").in("booking_id", ownClientBookingIds)
    : { data: [] };

  const { data: reviewsReceived } = isPractitioner
    ? await admin.from("reviews").select("id, booking_id, rating, review_text, created_at").eq("practitioner_id", user.id)
    : { data: [] };

  const ownClientBookingIdSet = new Set(ownClientBookingIds);
  const { data: paymentsRaw } = ownClientBookingIds.length
    ? await admin
        .from("payments")
        .select("id, booking_id, amount_cents, currency, status, created_at")
        .in("booking_id", ownClientBookingIds)
    : { data: [] };
  const payments = (paymentsRaw ?? []).filter((p) => p.booking_id && ownClientBookingIdSet.has(p.booking_id));

  // Session documents: metadata for every document on the user's bookings
  // (both sides), and the list of their OWN uploaded files to embed in the
  // ZIP. Right-of-access covers the files the user uploaded — they're
  // personal data we hold — so the export is a ZIP (export.json + the files),
  // not bare JSON. The counterparty's files are never included, only that a
  // document was exchanged.
  const allBookingIds = [...ownClientBookingIds, ...(bookingsAsPractitioner ?? []).map((b) => b.id)];
  const { metadata: sessionDocuments, files: ownDocumentFiles } = await collectSessionDocuments(admin, user.id, allBookingIds);

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    profile,
    practitionerProfile: practitionerProfile ?? null,
    servicesOffered: servicesOffered ?? [],
    bookingsAsClient: bookingsAsClient ?? [],
    bookingsAsPractitioner: bookingsAsPractitioner ?? [],
    reviewsWritten: reviewsWritten ?? [],
    reviewsReceived: reviewsReceived ?? [],
    payments,
    sessionDocuments,
    // No messaging feature exists anywhere in this app today — included
    // as an explicit empty marker rather than omitted, so this export's
    // shape stays stable if one is ever added later.
    messages: [],
  };

  const zip = new JSZip();
  zip.file("export.json", JSON.stringify(exportPayload, null, 2));
  for (const f of ownDocumentFiles) {
    const { data: blob, error: dlError } = await admin.storage.from("session-documents").download(f.storagePath);
    if (dlError || !blob) {
      console.error("export: session document download failed", { path: f.storagePath, dlError });
      continue; // metadata still records it; a missing file must not fail the whole export
    }
    zip.file(f.zipPath, new Uint8Array(await blob.arrayBuffer()));
  }
  const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });

  return new NextResponse(zipBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="my-data-${user.id}.zip"`,
    },
  });
}
