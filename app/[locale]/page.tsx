import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";

export default async function Home() {
  const t = await getTranslations("HomePage");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: { role: string; display_name: string | null } | null = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("role, display_name")
      .eq("id", user.id)
      .single();
    profile = data;
  }

  return (
    <main style={{ maxWidth: 400, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>{t("title")}</h1>
      {user ? (
        <>
          <p>
            {t.rich("signedInAs", {
              strong: (chunks) => <strong>{chunks}</strong>,
              name: profile?.display_name || user.email || "",
              role: profile?.role ?? "unknown role",
            })}
          </p>
          <form action={signOut}>
            <button type="submit">{t("signOut")}</button>
          </form>
        </>
      ) : (
        <p>
          {t.rich("loggedOutPrompt", {
            login: (chunks) => <Link href="/login">{chunks}</Link>,
            signup: (chunks) => <Link href="/signup">{chunks}</Link>,
          })}
        </p>
      )}
    </main>
  );
}
