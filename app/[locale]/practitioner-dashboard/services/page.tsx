import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_STATUSES } from "@/lib/booking-time";
import { isEnabled } from "@/lib/flags";
import { enabledDeliveryTypes } from "@/lib/delivery";
import { paymentProviderName, processingFeeRange } from "@/lib/payments";
import { effectiveCommissionRate } from "@/lib/payments/stripe/checkout";
import { ServicesSection } from "../ServicesSection";

// Mirrors DEFAULT_MAX_PRICE_CENTS in services-actions.ts — the platform default
// ceiling when the practitioner has no max_price_cents override.
const DEFAULT_MAX_PRICE_CENTS = 50000;
const MIN_PRICE_EUROS = 20;

// Auth/role guard already ran in the shared layout.tsx.
export default async function ServicesPage() {
  const t = await getTranslations("Dashboard");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { data: services } = await supabase
    .from("services")
    .select("id, name, description, duration_minutes, price_cents, currency, is_active, delivery_type, image_url, documents_enabled")
    .eq("practitioner_id", userId)
    .order("created_at", { ascending: true });

  // delivery_info/phone_number are excluded from the general column
  // grant entirely — even the owning practitioner can't read them via
  // the plain select above. This RPC is the only way they're ever
  // readable, scoped to exactly the caller's own services.
  const { data: deliveryInfoRows } = (await supabase.rpc("get_my_services_delivery_info")) as {
    data: { service_id: string; delivery_info: string | null; phone_number: string | null }[] | null;
  };
  const deliveryInfoByServiceId = new Map((deliveryInfoRows ?? []).map((row) => [row.service_id, row.delivery_info]));
  const phoneNumberByServiceId = new Map((deliveryInfoRows ?? []).map((row) => [row.service_id, row.phone_number]));

  // One query for every service's upcoming-booking count, rather than
  // one query per service — a practitioner's service list is small
  // enough that this doesn't need pagination, but there's no reason to
  // pay N round trips when a single .in() + client-side grouping does
  // the same job. Informational only here (drives the disabled/locked
  // UI); services-actions.ts's updateService re-derives this itself
  // server-side before accepting a write — this copy is never trusted
  // as the enforcement.
  const serviceIds = (services ?? []).map((s) => s.id);
  const upcomingCountByServiceId = new Map<string, number>();
  if (serviceIds.length > 0) {
    const { data: upcomingBookings } = await supabase
      .from("bookings")
      .select("service_id")
      .in("service_id", serviceIds)
      .in("status", [...ACTIVE_STATUSES])
      .gt("end_utc", new Date().toISOString());
    for (const booking of upcomingBookings ?? []) {
      upcomingCountByServiceId.set(booking.service_id, (upcomingCountByServiceId.get(booking.service_id) ?? 0) + 1);
    }
  }

  const servicesWithDeliveryInfo = (services ?? []).map((service) => ({
    ...service,
    delivery_info: deliveryInfoByServiceId.get(service.id) ?? null,
    phone_number: phoneNumberByServiceId.get(service.id) ?? null,
    upcoming_booking_count: upcomingCountByServiceId.get(service.id) ?? 0,
  }));

  // The practitioner's OWN effective commission rate, resolved server-side by
  // the SAME function checkout uses — override ?? brand default, and 0 for a
  // software_provider (they keep 100%). commission_rate_override + billing_model
  // are admin-only, so they come through the get_my_commission_context definer
  // RPC. A negotiated override shows the negotiated number, never the default.
  const { data: ccRows } = (await supabase.rpc("get_my_commission_context")) as {
    data: { billing_model: string | null; commission_rate_override: number | null }[] | null;
  };
  const cc = ccRows?.[0];
  const commissionRate = cc?.billing_model === "commission" ? effectiveCommissionRate(cc.commission_rate_override) : 0;

  // Effective price ceiling (the practitioner's max_price_cents override, else
  // the platform default), so the panel's bounds match what's actually enforced.
  const { data: maxCents } = (await supabase.rpc("get_my_max_price_cents")) as { data: number | null };
  const maxPriceEuros = (maxCents ?? DEFAULT_MAX_PRICE_CENTS) / 100;

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      {/* No ContentContainer — DashboardShell already bounds/pads the
          sidebar+content row; see profile/page.tsx's identical note.
          Wider than the usual 500px reading column — these are tiles
          with a square image, same width budget as the profile page's
          own service tiles (practitioner-dashboard/profile/page.tsx). */}
      <div style={{ maxWidth: 800 }}>
        <h1 style={{ font: "var(--text-heading-lg)", margin: "0 0 var(--space-6)" }}>{t("nav.services")}</h1>
        <ServicesSection
          services={servicesWithDeliveryInfo}
          enabledTypes={[...enabledDeliveryTypes()]}
          documentsFeatureEnabled={await isEnabled("sessionDocuments")}
          commissionRate={commissionRate}
          providerName={paymentProviderName()}
          processingFee={processingFeeRange()}
          minPriceEuros={MIN_PRICE_EUROS}
          maxPriceEuros={maxPriceEuros}
        />
      </div>
    </main>
  );
}
