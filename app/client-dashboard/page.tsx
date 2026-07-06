import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function ClientDashboardPage() {
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

  if (profile?.role !== "client") {
    redirect("/practitioner-dashboard");
  }

  return (
    <main style={{ maxWidth: 400, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>Client Dashboard</h1>
    </main>
  );
}
