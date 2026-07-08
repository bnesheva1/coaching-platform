import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { ProfileForm } from "./ProfileForm";
import { ServicesSection } from "./ServicesSection";

export default async function PractitionerDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "practitioner") {
    redirect("/client-dashboard");
  }

  const { data: practitionerProfile } = await supabase
    .from("practitioner_profiles")
    .select("bio, specialties, avatar_url, username")
    .eq("id", user.id)
    .single();

  const { data: services } = await supabase
    .from("services")
    .select("id, name, description, duration_minutes, price_cents, currency, is_active")
    .eq("practitioner_id", user.id)
    .order("created_at", { ascending: true });

  return (
    <main style={{ maxWidth: 500, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>Practitioner Dashboard</h1>
      <form action={signOut} style={{ marginBottom: "1.5rem" }}>
        <button type="submit">Sign out</button>
      </form>
      {practitionerProfile?.username && (
        <p>
          <Link href={`/p/${practitionerProfile.username}`}>
            View your public profile
          </Link>
        </p>
      )}
      <ProfileForm
        initialUsername={practitionerProfile?.username ?? null}
        initialDisplayName={profile?.display_name ?? ""}
        initialBio={practitionerProfile?.bio ?? ""}
        initialSpecialties={practitionerProfile?.specialties ?? []}
        initialAvatarUrl={practitionerProfile?.avatar_url ?? null}
      />
      <ServicesSection services={services ?? []} />
    </main>
  );
}
