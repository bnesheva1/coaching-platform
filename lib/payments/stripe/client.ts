import Stripe from "stripe";

// Same lazy-construction reasoning as lib/email/providers/resend.ts —
// Next.js evaluates this module during build-time "collect page data"
// for every route that transitively imports it, and the Stripe SDK's
// constructor throws synchronously on a missing key. Deferring to first
// real use means a missing STRIPE_SECRET_KEY only ever surfaces as a
// normal runtime error inside an actual request, never a build failure.
let stripe: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!stripe) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripe = new Stripe(secretKey);
  }
  return stripe;
}
