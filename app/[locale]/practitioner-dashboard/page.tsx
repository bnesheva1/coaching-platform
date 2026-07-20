import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

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
  // Placeholder — there is no messaging feature anywhere in this app yet
  // (no `messages` table, nothing in the approved design either). Always
  // 0 for now; wired up here so the UI has a real place to plug real
  // data into once that feature exists, rather than a fake nonzero count.
  messageCount: number;
};

// Date.now() can't be called directly inside a component body — this
// project's lint config flags it (react-hooks/purity: component/hook
// functions must be render-idempotent). Same rationale and pattern as
// lib/booking-time.ts's splitUpcomingPast: a plain, non-component
// helper isn't subject to that rule.
function buildAgendaView(upcoming: AgendaBooking[]) {
  const now = Date.now();
  const missingLinkBookings = upcoming.filter(
    (b) => new Date(b.startUtc).getTime() - now <= MISSING_LINK_WINDOW_MS && !b.deliveryInfo,
  );
  const [nextBooking, ...restUpcoming] = upcoming;
  const upcomingThisWeek = restUpcoming.filter(
    (b) => new Date(b.startUtc).getTime() - now <= 7 * 24 * 60 * 60 * 1000,
  );
  return { missingLinkBookings, nextBooking, upcomingThisWeek };
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

  const [{ data: profile }, { data: practitionerProfile }, { data: services }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", userId).single(),
    supabase
      .from("practitioner_profiles")
      .select("bio, specialties, avatar_url, headline, location, timezone")
      .eq("id", userId)
      .single(),
    supabase
      .from("services")
      .select("id, name, duration_minutes, is_active, delivery_type")
      .eq("practitioner_id", userId)
      .order("created_at", { ascending: true }),
  ]);

  const { data: deliveryInfoRows } = (await supabase.rpc("get_my_services_delivery_info")) as {
    data: { service_id: string; delivery_info: string | null }[] | null;
  };
  const deliveryInfoByServiceId = new Map((deliveryInfoRows ?? []).map((row) => [row.service_id, row.delivery_info]));

  const { data: availabilityRules } = await supabase
    .from("practitioner_availability")
    .select("id")
    .eq("practitioner_id", userId);

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, client_id, service_id, start_utc")
    .eq("practitioner_id", userId)
    .in("status", ["pending", "confirmed"])
    .gte("start_utc", new Date().toISOString())
    .order("start_utc", { ascending: true });

  const timezone = practitionerProfile?.timezone ?? "Europe/Sofia";
  const activeServices = (services ?? []).filter((s) => s.is_active);
  const profileComplete = Boolean(
    practitionerProfile?.avatar_url &&
      practitionerProfile?.bio &&
      practitionerProfile?.headline &&
      practitionerProfile?.location &&
      (practitionerProfile?.specialties?.length ?? 0) > 0,
  );
  const availabilitySet = (availabilityRules ?? []).length > 0;
  const isBookable = profileComplete && activeServices.length >= 1 && availabilitySet;

  if (!isBookable) {
    const doneCount = [profileComplete, activeServices.length >= 1, availabilitySet].filter(Boolean).length;
    const step1 = stepStatus(profileComplete, !profileComplete);
    const step2 = stepStatus(activeServices.length >= 1, profileComplete && activeServices.length === 0);
    const step3 = stepStatus(availabilitySet, profileComplete && activeServices.length >= 1 && !availabilitySet);

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
    ];

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
            {t("activation.eyebrow")}
          </span>
          <h1 style={{ font: "var(--text-heading-lg)", margin: "var(--space-2) 0" }}>
            {t("activation.heading", { name: profile?.display_name ?? "" })}
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
            {t("activation.reassurance")}
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
    messageCount: 0,
  }));

  const { missingLinkBookings, nextBooking, upcomingThisWeek } = buildAgendaView(upcoming);

  const formatter = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <div>
        <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
          {t("agenda.greeting", { name: profile?.display_name ?? "" })}
        </p>
        <h1 style={{ font: "var(--text-heading-lg)", margin: "var(--space-1) 0 var(--space-4)" }}>{t("agenda.heading")}</h1>

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
              eyebrow={t("agenda.nextSessionEyebrow")}
              title={`${nextBooking.serviceName} — ${nextBooking.clientName}`}
              description={`${formatter.format(new Date(nextBooking.startUtc))} · ${tPublicProfile("serviceDuration", { minutes: nextBooking.durationMinutes })}`}
              footer={
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  {/* Placeholder — see the identical note on the
                      upcoming-this-week rows below; messageCount is
                      always 0 until a real messaging feature exists. */}
                  <span
                    aria-label={t("agenda.messagesFromClient", { count: nextBooking.messageCount })}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--space-1)",
                      font: "var(--text-body-sm)",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    <span aria-hidden style={{ font: "var(--text-icon)" }}>💬</span>
                    {nextBooking.messageCount}
                  </span>
                  {nextBooking.deliveryType === "online" && nextBooking.deliveryInfo ? (
                    <a
                      href={nextBooking.deliveryInfo}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-block",
                        padding: "var(--button-padding-md)",
                        borderRadius: "var(--radius-md)",
                        background: "var(--accent)",
                        color: "var(--text-on-accent)",
                        font: "var(--text-button-md)",
                        textDecoration: "none",
                        alignSelf: "flex-start",
                      }}
                    >
                      {t("agenda.joinSession")}
                    </a>
                  ) : nextBooking.deliveryInfo ? (
                    <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
                      {tBooking("deliveryLabelInPerson")}: {nextBooking.deliveryInfo}
                    </p>
                  ) : null}
                </div>
              }
            />
          </div>
        )}

        <h2 style={{ font: "var(--text-heading-md)", margin: "0 0 var(--space-4)" }}>{t("agenda.upcomingWeekHeading")}</h2>
        {upcomingThisWeek.length === 0 ? (
          <p style={{ color: "var(--text-secondary)" }}>{t("agenda.noUpcomingThisWeek")}</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {upcomingThisWeek.map((b) => (
              <li
                key={b.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--space-4)",
                  padding: "var(--space-4) 0",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <span>
                  <strong>{formatter.format(new Date(b.startUtc))}</strong> — {tBooking("withClient", { name: b.clientName })} · {b.serviceName} ·{" "}
                  {tPublicProfile("serviceDuration", { minutes: b.durationMinutes })}
                </span>
                {/* Placeholder — no messaging feature exists anywhere in
                    this app yet (no `messages` table, nothing in the
                    approved design either); messageCount is always 0.
                    Kept visible (not hidden at 0) since the icon+count is
                    itself the placeholder for functionality landing
                    later, per your standing "show placeholders for 2nd-
                    phase functionality" instruction. */}
                <span
                  aria-label={t("agenda.messagesFromClient", { count: b.messageCount })}
                  style={{
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                    font: "var(--text-body-sm)",
                    color: "var(--text-tertiary)",
                  }}
                >
                  <span aria-hidden style={{ font: "var(--text-icon)" }}>💬</span>
                  {b.messageCount}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div style={{ marginTop: "var(--space-4)" }}>
          <Button href="/practitioner-dashboard/bookings" variant="secondary">
            {t("agenda.showAllSessions")}
          </Button>
        </div>
      </div>
    </main>
  );
}
