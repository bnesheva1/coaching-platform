import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: { role: string; full_name: string | null } | null = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("role, full_name")
      .eq("id", user.id)
      .single();
    profile = data;
  }

  return (
    <main style={{ maxWidth: 400, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>Coaching Platform</h1>
      {user ? (
        <>
          <p>
            Signed in as <strong>{profile?.full_name || user.email}</strong>{" "}
            ({profile?.role ?? "unknown role"})
          </p>
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </>
      ) : (
        <p>
          <Link href="/login">Log in</Link> or{" "}
          <Link href="/signup">sign up</Link>
        </p>
      )}
    </main>
  );
}
