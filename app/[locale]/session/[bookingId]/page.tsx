import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getVideoRoomAccess } from "@/lib/video";
import { SessionRoom } from "./SessionRoom";

// Full-screen video session route. Server component: auth + the video
// access read, so the first paint is already the right screen (countdown /
// device-check / ended) with no client flash. The RPC behind
// getVideoRoomAccess enforces that the caller is a party to an online,
// confirmed booking; anything else comes back as "unavailable".
export default async function SessionPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const locale = await getLocale();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect({ href: "/login", locale });
  }

  const access = await getVideoRoomAccess(bookingId);

  return (
    <SessionRoom
      bookingId={bookingId}
      initialState={access.state}
      opensAt={access.opensAt}
      closesAt={access.closesAt}
      callerRole={access.callerRole}
    />
  );
}
