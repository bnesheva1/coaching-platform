# Прозрения — Scope

Living record of every feature: what it is, who asked for it, and its current status.
This file is the reference for implementation work — check it before starting
something new, and update the relevant entry (or add a new one) when you finish
something, the same way you already report back in prose.

Mirrors the shared tracker Bo and her shareholder use: https://claude.ai/artifact/Wc1CAL5FWKnNJ9z8SBCBYc
If the two ever disagree, Bo's the tiebreaker — ask her rather than guessing which is current.

Status values: `shipped` · `in_progress` · `queued` · `deferred`
`[BLOCKS LAUNCH]` marks anything that has to be resolved before real bookings/payments go live.

> Statuses reconciled against the codebase on 2026-09-15 (entries below carry a
> `Reconciled` note where the status changed from the originally-supplied file).

---

## In progress

### Supabase: Free → Pro
- Status: `in_progress` **[BLOCKS LAUNCH]**
- Requested by: Bo
- Summary: Free tier pauses projects after a week of inactivity, no backups, 1-day log
  retention — Pro fixes all of it. Already underway.

### Stripe test-mode dry run for the payout rebuild
- Status: `in_progress` **[BLOCKS LAUNCH]**
- Requested by: Bo
- Summary: Verify the real Stripe transfer + reversal calls against an actual test-mode
  connected account before any real booking relies on this.
- Spec: Automated fixture — book → release → confirm the Transfer lands; refund → confirm
  reversal. Plus one manual pass by Bo in the Stripe test dashboard.
