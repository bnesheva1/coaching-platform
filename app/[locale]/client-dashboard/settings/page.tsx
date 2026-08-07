import { createClient } from "@/lib/supabase/server";
import { AccountSettingsPage } from "@/components/settings/AccountSettingsPage";
import { ClientTimezoneField } from "@/components/settings/ClientTimezoneField";
import { ClientNameField } from "@/components/settings/ClientNameField";
import { getSavedTimezone } from "@/lib/profile/savedTimezone";
import { getRenameUsage } from "@/lib/rename-limits";

// Auth/role guard already ran in the shared layout.tsx.
export default async function ClientSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, marketing_consent, marketing_consent_updated_at")
    .eq("id", user!.id)
    .single();
  // timezone is excluded from the client column grant — read via service role.
  const savedTimezone = await getSavedTimezone(user!.id);
  const nameUsage = await getRenameUsage(user!.id, "client_display_name");

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <AccountSettingsPage
        displayName={profile?.display_name ?? ""}
        marketingConsent={profile?.marketing_consent ?? false}
        marketingConsentUpdatedAt={profile?.marketing_consent_updated_at ?? null}
        nameSection={<ClientNameField initialName={profile?.display_name ?? ""} usage={nameUsage} />}
        timezoneSection={<ClientTimezoneField initialTimezone={savedTimezone} />}
      />
    </main>
  );
}
