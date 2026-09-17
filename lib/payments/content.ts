import { getStripeClient } from "./stripe/client";
import { commissionCentsFor, effectiveCommissionRate } from "./stripe/checkout";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { isEnabled } from "@/lib/flags";
import type { BillingModel } from "./types";

// Purchase of a gated content item — a one-time payment reusing the booking
// checkout's separate-charges-&-transfers shape (mode:"payment", no
// transfer_data; the practitioner's share is transferred later by the release
// sweep's content pass). NOT a new billing model. The webhook finalises the
// content_purchases row from the metadata stamped here.
//
// Refunds (policy): content purchases are intentionally OUTSIDE the self-serve
// refund-request flow (which is booking-only — see
// client-dashboard/refund-request-actions.ts). The consent checkbox at checkout
// waives the 14-day EU digital-withdrawal right, so only a genuine technical
// failure warrants a refund, handled admin-manual via the Stripe dashboard: a
// refund of the charge there reverses the released transfer automatically. The
// CONTENT_PAYOUT_HOLD_HOURS window (default 24h) exists precisely so most such
// refunds land before the practitioner payout is even released.

export type ContentPurchaseResult =
  | { type: "redirect"; url: string }
  | { type: "already_purchased" }
  | { type: "consent_required" }
  | { type: "not_found" }
  | { type: "practitioner_not_ready" }
  | { type: "payments_disabled" }
  | { type: "error" };

type ContentCheckoutInput = {
  contentPurchaseId: string;
  contentItemId: string;
  buyerId: string;
  practitionerId: string;
  title: string;
  priceCents: number;
  currency: string;
  successPath: string;
  cancelPath: string;
};

// Mirrors createBookingCheckoutSession — same session shape, content metadata.
async function createContentCheckoutSession(input: ContentCheckoutInput, connectedAccountId: string, effectiveRate: number): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripeClient();
  const commissionCents = commissionCentsFor(input.priceCents, effectiveRate);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: input.currency.toLowerCase(),
          product_data: { name: input.title },
          unit_amount: input.priceCents,
        },
        quantity: 1,
      },
    ],
    // Separate charges & transfers: no transfer_data — the practitioner's share
    // is released later by the sweep's content pass (transfer.ts).
    metadata: {
      // The presence of content_purchase_id is what routes the webhook down the
      // content branch (vs booking / immediate).
      content_purchase_id: input.contentPurchaseId,
      content_item_id: input.contentItemId,
      buyer_id: input.buyerId,
      practitioner_id: input.practitionerId,
      connected_account_id: connectedAccountId,
      commission_rate: String(effectiveRate),
      commission_cents: String(commissionCents),
    },
    success_url: input.successPath,
    cancel_url: input.cancelPath,
  });
  if (!session.url) throw new Error("Stripe Checkout Session created with no url");
  return { sessionId: session.id, url: session.url };
}

