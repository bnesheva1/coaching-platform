"use client";

import { useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useIsMobile } from "@/lib/useIsMobile";
import { bookSlot } from "@/app/[locale]/p/[username]/booking-actions";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

// 3 day-columns at a time on desktop — the design source's own
// suggested default (exact page size wasn't specified in the mock).
const DESKTOP_PAGE_SIZE = 3;
const MOBILE_INITIAL_DAYS = 7;
const MOBILE_SHOW_MORE_STEP = 7;

// Same useSyncExternalStore pattern as the old SlotList.tsx / (Epic 4's)
// ScheduleSettingsForm.tsx — the browser's timezone can't be known
// during SSR, so the server and client snapshots must differ safely
// rather than via useEffect+setState.
function subscribeToNothing() {
  return () => {};
}
function getDetectedTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
function getServerTimezoneSnapshot(): string | null {
  return null;
}

export type SlotPickerSlot = { startUtc: string };
export type SlotPickerOwnBooking = { id: string; startUtc: string };

export type SlotPickerProps = {
  slots: SlotPickerSlot[];
  // The viewing client's own existing bookings with this practitioner
  // (any service) — always [] for a non-client viewer, see
  // getOwnBookingsWithPractitioner's RLS note.
  ownBookings: SlotPickerOwnBooking[];
  practitionerId: string;
  serviceId: string;
  username: string;
  viewerRole: "client" | "practitioner" | null;
  // lib/availability/generateSlots.ts's BOOKING_WINDOW_DAYS, passed
  // through as a prop rather than imported directly here — that module
  // pulls in luxon at the top level, and every other client component
  // in this app (SlotList.tsx before it) deliberately sticks to plain
  // Date/Intl to avoid pulling luxon into the client bundle at all.
  windowDays: number;
};

type Chip =
  | { kind: "available"; startUtc: string }
  | { kind: "own"; id: string; startUtc: string };

type DayBucket = {
  key: string; // YYYY-MM-DD in the client's own timezone
  anchor: Date; // a representative instant for this calendar day, for formatting
  chips: Chip[];
};

const cardBase: CSSProperties = {
  display: "flex",
  flexDirection: "column",
};

