import { createClient } from "@/lib/supabase/server";
import { AvailabilitySection } from "../AvailabilitySection";
import { AvailabilityExceptionsSection } from "../AvailabilityExceptionsSection";
import { ScheduleSettingsForm } from "../ScheduleSettingsForm";

// Auth/role guard already ran in the shared layout.tsx. Grouped under
// one nav item ("График") since both sections are schedule-related —
// same grouping the finalized design implies with a single nav entry.
export default async function SchedulePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const [{ data: practitionerProfile }, { data: availabilityRules }, { data: availabilityExceptions }] =
    await Promise.all([
      supabase.from("practitioner_profiles").select("timezone, min_notice_hours").eq("id", userId).single(),
      supabase.from("practitioner_availability").select("id, day_of_week, start_time, end_time").eq("practitioner_id", userId),
      supabase
        .from("availability_exceptions")
        .select("id, exception_date, start_time, end_time")
        .eq("practitioner_id", userId)
        .eq("exception_type", "blocked"),
    ]);

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      {/* No ContentContainer — DashboardShell already bounds/pads the
          sidebar+content row; see profile/page.tsx's identical note. */}
      <div style={{ maxWidth: 500 }}>
        <ScheduleSettingsForm
          initialTimezone={practitionerProfile?.timezone ?? "Europe/Sofia"}
          initialMinNoticeHours={practitionerProfile?.min_notice_hours ?? 24}
        />
        <AvailabilitySection
          rules={availabilityRules ?? []}
          timezone={practitionerProfile?.timezone ?? "Europe/Sofia"}
        />
        <AvailabilityExceptionsSection exceptions={availabilityExceptions ?? []} />
      </div>
    </main>
  );
}
