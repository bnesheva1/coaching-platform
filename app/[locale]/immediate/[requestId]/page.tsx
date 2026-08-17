import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/flags";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { ImmediateConfirmation } from "./ImmediateConfirmation";

// The post-Checkout / book-on-confirm landing page for immediate booking. Gated
// by the feature flag (the whole feature is invisible when off) — everything
// else (ownership, polling for the booking) is enforced by the server actions
// the client component calls. `?payment=cancelled` routes to the release path.
export default async function ImmediateConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; requestId: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  if (!(await isEnabled("immediateBooking"))) notFound();
  const { requestId } = await params;
  const { payment } = await searchParams;

  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      <ContentContainer>
        <ImmediateConfirmation requestId={requestId} cancelled={payment === "cancelled"} />
      </ContentContainer>
    </main>
  );
}
