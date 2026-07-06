import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

  return (
    <main style={{ maxWidth: 400, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>Practitioner Dashboard</h1>
    </main>
  );
}
