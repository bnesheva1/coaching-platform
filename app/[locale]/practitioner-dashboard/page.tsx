import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { GreetingText } from "@/components/dashboard/GreetingText";
import { CancelSessionDialog } from "@/components/bookings/CancelSessionDialog";
import { cancelBookingAsPractitioner } from "./cancel-booking-actions";
import { JoinSessionLink } from "@/components/bookings/JoinSessionLink";
import { NextSessionWhen } from "@/components/dashboard/NextSessionWhen";
import { notPastEndCutoffIso } from "@/lib/video/sessionWindow";
import { isEnabled } from "@/lib/flags";
import { AvailabilityWidget } from "@/components/immediate/AvailabilityWidget";
import { getPractitionerStats } from "@/lib/practitioners/stats";
import { PractitionerStatsSummary } from "@/components/practitioners/PractitionerStats";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

const MISSING_LINK_WINDOW_MS = 48 * 60 * 60 * 1000;

type StepStatus = "done" | "current" | "future";

function stepStatus(done: boolean, isNextIncomplete: boolean): StepStatus {
  if (done) return "done";
  return isNextIncomplete ? "current" : "future";
}

type AgendaBooking = {
  id: string;
  clientName: string;
  serviceName: string;
  durationMinutes: number;
  deliveryType: "online" | "in_person" | null;
  deliveryInfo: string | null;
  startUtc: string;
  endUtc: string;
};

// Date.now() can't be called directly inside a component body — this
// project's lint config flags it (react-hooks/purity: component/hook
// functions must be render-idempotent). Same rationale and pattern as
// lib/booking-time.ts's splitUpcomingPast: a plain, non-component
// helper isn't subject to that rule.
function buildAgendaView(upcoming: AgendaBooking[]) {
  const now = Date.now();
  // Online sessions use the in-app video room (no external link), so they
  // never need a "missing link" nudge — only non-online delivery does.
  const missingLinkBookings = upcoming.filter(
    (b) => b.deliveryType !== "online" && new Date(b.startUtc).getTime() - now <= MISSING_LINK_WINDOW_MS && !b.deliveryInfo,
  );
  // The home shows only the single next/in-progress session; the full list
  // lives in the Sessions tab, reached via the "manage bookings" button.
  const [nextBooking] = upcoming;
  return { missingLinkBookings, nextBooking };
}