// The single chokepoint a content purchase flows through. Enforces the consent
// checkbox (EU 14-day digital-withdrawal waiver), resolves the practitioner's
// connected account + effective commission, writes a pending content_purchases
// row, and returns the Checkout redirect. The webhook flips the row to completed.
export async function initiateContentPurchase(params: {
  contentItemId: string;
  buyerId: string;
  consent: boolean;
  successPath: string;
  cancelPath: string;
}): Promise<ContentPurchaseResult> {
  // Consent is a hard gate — checkout never starts without it. The UI also
  // disables the button, but this is the authoritative server-side block.
  if (!params.consent) return { type: "consent_required" };

  const supabase = createServiceRoleClient();

  // Preview columns only (price/title/practitioner) — the unlock fields aren't
  // needed here and aren't granted anyway.
  const { data: item } = await supabase
    .from("content_items")
    .select("id, practitioner_id, title, price_cents, currency, is_active")
    .eq("id", params.contentItemId)
    .single();
  if (!item || !item.is_active) return { type: "not_found" };
  if (item.practitioner_id === params.buyerId) return { type: "error" }; // can't buy your own

  // Already own it? Don't re-charge.
  const { data: existing } = await supabase
    .from("content_purchases")
    .select("id, status")
    .eq("content_item_id", params.contentItemId)
    .eq("buyer_id", params.buyerId)
    .maybeSingle();
  if (existing?.status === "completed") return { type: "already_purchased" };

  const { data: prof } = await supabase
    .from("practitioner_profiles")
    .select("billing_model, stripe_connected_account_id, stripe_connect_transfers_active, commission_rate_override")
    .eq("id", item.practitioner_id)
    .single();
  const billingModel: BillingModel = (prof?.billing_model as BillingModel | undefined) ?? "software_provider";

  // A content sale is always a real charge (there's no "software_provider, no
  // gate" path like bookings have) — but it still needs a Connect account able
  // to receive the eventual transfer.
  if (billingModel === "commission" && (!prof?.stripe_connected_account_id || !prof.stripe_connect_transfers_active)) {
    return { type: "practitioner_not_ready" };
  }
  if (!(await isEnabled("checkout"))) return { type: "payments_disabled" };

  const rate = effectiveCommissionRate(prof?.commission_rate_override as number | null);
  const commissionCents = commissionCentsFor(item.price_cents as number, rate);

  // Upsert the pending row (unique on content_item_id+buyer_id): a fresh buy, or
  // a retry of an abandoned checkout, both land here. purchased_at/release_at are
  // set by the webhook on completion, not now.
  const { data: purchase, error: upErr } = await supabase
    .from("content_purchases")
    .upsert(
      {
        content_item_id: params.contentItemId,
        buyer_id: params.buyerId,
        practitioner_id: item.practitioner_id,
        status: "pending",
        amount_cents: item.price_cents,
        currency: item.currency,
        commission_rate: rate,
        commission_cents: commissionCents,
        connected_account_id: prof?.stripe_connected_account_id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "content_item_id,buyer_id" },
    )
    .select("id")
    .single();
  if (upErr || !purchase) {
    console.error("initiateContentPurchase: pending upsert failed", { contentItemId: params.contentItemId, upErr });
    return { type: "error" };
  }

  try {
    const { sessionId, url } = await createContentCheckoutSession(
      {
        contentPurchaseId: purchase.id,
        contentItemId: params.contentItemId,
        buyerId: params.buyerId,
        practitionerId: item.practitioner_id as string,
        title: item.title as string,
        priceCents: item.price_cents as number,
        currency: item.currency as string,
        successPath: params.successPath,
        cancelPath: params.cancelPath,
      },
      prof?.stripe_connected_account_id ?? "",
      rate,
    );
    await supabase.from("content_purchases").update({ stripe_checkout_session_id: sessionId, updated_at: new Date().toISOString() }).eq("id", purchase.id);
    return { type: "redirect", url };
  } catch (err) {
    console.error("initiateContentPurchase: createContentCheckoutSession failed", { contentItemId: params.contentItemId, err });
    return { type: "error" };
  }
}

// Called by the webhook on checkout.session.completed for a content session.
// Flips the pending row to completed and sets the payout schedule.
export async function finalizeContentPurchase(params: {
  contentPurchaseId: string;
  paymentIntentId: string | null;
  commissionRate: number | null;
  commissionCents: number | null;
  holdHours: number;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  const now = Date.now();
  const releaseAt = new Date(now + params.holdHours * 3_600_000).toISOString();
  const { data: row } = await supabase.from("content_purchases").select("status").eq("id", params.contentPurchaseId).maybeSingle();
  if (!row) {
    console.error("finalizeContentPurchase: purchase row not found", { contentPurchaseId: params.contentPurchaseId });
    return;
  }
  if (row.status === "completed") return; // idempotent: webhook redelivery
  const { error } = await supabase
    .from("content_purchases")
    .update({
      status: "completed",
      purchased_at: new Date(now).toISOString(),
      release_at: releaseAt,
      transfer_status: "pending",
      stripe_payment_intent_id: params.paymentIntentId,
      commission_rate: params.commissionRate,
      commission_cents: params.commissionCents,
      updated_at: new Date(now).toISOString(),
    })
    .eq("id", params.contentPurchaseId);
  if (error) console.error("finalizeContentPurchase: update failed", { contentPurchaseId: params.contentPurchaseId, error });
}
