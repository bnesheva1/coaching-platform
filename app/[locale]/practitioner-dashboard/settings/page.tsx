import { createClient } from "@/lib/supabase/server";
import { AccountSettingsPage } from "@/components/settings/AccountSettingsPage";
import { StripeConnectSection } from "@/components/practitioner-profile/StripeConnectSection";
import { UsernameSection } from "@/components/settings/UsernameSection";
import { EmergencyContactField } from "@/components/settings/EmergencyContactField";
import { getEmergencyContact } from "@/lib/profile/emergencyContact";
import { getRenameUsage } from "@/lib/rename-limits";

// Auth/role guard already ran in the shared layout.tsx.
export default async function PractitionerSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Moved here from profile/page.tsx along with StripeConnectSection
  // itself — see AccountSettingsPage's own comment on why.
  const resolvedSearchParams = await searchParams;
  const connectErrorParam = resolvedSearchParams.connectError;
  const connectError = typeof connectErrorParam === "string" ? connectErrorParam : null;
  const manageErrorParam = resolvedSearchParams.manageError;
  const manageError = typeof manageErrorParam === "string" ? manageErrorParam : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const [{ data: profile }, { data: practitionerProfile }, { data: connectStatusRaw }, emergencyContact] = await Promise.all([
    supabase.from("profiles").select("display_name, marketing_consent, marketing_consent_updated_at").eq("id", userId).single(),
    supabase.from("practitioner_profiles").select("username").eq("id", userId).single(),
    supabase.rpc("get_my_connect_status").single(),
    // Excluded from the client column grant — read via service role.
    getEmergencyContact(userId),
  ]);

  const connectStatus = connectStatusRaw as { is_connected: boolean; transfers_active: boolean } | null;

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <AccountSettingsPage
        displayName={profile?.display_name ?? ""}
        marketingConsent={profile?.marketing_consent ?? false}
        marketingConsentUpdatedAt={profile?.marketing_consent_updated_at ?? null}
        practitionerOnlyContent={
          <>
            <StripeConnectSection
              isConnected={connectStatus?.is_connected ?? false}
              transfersActive={connectStatus?.transfers_active ?? false}
              errorCode={connectError}
              manageErrorCode={manageError}
            />
            <UsernameSection
              initialUsername={practitionerProfile?.username ?? null}
              usage={await getRenameUsage(userId, "username")}
            />
            <EmergencyContactField initialContact={emergencyContact} />
          </>
        }
      />
    </main>
  );
}