// Auth/role guard already ran in layout.tsx — this page can assume
// `user` is a signed-in practitioner.
export default async function PractitionerHomePage() {
  const t = await getTranslations("Dashboard");
  const tBooking = await getTranslations("Booking");
  const tPublicProfile = await getTranslations("PublicProfile");
  const locale = await getLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Guaranteed non-null by the layout guard — narrows the type for the
  // rest of this function without a redundant redirect.
  const userId = user!.id;

  // Immediate-booking presence widget — only when the feature flag is on. The
  // initial state is the DERIVED availability (fresh heartbeat), so a quick
  // reload resumes it and a stale one reads offline.
  const immediateEnabled = await isEnabled("immediateBooking");
  const immediateAvailable = immediateEnabled
    ? !!(await supabase.rpc("is_practitioner_available_now", { target: userId })).data
    : false;

  const [{ data: profile }, { data: practitionerProfile }, { data: services }, { data: bookableStatus }] =
    await Promise.all([
      supabase.from("profiles").select("display_name").eq("id", userId).single(),
      // timezone/billing_model only — profile-completeness fields
      // (bio/specialties/avatar_url/headline/location) used to be read
      // here too, but bookability is now entirely derived by
      // get_my_bookable_status() below, the single source of truth
      // shared with Browse/search and the public profile page.
      supabase.from("practitioner_profiles").select("timezone, billing_model").eq("id", userId).single(),
      supabase
        .from("services")
        .select("id, name, duration_minutes, is_active, delivery_type")
        .eq("practitioner_id", userId)
        .order("created_at", { ascending: true }),
      supabase.rpc("get_my_bookable_status").single() as unknown as Promise<{
        data: {
          profile_complete: boolean;
          has_active_service: boolean;
          availability_set: boolean;
          connect_ready: boolean;
          is_bookable: boolean;
        } | null;
      }>,
    ]);

  const { data: deliveryInfoRows } = (await supabase.rpc("get_my_services_delivery_info")) as {
    data: { service_id: string; delivery_info: string | null }[] | null;
  };
  const deliveryInfoByServiceId = new Map((deliveryInfoRows ?? []).map((row) => [row.service_id, row.delivery_info]));

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, client_id, service_id, start_utc, end_utc")
    .eq("practitioner_id", userId)
    .in("status", ["pending", "confirmed"])
    // Not-past (room still open) rather than not-yet-started, so a session
    // in progress still appears here with its join/rejoin button.
    .gte("end_utc", notPastEndCutoffIso())
    .order("start_utc", { ascending: true });

  const timezone = practitionerProfile?.timezone ?? "Europe/Sofia";
  const isBookable = bookableStatus?.is_bookable ?? false;

  if (!isBookable) {
    const profileComplete = bookableStatus?.profile_complete ?? false;
    const hasActiveService = bookableStatus?.has_active_service ?? false;
    const availabilitySet = bookableStatus?.availability_set ?? false;
    const connectReady = bookableStatus?.connect_ready ?? false;
    // The Connect step only exists for commission-model practitioners —
    // software_provider ones are exempt from that condition entirely
    // (see practitioner_bookable_flags' own comment), so showing them a
    // step they can never usefully act on would be actively confusing.
    const showConnectStep = practitionerProfile?.billing_model === "commission";

    const step1 = stepStatus(profileComplete, !profileComplete);
    const step2 = stepStatus(hasActiveService, profileComplete && !hasActiveService);
    const step3 = stepStatus(availabilitySet, profileComplete && hasActiveService && !availabilitySet);
    const step4 = stepStatus(connectReady, profileComplete && hasActiveService && availabilitySet && !connectReady);

    // Every tile gets a CTA to its own tab, always shown — a deliberate
    // deviation from the design source (which only shows a CTA on
    // whichever single step is current, and never on step 1 at all),
    // per your explicit request that every tile lead somewhere.
    const steps: { status: StepStatus; title: string; desc: string; cta: { label: string; href: string } }[] = [
      {
        status: step1,
        title: t("activation.step1Title"),
        desc: t("activation.step1Desc"),
        cta: { label: t("activation.step1Cta"), href: "/practitioner-dashboard/profile" },
      },
      {
        status: step2,
        title: t("activation.step2Title"),
        desc: t("activation.step2Desc"),
        cta: { label: t("activation.step2Cta"), href: "/practitioner-dashboard/services" },
      },
      {
        status: step3,
        title: t("activation.step3Title"),
        desc: t("activation.step3Desc"),
        cta: { label: t("activation.step3Cta"), href: "/practitioner-dashboard/schedule" },
      },
      ...(showConnectStep
        ? [
            {
              status: step4,
              title: t("activation.step4Title"),
              desc: t("activation.step4Desc"),
              cta: { label: t("activation.step4Cta"), href: "/practitioner-dashboard/profile" },
            },
          ]
        : []),
    ];
    const doneCount = steps.filter((s) => s.status === "done").length;

    // A practitioner who has ever had ANY booking (any status, any
    // time) was clearly bookable at some point — "let's get you ready
    // for your first booking" is wrong for someone who's since
    // regressed (e.g. hid their last service), and silent invisibility
    // like that is a real churn risk. Distinct copy for that case; a
    // genuinely brand-new practitioner keeps the existing onboarding
    // copy unchanged.
    const { count: everBookedCount } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("practitioner_id", userId);
    const hasEverHadBooking = (everBookedCount ?? 0) > 0;

    return (
      <main style={{ padding: "var(--space-8) 0", position: "relative" }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -80,
            right: -80,
            width: 320,
            height: 320,
            borderRadius: "50%",
            background: "var(--accent-glow)",
            filter: "blur(40px)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative" }}>
          <span style={{ font: "var(--text-overline)", letterSpacing: "var(--letter-overline)", textTransform: "uppercase", color: "var(--accent)" }}>
            {t(hasEverHadBooking ? "activation.regressedEyebrow" : "activation.eyebrow")}
          </span>
          <h1 style={{ font: "var(--text-heading-lg)", margin: "var(--space-2) 0" }}>
            {t(hasEverHadBooking ? "activation.regressedHeading" : "activation.heading", { name: profile?.display_name ?? "" })}
          </h1>

          <div
            role="progressbar"
            aria-valuenow={doneCount}
            aria-valuemin={0}
            aria-valuemax={steps.length}
            style={{
              height: 6,
              borderRadius: "var(--radius-pill)",
              background: "var(--bg-sunken)",
              overflow: "hidden",
              margin: "var(--space-4) 0 var(--space-4)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${(doneCount / steps.length) * 100}%`,
                background: "var(--accent)",
                transition: "width var(--duration-base) var(--ease-standard)",
              }}
            />
          </div>
          <p style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)", margin: "0 0 var(--space-6)" }}>
            {t("activation.progress", { done: doneCount, total: steps.length })}
          </p>

          <ol style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {steps.map((step, i) => (
              <li key={step.title} aria-current={step.status === "current" ? "step" : undefined}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "var(--space-4)",
                    padding: "var(--space-10) 20px",
                    borderRadius: "var(--radius-xl)",
                    background: step.status === "future" ? "var(--bg-surface-2)" : "var(--bg-surface)",
                    border:
                      step.status === "current" ? "1px solid var(--border-strong)" : "1px solid var(--border-subtle)",
                    boxShadow:
                      step.status === "current" ? "var(--shadow-md)" : step.status === "future" ? "none" : "var(--shadow-sm)",
                    opacity: step.status === "future" ? 0.7 : 1,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flexShrink: 0,
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      font: "var(--text-heading-sm)",
                      fontWeight: 700,
                      background: step.status === "done" ? "var(--accent)" : "var(--bg-sunken)",
                      color: step.status === "done" ? "var(--text-on-accent)" : "var(--text-tertiary)",
                    }}
                  >
                    {step.status === "done" ? "✓" : i + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <p style={{ margin: 0, font: "var(--text-heading-sm)", color: step.status === "future" ? "var(--text-secondary)" : "var(--text-primary)" }}>
                      {step.title}
                      {step.status === "done" && <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>{t("activation.stepDoneSr")}</span>}
                    </p>
                    <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>{step.desc}</p>
                  </div>
                  <Button href={step.cta.href} variant={step.status === "current" ? "primary" : "secondary"} size="sm">
                    {step.cta.label}
                  </Button>
                </div>
              </li>
            ))}
          </ol>

          <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", marginTop: "var(--space-4)" }}>
            {t(hasEverHadBooking ? "activation.regressedReassurance" : "activation.reassurance")}
          </p>
        </div>
      </main>
    );
  }

  // Agenda / established branch.
  const clientIds = [...new Set((bookings ?? []).map((b) => b.client_id))];
  const [{ data: clients }] = await Promise.all([
    clientIds.length > 0
      ? supabase.from("profiles").select("id, display_name").in("id", clientIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
  ]);
  const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.display_name ?? ""]));
  const serviceById = new Map((services ?? []).map((s) => [s.id, s]));

  const upcoming = (bookings ?? []).map((b) => ({
    id: b.id,
    clientName: clientNameById.get(b.client_id) ?? "",
    serviceName: serviceById.get(b.service_id)?.name ?? "",
    durationMinutes: serviceById.get(b.service_id)?.duration_minutes ?? 0,
    deliveryType: serviceById.get(b.service_id)?.delivery_type ?? null,
    deliveryInfo: deliveryInfoByServiceId.get(b.service_id) ?? null,
    startUtc: b.start_utc,
    endUtc: b.end_utc,
  }));

  const { missingLinkBookings, nextBooking } = buildAgendaView(upcoming);

  const tStats = await getTranslations("Stats");
  const homeStats = await getPractitionerStats(userId);

  const formatter = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <div>
        <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
          <GreetingText name={profile?.display_name ?? ""} />
        </p>
        <h1 style={{ font: "var(--text-heading-lg)", margin: "var(--space-1) 0 var(--space-4)" }}>{t("agenda.heading")}</h1>

        {immediateEnabled && (
          <div style={{ marginBottom: "var(--space-6)" }}>
            <AvailabilityWidget initialAvailable={immediateAvailable} />
          </div>
        )}

        {(upcoming.length > 0 || missingLinkBookings.length > 0) && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-6)" }}>
            {upcoming.length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--bg-surface-2)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-3) var(--space-4)",
                }}
              >
                <span style={{ font: "var(--text-body-sm)" }}>{t("agenda.upcomingCount", { count: upcoming.length })}</span>
                <Link href="/practitioner-dashboard/bookings" style={{ font: "var(--text-label)", color: "var(--accent)" }}>
                  {t("agenda.viewAll")}
                </Link>
              </div>
            )}
            {missingLinkBookings.map((b) => (
              <div
                key={b.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--accent-subtle)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-3) var(--space-4)",
                }}
              >
                <span style={{ font: "var(--text-body-sm)", color: "var(--accent-subtle-text)" }}>
                  {t("agenda.missingLinkNudge")} — {b.clientName} · {formatter.format(new Date(b.startUtc))}
                </span>
                <Link href="/practitioner-dashboard/services" style={{ font: "var(--text-label)", color: "var(--accent-subtle-text)" }}>
                  {t("agenda.addLink")}
                </Link>
              </div>
            ))}
          </div>
        )}

        {nextBooking && (
          <div style={{ marginBottom: "var(--space-6)" }}>
            <Card
              eyebrow={
                <NextSessionWhen
                  startUtc={nextBooking.startUtc}
                  endUtc={nextBooking.endUtc}
                  savedTimezone={timezone}
                  fallback={t("agenda.nextSessionEyebrow")}
                />
              }
              title={`${nextBooking.serviceName} — ${nextBooking.clientName}`}
              description={`${formatter.format(new Date(nextBooking.startUtc))} · ${tPublicProfile("serviceDuration", { minutes: nextBooking.durationMinutes })}`}
              footer={
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  {nextBooking.deliveryType === "online" ? (
                    // Same shared join/rejoin affordance the sessions list
                    // uses, so the two surfaces read identically.
                    <JoinSessionLink
                      bookingId={nextBooking.id}
                      startUtc={nextBooking.startUtc}
                      endUtc={nextBooking.endUtc}
                      savedTimezone={timezone}
                    />
                  ) : nextBooking.deliveryInfo ? (
                    <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
                      {tBooking("deliveryLabelInPerson")}: {nextBooking.deliveryInfo}
                    </p>
                  ) : null}

                  {/* The home shows only this one session, so its cancel
                      action has to live here — the rest of the list is in
                      the Sessions tab. */}
                  <div style={{ alignSelf: "flex-end" }}>
                    <CancelSessionDialog
                      counterpartName={nextBooking.clientName}
                      sessionTimeLabel={formatter.format(new Date(nextBooking.startUtc))}
                      perspective="practitioner"
                      action={cancelBookingAsPractitioner.bind(null, nextBooking.id)}
                    />
                  </div>
                </div>
              }
            />
          </div>
        )}

        <div>
          <Button href="/practitioner-dashboard/bookings" variant="secondary">
            {t("agenda.manageBookings")}
          </Button>
        </div>

        <section style={{ marginTop: "var(--space-10)" }}>
          <h2 style={{ margin: "0 0 var(--space-4)", font: "var(--text-heading-md)" }}>{tStats("homeTitle")}</h2>
          <PractitionerStatsSummary stats={homeStats} />
        </section>
      </div>
    </main>
  );
}