- Reconciled 2026-09-15: automated fixture shipped (PR #29); Bo's manual test-dashboard
  pass is the outstanding piece. Was `queued`.

---

## Queued

### Vercel: Hobby → Pro
- Status: `queued` **[BLOCKS LAUNCH]**
- Requested by: Bo
- Summary: Hobby's own terms restrict it to non-commercial use — independent of the
  daily-only cron limitation. Also unlocks per-minute cron and scheduling precision.

### Stripe live-mode business verification (KYB)
- Status: `queued` **[BLOCKS LAUNCH]**
- Requested by: Bo
- Summary: Complete business verification on the platform's own Stripe account, then point
  live API keys and webhooks at production. Separate gate from any plan upgrade.

### Astrology taxonomy landing page
- Status: `queued`
- Requested by: Bo
- Summary: Build the astrology SEO landing page — full Bulgarian content already drafted
  and delivered.
- Reconciled 2026-09-15: still queued — `astrology` currently points at
  `/browse?specialty=astrology` (homepage-modalities.ts), no dedicated landing page yet.

### Tarot taxonomy landing page
- Status: `queued`
- Requested by: Bo
- Summary: Build the tarot SEO landing page — full Bulgarian content already drafted
  and delivered.
- Reconciled 2026-09-15: still queued — `tarot` currently points at
  `/browse?specialty=tarot`, no dedicated landing page yet.

### /kontakti contact page
- Status: `queued`
- Requested by: Bo
- Summary: Build the contact page.
- Note: needs response-time commitment, support email, and dropdown options decided first.
- Reconciled 2026-09-15: the `/kontakti` route/slug exists (from the slug migration) but the
  contact-page content itself is still deferred pending the decisions above.

### SEO foundations pass
- Status: `queued`
- Requested by: Bo
- Summary: Site-wide: lang attribute, OG/Twitter tags, JSON-LD, sitemap/robots, favicon.
- Note: sequenced before the `/how-it-works` cleanup below.

---

## Shipped

### One public practitioner reply per review
- Status: `shipped`
- Requested by: Bo
- Summary: A practitioner can post a single public reply to any review on their profile —
  same pattern as Google/Airbnb host replies.
- Spec: One reply slot per review, editable afterward but not threaded. No new moderation
  system — route abuse through whatever admin-flags/suspend mechanism already exists. Notify
  the client on reply. Guideline text near the reply box: address the substance, never offer
  or imply compensation for changing the review.
- Reconciled 2026-09-15: built and verified this session (22/22 DB security checks,
  migrations 20260915120000 + 20260915130000 applied). No content-flag mechanism exists, so
  abuse is handled via the existing `/admin/practitioners` suspend/hide controls — no new
  moderation system, as specified. The follow-up migration revokes the leftover table-wide
  UPDATE grant so a practitioner can only ever write `reply_text`, never their review's
  rating/text. Was `queued`.

### Roster-driven specialty visibility classifier
- Status: `shipped`
- Requested by: Bo
- Summary: Homepage pills, browse filters, and taxonomy pages show active/coming-soon/hidden
  based on actual practitioner counts, not a manual list.
- Spec: Specialty-level hiding isn't possible today (bookability is per-practitioner) — shipped
  without a schema change: Bo just doesn't list a specialty she wants hidden.
- Reconciled 2026-09-15: `lib/specialties/availability.ts` (`getDomainStates` /
  `getModalityStates`) is wired into the homepage, browse, and `[category]` taxonomy pages.
  Was `in_progress`.

### Homepage example questions — visibility logic
- Status: `shipped`
- Requested by: Bo
- Summary: Apply the same active/coming-soon/hidden roster-driven classifier to the
  homepage's example-questions section.
- Reconciled 2026-09-15: homepage (`app/[locale]/page.tsx`) consumes the same
  `lib/specialties/availability` classifier. Was `queued`.

### /admin/practitioners shows pending & changes_requested
- Status: `shipped`
- Requested by: Bo
- Summary: Admin practitioner list only renders the original 4 moderation statuses — the two
  new review-gate statuses fall through.
- Spec: Extend the status badge/filter on `/admin/practitioners` to handle `pending` and
  `changes_requested` with their own labels/colors, add them as filter options, link a
  pending row through to `/admin/review`, and surface the `changes_requested` reason inline.
  Don't touch the underlying review-gate logic.
- Reconciled 2026-09-15: shipped and merged. Was `queued`.

### Test account cleanup + DELETED USER fallback
- Status: `shipped`
- Requested by: Bo
- Summary: Investigate and safely (dry-run first) clean up test accounts; add a
  "DELETED USER" fallback label for orphaned historical records.
- Reconciled 2026-09-15: `scripts/cleanup-test-accounts.mjs` + `lib/deleted-user.ts` (wired
  into Avatar, bookings lists, browse/profile cards). Was `queued`. Verify the search-sync
  cascade-delete guard migration `20260910120000` is applied on prod before relying on
  hard-deletes.

### Bulgarian-slug routing migration
- Status: `shipped`
- Requested by: Bo
- Summary: Migrate key routes to Bulgarian slugs: `/kak-raboti`, `/vaprosi`,
  `/stanete-specialist`, `/kontakti`.
- Reconciled 2026-09-15: routes exist with 308 redirects. Actual "become a specialist" slug
  shipped as `/stani-specialist` (not `/stanete-specialist` as written above). Was `queued`.

### Practitioner profile review gate
- Status: `shipped`
- Requested by: Bo
- Summary: New practitioner signups need admin approval (pending → active, or
  changes_requested) before their profile goes live.
- Spec: New signups default to `moderation_status=pending`. Practitioner clicks "Submit for
  review" to enter the admin queue (+Telegram ping). Admin approves (→active, live) or
  requests changes (→changes_requested, reason shown, editable/resubmittable back to
  pending) at `/admin/review`. Existing profiles were grandfathered as active, not swept.
  Verified live on prod, 15/15 tests.
- Note: `/admin/practitioners` display fix is a separate item above (now shipped too).

### Payout timing rebuild — separate charges & transfers
- Status: `shipped` **[BLOCKS LAUNCH — see dry run above]**
- Requested by: Bo
- Summary: Client still charged in full at checkout; practitioner payout now waits 48h
  after session end before transferring, instead of paying out immediately.
- Spec: Switched from Stripe destination charges to separate charges & transfers. Full
  charge lands in platform balance at checkout. `PAYOUT_HOLD_HOURS=48`; a daily release
  sweep transfers the practitioner's share once the hold clears with no open
  refund/dispute/freeze. Refunds before release just refund the client; after release, the
  transfer is reversed first. Existing paid bookings grandfathered as released. A
  `platform_balance_low` alert guards against insufficient balance to cover pending payouts.
- Note: code shipped and deployed, but the real Stripe transfer + reversal calls are not
  yet verified against a live test-mode account — see the dry-run item above.

### Client-initiated refund request
- Status: `shipped`
- Requested by: Bo
- Summary: Clients can request a refund (technical failure within 24h, or another reason) —
  always admin-reviewed, never auto-approved.
- Spec: `refund_requests` table, one per booking. Reason types: `technical_failure` (24h
  post-session window, admin discretion for late reports, admin sees actual session
  telemetry instead of client-submitted evidence) or `other` (free text). Admin queue at
  `/admin/refunds` mirrors `/admin/review`; approve reuses the existing
  `refundBookingPayment` branching (before/after payout release); deny requires a reason
  shown to the client. Entry point is a low-key link near the review UI, not a CTA.

### Low-rating admin alert
- Status: `shipped`
- Requested by: Bo
- Summary: Admin gets a Telegram alert whenever a client leaves a 1★ (of 5) review —
  independent of whether a refund was requested.
- Spec: `isLowRating(rating, threshold)` extracted as a pure, tested function (default
  threshold=1, env-overridable). Hooked into `createReview` after a successful insert via
  the existing `raiseAlert` pattern. Wiring covered by a direct-call test with a mocked
  `raiseAlert` (16/16 total).

---

## Deferred

### Direct charges vs. destination charges decision
- Status: `deferred`
- Requested by: Bo
- Summary: Whether to move from destination charges to direct charges, shifting liability,
  merchant-of-record status, and tax/invoicing burden onto individual practitioners.
- Note: real trade-offs on both sides, not a technical toggle — needs the lawyer/accountant
  meeting before deciding.

### DAC7 data collection / report generation
- Status: `deferred`
- Requested by: Bo
- Summary: EU platform-operator tax reporting applies in principle — build the actual data
  collection and annual report generation.
- Note: TIN (not VAT number) is what's needed; Bulgarian ЕГН serves as both KYC ID and TIN.
  No small-seller exemption for personal-services platforms. Needs Bulgaria's exact NRA
  submission schema confirmed with the lawyer/accountant before building the report format.

### Split payout sweep + no-show reconciliation off the daily cron
- Status: `deferred`
- Requested by: Bo
- Summary: Move `runPayoutReleaseSweep` and `reconcileVideoRooms` out of the single bundled
  daily cron into their own more-frequent schedule.
- Note: both are already standalone functions — a config change once on Vercel Pro, not a
  refactor. Waiting on that upgrade being active.

### /how-it-works cleanup
- Status: `deferred`
- Requested by: Bo
- Summary: Remove the hardcoded specialties box and in-person/"live" meeting wording
  (platform is online-only).
- Note: starts after the SEO foundations pass above.
