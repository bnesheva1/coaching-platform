import { RoomServiceClient } from "livekit-server-sdk";

// Same lazy-construction reasoning as lib/payments/stripe/client.ts and
// lib/email/providers/resend.ts — Next.js evaluates this module during
// build-time "collect page data" for every route that transitively
// imports it, so eager construction with a missing/invalid key would
// break the build. Deferring to first real use means a missing LIVEKIT_*
// var only ever surfaces as a normal runtime error inside a request.

let roomService: RoomServiceClient | null = null;

// The server SDK's RoomServiceClient talks to LiveKit's HTTPS API host,
// while the browser connects over wss://. Both derive from the one public
// URL var, so convert the scheme here rather than introducing a second
// env var for the same host.
function httpUrlFromWs(url: string): string {
  return url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
}

// Read + validate all three LiveKit vars in one place. LIVEKIT_API_KEY /
// LIVEKIT_API_SECRET are server-only; NEXT_PUBLIC_LIVEKIT_URL is the wss
// URL the browser also uses. There is no separate webhook secret —
// LiveKit signs webhooks with the same key/secret pair.
export function liveKitCredentials(): { apiKey: string; apiSecret: string; wsUrl: string } {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!apiKey || !apiSecret || !wsUrl) {
    throw new Error("LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and NEXT_PUBLIC_LIVEKIT_URL must be configured");
  }
  return { apiKey, apiSecret, wsUrl };
}

export function getRoomServiceClient(): RoomServiceClient {
  if (!roomService) {
    const { apiKey, apiSecret, wsUrl } = liveKitCredentials();
    roomService = new RoomServiceClient(httpUrlFromWs(wsUrl), apiKey, apiSecret);
  }
  return roomService;
}
