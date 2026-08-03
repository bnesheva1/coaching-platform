import { DateTime } from "luxon";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { AvailabilitySection } from "../AvailabilitySection";
import { AvailabilityExceptionsSection } from "../AvailabilityExceptionsSection";
import { TimezoneField } from "../TimezoneField";
import { MinNoticeHoursForm } from "../MinNoticeHoursForm";

// Auth/role guard already ran in the shared layout.tsx. Grouped under
// one nav item ("График") since both sections are schedule-related —
// same grouping the finalized design implies with a single nav entry.
export default async function SchedulePage() {
  const t = await getTranslations("Dashboard");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const [{ data: practitionerProfile }, { data: availabilityRules }, { data: availabilityExceptions }, { count: upcomingBookingsCount }] =
    await Promise.all([
      supabase.from("practitioner_profiles").select("timezone, min_notice_hours").eq("id", userId).single(),
      supabase.from("practitioner_availability").select("id, day_of_week, start_time, end_time").eq("practitioner_id", userId),
      supabase
        .from("availability_exceptions")
        .select("id, exception_date, start_time, end_time")
        .eq("practitioner_id", userId)
        .eq("exception_type", "blocked"),
      // Shown in the "apply to weekdays/all days" confirmation, so a
      // practitioner overwriting a chunk of their week knows upfront
      // that this doesn't touch anything already booked — same
      // ACTIVE_STATUSES definition as everywhere else this app
      // distinguishes "still counts" from cancelled/completed.
      supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("practitioner_id", userId)
        .in("status", ["pending", "confirmed"])
        .gte("start_utc", new Date().toISOString()),
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
          dates next; minimum notice — the only non-availability setting
          on this page, set once and rarely revisited — is tucked into a
          collapsed Advanced section at the very bottom instead of
          sitting in the main flow. */}
      <div style={{ maxWidth: 500, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("nav.schedule")}</h1>
        <TimezoneField initialTimezone={timezone} />
        <AvailabilitySection
          rules={availabilityRules ?? []}
          timezone={timezone}
          exceptionsCount={upcomingExceptions.length}
          upcomingBookingsCount={upcomingBookingsCount ?? 0}
        />
        <AvailabilityExceptionsSection exceptions={upcomingExceptions} />
        {/* Native <details>, same collapsed-by-default disclosure
            pattern as PastSessionsSection.tsx — free keyboard
            operability and an expanded/collapsed announcement to screen
            readers with no extra aria wiring. */}
        <details>
          <summary style={{ cursor: "pointer", font: "var(--text-heading-md)", padding: "var(--space-2) 0" }}>
            {t("advancedSectionTitle")}
          </summary>
          <div style={{ marginTop: "var(--space-3)" }}>
            <MinNoticeHoursForm initialMinNoticeHours={practitionerProfile?.min_notice_hours ?? 24} />
          </div>
        </details>
      </div>
    </main>
  );
}
