import { ContentContainer } from "@/components/ui/ContentContainer";
import { ResetPasswordForm } from "./ResetPasswordForm";

// No server-side session check here — the recovery link's token
// arrives in the URL fragment (see ResetPasswordForm's own comment on
// why), which the server never sees at all. Every bit of "is this link
// valid" logic lives client-side in the form itself.
export default function ResetPasswordPage() {
  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      <ContentContainer maxWidth={400}>
        <ResetPasswordForm />
      </ContentContainer>
    </main>
  );
}
