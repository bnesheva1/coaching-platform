import { createClient } from "@/lib/supabase/server";
import { ServicesSection } from "../ServicesSection";

// Auth/role guard already ran in the shared layout.tsx.
export default async function ServicesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { data: services } = await supabase
    .from("services")
    .select("id, name, description, duration_minutes, price_cents, currency, is_active, delivery_type, image_url")
    .eq("practitioner_id", userId)
    .order("created_at", { ascending: true });

  // delivery_info is excluded from the general column grant entirely —
  // even the owning practitioner can't read it via the plain select
  // above. This RPC is the only way it's ever readable, scoped to
  // exactly the caller's own services.
  const { data: deliveryInfoRows } = (await supabase.rpc("get_my_services_delivery_info")) as {
    data: { service_id: string; delivery_info: string | null }[] | null;
  };
  const deliveryInfoByServiceId = new Map((deliveryInfoRows ?? []).map((row) => [row.service_id, row.delivery_info]));
  const servicesWithDeliveryInfo = (services ?? []).map((service) => ({
    ...service,
    delivery_info: deliveryInfoByServiceId.get(service.id) ?? null,
  }));

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      {/* No ContentContainer — DashboardShell already bounds/pads the
          sidebar+content row; see profile/page.tsx's identical note.
          Wider than the usual 500px reading column — these are tiles
          with a square image, same width budget as the profile page's
          own service tiles (practitioner-dashboard/profile/page.tsx). */}
      <div style={{ maxWidth: 800 }}>
        <ServicesSection services={servicesWithDeliveryInfo} />
      </div>
    </main>
  );
}
