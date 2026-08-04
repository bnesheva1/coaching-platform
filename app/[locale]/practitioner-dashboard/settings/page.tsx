import { createClient } from "@/lib/supabase/server";
import { AccountSettingsPage } from "@/components/settings/AccountSettingsPage";

// Auth/role guard already ran in the shared layout.tsx.
export default async function PractitionerSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, marketing_consent, marketing_consent_updated_at")
    .eq("id", user!.id)
    .single();

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <AccountSettingsPage
        displayName={profile?.display_name ?? ""}
        marketingConsent={profile?.marketing_consent ?? false}
        marketingConsentUpdatedAt={profile?.marketing_consent_updated_at ?? null}
      />
    </main>
  );
}
