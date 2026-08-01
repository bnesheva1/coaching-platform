import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

// Same already-logged-in redirect as login/signup — resetting a
// password you're already signed in with isn't a real use case this
// page needs to serve.
export default async function ForgotPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    const locale = await getLocale();
    redirect({
      href: profile?.role === "practitioner" ? "/practitioner-dashboard" : "/client-dashboard",
      locale,
    });
  }

  return <ForgotPasswordForm />;
}
