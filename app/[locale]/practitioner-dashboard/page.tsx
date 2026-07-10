import { getTranslations, getLocale } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { ProfileForm } from "./ProfileForm";
import { ServicesSection } from "./ServicesSection";
import { AvailabilitySection } from "./AvailabilitySection";

export default async function PractitionerDashboardPage() {
  const t = await getTranslations("Dashboard");
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "practitioner") {
    redirect({ href: "/client-dashboard", locale });
    return null;
  }

  const { data: practitionerProfile } = await supabase
    .from("practitioner_profiles")
    .select("bio, specialties, avatar_url, username, timezone")
    .eq("id", user.id)
    .single();

  const { data: services } = await supabase
    .from("services")
    .select("id, name, description, duration_minutes, price_cents, currency, is_active")
    .eq("practitioner_id", user.id)
    .order("created_at", { ascending: true });

  const { data: availabilityRules } = await supabase
    .from("practitioner_availability")
    .select("id, day_of_week, start_time, end_time")
    .eq("practitioner_id", user.id);

  return (
    <main style={{ maxWidth: 500, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>{t("practitionerTitle")}</h1>
      <form action={signOut} style={{ marginBottom: "1.5rem" }}>
        <button type="submit">{t("signOut")}</button>
      </form>
      {practitionerProfile?.username && (
        <p>
          <Link href={`/p/${practitionerProfile.username}`}>
            {t("viewPublicProfile")}
          </Link>
        </p>
      )}
      <ProfileForm
        initialUsername={practitionerProfile?.username ?? null}
        initialDisplayName={profile?.display_name ?? ""}
        initialBio={practitionerProfile?.bio ?? ""}
        initialSpecialties={practitionerProfile?.specialties ?? []}
        initialAvatarUrl={practitionerProfile?.avatar_url ?? null}
        initialTimezone={practitionerProfile?.timezone ?? "Europe/Sofia"}
      />
      <ServicesSection services={services ?? []} />
      <AvailabilitySection
        rules={availabilityRules ?? []}
        timezone={practitionerProfile?.timezone ?? "Europe/Sofia"}
      />
    </main>
  );
}