// Literal px values below (14px/12px/10px/7px/6px/5px, 96px min-height)
// come straight from the approved hifi mock and don't land on the
// --space-N grid — kept as explicit values rather than rounded onto the
// nearest token, same precedent as --field-padding/--button-padding-*
// in tokens/spacing.css.
export function SlotPicker({
  slots,
  ownBookings,
  practitionerId,
  serviceId,
  username,
  viewerRole,
  windowDays,
}: SlotPickerProps) {
  const t = useTranslations("Booking");
  const locale = useLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const isMobile = useIsMobile();

  const clientTimezone =
    useSyncExternalStore(subscribeToNothing, getDetectedTimezone, getServerTimezoneSnapshot) ?? "UTC";

  const [selectedStartUtc, setSelectedStartUtc] = useState<string | null>(null);
  const [desktopPageStart, setDesktopPageStart] = useState(0);
  const [mobileVisibleCount, setMobileVisibleCount] = useState(MOBILE_INITIAL_DAYS);
  const [jumpDateOpen, setJumpDateOpen] = useState(false);

  // en-CA gives a stable, sortable YYYY-MM-DD string directly — used
  // only as an internal grouping/lookup key, never shown to the user
  // (the locale-aware formatters below handle all visible text).
  const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: clientTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const weekdayFormatter = new Intl.DateTimeFormat(intlLocale, { weekday: "short", timeZone: clientTimezone });
  const dateLabelFormatter = new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "long",
    timeZone: clientTimezone,
  });
  const mobileHeadingFormatter = new Intl.DateTimeFormat(intlLocale, {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: clientTimezone,
  });
  const fullDayFormatter = new Intl.DateTimeFormat(intlLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: clientTimezone,
  });
  const timeFormatter = new Intl.DateTimeFormat(intlLocale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: clientTimezone,
  });

  // windowDays consecutive calendar days starting "today" in the
  // CLIENT's own timezone — anchored at UTC noon per day so plain
  // millisecond arithmetic can't cross into the wrong local calendar
  // date (no timezone in the world is more than 14h off UTC, so noon
  // UTC +/- that never lands on the adjacent UTC calendar date).
  const todayKey = dayKeyFormatter.format(new Date());
  const todayNoonUtc = new Date(`${todayKey}T12:00:00Z`);

  const days: DayBucket[] = [];
  const dayIndexByKey = new Map<string, number>();
  for (let i = 0; i < windowDays; i++) {
    const anchor = new Date(todayNoonUtc.getTime() + i * 86400000);
    const key = dayKeyFormatter.format(anchor);
    dayIndexByKey.set(key, days.length);
    days.push({ key, anchor, chips: [] });
  }

  for (const slot of slots) {
    const idx = dayIndexByKey.get(dayKeyFormatter.format(new Date(slot.startUtc)));
    if (idx !== undefined) days[idx].chips.push({ kind: "available", startUtc: slot.startUtc });
  }
  for (const booking of ownBookings) {
    const idx = dayIndexByKey.get(dayKeyFormatter.format(new Date(booking.startUtc)));
    if (idx !== undefined) days[idx].chips.push({ kind: "own", id: booking.id, startUtc: booking.startUtc });
  }
  for (const day of days) {
    day.chips.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  }

  const hasAnyContent = days.some((day) => day.chips.length > 0);
  const lastDayKey = days[days.length - 1]?.key ?? todayKey;

  function jumpToDay(key: string) {
    const idx = dayIndexByKey.get(key);
    if (idx === undefined) return;
    if (isMobile) {
      setMobileVisibleCount((count) => Math.max(count, idx + 1));
    } else {
      setDesktopPageStart(Math.min(idx, Math.max(0, windowDays - DESKTOP_PAGE_SIZE)));
    }
    setJumpDateOpen(false);
  }

  function renderChip(chip: Chip, size: "desktop" | "mobile") {
    const time = timeFormatter.format(new Date(chip.startUtc));
    const chipFont =
      size === "desktop" ? "600 12px var(--font-ui)" : "600 11px var(--font-ui)";
    const chipPadding = size === "desktop" ? "7px 12px" : "6px 10px";

    if (chip.kind === "own") {
      return (
        <Link
          key={chip.id}
          href={`/client-dashboard#booking-${chip.id}`}
          className="slot-chip slot-chip--own focus-ring"
          aria-label={t("ownBookingAria", { time })}
          style={{ font: chipFont, padding: chipPadding }}
        >
          <span aria-hidden="true">✓</span>
          {time}
        </Link>
      );
    }

    if (viewerRole !== "client") {
      return (
        <span
          key={chip.startUtc}
          className="slot-chip slot-chip--available-readonly"
          style={{ font: chipFont, padding: chipPadding }}
        >
          {time}
        </span>
      );
    }

    const isSelected = selectedStartUtc === chip.startUtc;
    return (
      <form
        key={chip.startUtc}
        action={bookSlot.bind(null, practitionerId, serviceId, username, chip.startUtc, clientTimezone)}
        onSubmit={(e) => {
          if (!confirm(t("confirmBooking", { time }))) {
            e.preventDefault();
            setSelectedStartUtc(null);
          }
        }}
      >
        <button
          type="submit"
          className={`slot-chip focus-ring ${isSelected ? "slot-chip--selected" : "slot-chip--available"}`}
          aria-pressed={isSelected}
          onClick={() => setSelectedStartUtc(chip.startUtc)}
          style={{ font: chipFont, padding: chipPadding }}
        >
          {time}
        </button>
      </form>
    );
  }

  function renderDayCard(day: DayBucket, size: "desktop" | "mobile") {
    const isEmpty = day.chips.length === 0;
    const radius = size === "desktop" ? "var(--radius-xl)" : "var(--radius-lg)";
    const padding = size === "desktop" ? "14px" : "12px";
    const gap = size === "desktop" ? "10px" : "8px";

    if (isEmpty) {
      return (
        <div
          key={day.key}
          aria-label={fullDayFormatter.format(day.anchor)}
          style={{
            ...cardBase,
            flex: size === "desktop" ? 1 : undefined,
            borderRadius: radius,
            background: "var(--bg-sunken)",
            border: "1px dashed var(--border-default)",
            padding,
            gap: size === "desktop" ? "8px" : undefined,
            alignItems: size === "desktop" ? "center" : undefined,
            justifyContent: size === "desktop" ? "center" : undefined,
            textAlign: "center",
            minHeight: size === "desktop" ? "96px" : undefined,
          }}
        >
          {size === "desktop" ? (
            <div>
              <div style={{ font: "var(--text-caption)", color: "var(--text-tertiary)" }}>
                {weekdayFormatter.format(day.anchor)}
              </div>
              <div style={{ font: "600 16px var(--font-ui)", color: "var(--text-tertiary)" }}>
                {dateLabelFormatter.format(day.anchor)}
              </div>
            </div>
          ) : (
            <span
              style={{
                font: "600 12px var(--font-ui)",
                color: "var(--text-tertiary)",
                display: "block",
                marginBottom: "2px",
              }}
            >
              {mobileHeadingFormatter.format(day.anchor)}
            </span>
          )}
          <span style={{ font: size === "desktop" ? "var(--text-caption)" : "10px var(--font-ui)", color: "var(--text-tertiary)" }}>
            {t("noSlotsThisDay")}
          </span>
        </div>
      );
    }

    return (
      <section
        key={day.key}
        aria-label={fullDayFormatter.format(day.anchor)}
        style={{
          ...cardBase,
          flex: size === "desktop" ? 1 : undefined,
          borderRadius: radius,
          // Plain --bg-surface (matching the tile itself) with a
          // --border-default outline, not a --bg-surface-2 fill with a
          // --border-subtle line — those two tokens are only ~3-4
          // lightness points apart, so the card nearly disappeared
          // against the tile, and the pale accent-subtle chips (also in
          // that same washed-out lightness band) barely read against
          // it either. A plain surface + a firmer border gives the card
          // real definition, and lets the chips read clearly against a
          // true background instead of another muted one.
          background: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
          padding,
          gap,
        }}
      >
        {/* h4, not h3 — nested one level under this section's own
            "Изберете свободен час" h3 heading below, not a sibling of it. */}
        {size === "desktop" ? (
          <div>
            <div style={{ font: "var(--text-caption)", color: "var(--text-tertiary)" }}>
              {weekdayFormatter.format(day.anchor)}
            </div>
            <h4 style={{ margin: 0, font: "600 16px var(--font-ui)", color: "var(--text-primary)" }}>
              {dateLabelFormatter.format(day.anchor)}
            </h4>
          </div>
        ) : (
          <h4 style={{ margin: 0, font: "600 13px var(--font-ui)", color: "var(--text-primary)" }}>
            {mobileHeadingFormatter.format(day.anchor)}
          </h4>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: size === "desktop" ? "6px" : "5px" }}>
          {day.chips.map((chip) => renderChip(chip, size))}
        </div>
      </section>
    );
  }

  const linkStyle: CSSProperties = {
    font: "var(--text-label)",
    color: "var(--accent)",
    textDecoration: "underline",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
  };

  // Shared jump-to-date control — rendered once per branch below (the
  // desktop/mobile blocks are mutually exclusive on isMobile, so only
  // one instance ever exists at a time, safe to share the one
  // jumpDateOpen bit of state). openDirection differs by call site: the
  // desktop instance sits mid-row next to the paging arrows, with
  // ordinary space below it, so it opens downward like any normal
  // dropdown; the mobile instance sits at the very bottom of the
  // stack, where a downward popover would extend past visible content.
  function renderJumpToDate(openDirection: "up" | "down") {
    return (
      <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <button type="button" className="focus-ring" style={linkStyle} onClick={() => setJumpDateOpen((v) => !v)}>
          {t("jumpToDate")}
        </button>
        {jumpDateOpen && (
          <input
            type="date"
            className="form-field focus-ring"
            aria-label={t("jumpToDateLabel")}
            min={todayKey}
            max={lastDayKey}
            autoFocus
            onChange={(e) => jumpToDay(e.target.value)}
            onBlur={() => setJumpDateOpen(false)}
            style={{
              position: "absolute",
              ...(openDirection === "up"
                ? { bottom: "calc(100% + var(--space-1))" }
                : { top: "calc(100% + var(--space-1))" }),
              right: 0,
              zIndex: 1,
              font: "var(--text-body-sm)",
              padding: "6px 8px",
            }}
          />
        )}
      </div>
    );
  }

  // No outer background/padding wrapper of its own — this renders
  // directly inside the service tile's existing accordion area (see
  // PractitionerProfileView.tsx), which already supplies the tile's
  // established --bg-surface + spacing. The mockup's rounded, shadowed
  // outer frame was that reference file's own screenshot chrome, not a
  // real UI element to reproduce here.
  return (
    <>
      {/* h3, nested under this tile's own service-name/"Услуги" level —
          orients the client before any times are scanned, per the
          heading this section was previously missing entirely. Day-card
          date labels below are h4, one level under this. */}
      <h3 style={{ margin: "0 0 var(--space-1)", font: "var(--text-label)", color: "var(--text-primary)" }}>
        {t("chooseTimeHeading")}
      </h3>
      <p style={{ margin: "0 0 var(--space-3)", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
        {t("timesShownIn", { timezone: clientTimezone })}
      </p>

      {/* Login prompt stays up top — unlike the practitioner-preview
          note below, it's an actionable prompt worth seeing before
          scanning times, not a caveat to de-emphasize. */}
      {viewerRole === null && (
        <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", margin: "0 0 var(--space-3)" }}>
          {t.rich("logInToBookPrompt", {
            login: (chunks) => <Link href="/login">{chunks}</Link>,
          })}
        </p>
      )}

      {!hasAnyContent && (
        <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
          {t("noSlotsAvailable", { days: windowDays })}
        </p>
      )}

      {hasAnyContent && !isMobile && (
        <div>
          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
            <button
              type="button"
              className="focus-ring"
              aria-label={t("previousDays")}
              disabled={desktopPageStart === 0}
              onClick={() => setDesktopPageStart((p) => Math.max(0, p - DESKTOP_PAGE_SIZE))}
              style={{
                alignSelf: "center",
                background: "none",
                border: "none",
                color: "var(--text-tertiary)",
                fontSize: "16px",
                cursor: desktopPageStart === 0 ? "default" : "pointer",
                opacity: desktopPageStart === 0 ? 0.35 : 1,
                padding: "var(--space-1)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              ‹
            </button>
            {days.slice(desktopPageStart, desktopPageStart + DESKTOP_PAGE_SIZE).map((day) => renderDayCard(day, "desktop"))}
            <button
              type="button"
              className="focus-ring"
              aria-label={t("nextDays")}
              disabled={desktopPageStart + DESKTOP_PAGE_SIZE >= windowDays}
              onClick={() =>
                setDesktopPageStart((p) => Math.min(Math.max(0, windowDays - DESKTOP_PAGE_SIZE), p + DESKTOP_PAGE_SIZE))
              }
              style={{
                alignSelf: "center",
                background: "none",
                border: "none",
                color: "var(--text-tertiary)",
                fontSize: "16px",
                cursor: desktopPageStart + DESKTOP_PAGE_SIZE >= windowDays ? "default" : "pointer",
                opacity: desktopPageStart + DESKTOP_PAGE_SIZE >= windowDays ? 0.35 : 1,
                padding: "var(--space-1)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              ›
            </button>
          </div>
          {/* Its own row below the day cards, right-aligned under the
              › arrow — still near the day-navigation controls for
              discoverability, but bottom-aligned rather than vertically
              centered against the (often taller) day cards next to it. */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-2)" }}>
            {renderJumpToDate("down")}
          </div>
        </div>
      )}

      {hasAnyContent && isMobile && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {days.slice(0, mobileVisibleCount).map((day) => renderDayCard(day, "mobile"))}
          {/* Mobile has no paging arrows — "Покажи още дни" is its
              equivalent day-navigation control, so jump-to-date is
              grouped with that instead, at the bottom of the stack. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: mobileVisibleCount < windowDays ? "space-between" : "flex-end",
              gap: "var(--space-2)",
            }}
          >
            {mobileVisibleCount < windowDays && (
              <button
                type="button"
                className="focus-ring"
                onClick={() => setMobileVisibleCount((c) => Math.min(windowDays, c + MOBILE_SHOW_MORE_STEP))}
                style={linkStyle}
              >
                {t("showMoreDays")}
              </button>
            )}
            {renderJumpToDate("up")}
          </div>
        </div>
      )}

      {/* De-emphasized preview-mode footnote, at the very bottom — not
          a prominent line above the times. Covers both a practitioner
          previewing their own profile and a different practitioner
          browsing someone else's public page; viewerRole doesn't
          distinguish the two today, and both get the same "you're
          seeing this as a non-client" framing either way. */}
      {viewerRole === "practitioner" && (
        <p style={{ font: "var(--text-caption)", color: "var(--text-tertiary)", margin: "var(--space-3) 0 0" }}>
          *{t("practitionerPreviewNote")}
        </p>
      )}
    </>
  );
}
