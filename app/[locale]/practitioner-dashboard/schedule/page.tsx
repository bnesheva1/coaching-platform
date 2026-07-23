import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { AvailabilitySection } from "../AvailabilitySection";
import { AvailabilityExceptionsSection } from "../AvailabilityExceptionsSection";
import { TimezoneField } from "../TimezoneField";
import { MinNoticeHoursForm } from "../MinNoticeHoursForm";

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

  const timezone = practitionerProfile?.timezone ?? "Europe/Sofia";

  // "Today" in the practitioner's OWN timezone, not the server's UTC
  // clock — exception_date is a bare, timezone-naive calendar date
  // (same convention as generateSlots.ts's day iteration), so the
  // cutoff for "past" has to be resolved against the same zone the
  // date itself means something in. Using server UTC here could hide
  // or show a block up to ~14 hours off from the practitioner's own
  // sense of "today," right at the boundary.
  // null only if `timezone` were an invalid IANA zone string, which
  // shouldn't happen (validated at write time by updateTimezone) —
  // falling back to UTC's own "today" is a safe, harmless default for
  // that unreachable case rather than crashing the whole page over it.
  const todayInPractitionerTz = DateTime.now().setZone(timezone).toISODate() ?? DateTime.utc().toISODate()!;
  const upcomingExceptions = (availabilityExceptions ?? []).filter(
    (exception) => exception.exception_date >= todayInPractitionerTz,
  );

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      {/* No ContentContainer — DashboardShell already bounds/pads the
          sidebar+content row; see profile/page.tsx's identical note. */}
      {/* Top-to-bottom order is deliberate, by importance/frequency —
          see the Schedule tab restructure: timezone is read constantly
          by everything below it but changed rarely, so it's a plain
          element up top, not buried in a card; weekly availability is
          the main task and gets the prominent middle position; blocked
          dates next; minimum notice — set once, rarely revisited — last. */}
      <div style={{ maxWidth: 500, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <TimezoneField initialTimezone={timezone} />
        <AvailabilitySection rules={availabilityRules ?? []} timezone={timezone} />
        <AvailabilityExceptionsSection exceptions={upcomingExceptions} />
        <MinNoticeHoursForm initialMinNoticeHours={practitionerProfile?.min_notice_hours ?? 24} />
      </div>
    </main>
  );
}
