import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "./ProfileForm";

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
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "practitioner") {
    redirect("/client-dashboard");
  }

  const { data: practitionerProfile } = await supabase
    .from("practitioner_profiles")
    .select("bio, specialties, avatar_url")
    .eq("id", user.id)
    .single();

  return (
    <main style={{ maxWidth: 500, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>Practitioner Dashboard</h1>
      <ProfileForm
        initialBio={practitionerProfile?.bio ?? ""}
        initialSpecialties={practitionerProfile?.specialties ?? []}
        initialAvatarUrl={practitionerProfile?.avatar_url ?? null}
      />
    </main>
  );
}
