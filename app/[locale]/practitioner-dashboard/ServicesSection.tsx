"use client";

import { Fragment, useActionState, useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/ConfirmDialog";
import { EditPencilButton } from "@/components/practitioner-profile/EditPencilButton";
import { RemoveImageButton } from "@/components/practitioner-profile/RemoveImageButton";
import {
  createService,
  updateService,
  setServiceActive,
  deleteService,
  type ServiceFormState,
} from "./services-actions";
import { splitTextAndUrls } from "@/lib/linkify";

type DeliveryType = "online" | "in_person" | "phone";

type Service = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number;
  currency: string;
  is_active: boolean;
  delivery_type: DeliveryType | null;
  delivery_info: string | null;
  phone_number: string | null;
  image_url: string | null;
  documents_enabled: boolean;
  // Active/upcoming bookings for THIS service — > 0 locks price/
  // duration/deliveryType in the edit form (Option B: structural fields
  // become read-only once someone has already booked under the current
  // terms; name/description/image/phone_number stay editable always).
  upcoming_booking_count: number;
};

const initialState: ServiceFormState = null;

// Mirrors MAX_NAME_LENGTH/MAX_DESCRIPTION_LENGTH/MAX_DELIVERY_INFO_LENGTH/
// MAX_PHONE_LENGTH in services-actions.ts — duplicated, not imported,
// same client/server-boundary reasoning as AvailabilitySection.tsx's
// MIN_DURATION_MINUTES. The server action re-validates from scratch
// regardless; this just stops you from typing past the limit instead
// of only failing on submit.
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_DELIVERY_INFO_LENGTH = 500;
const MAX_PHONE_LENGTH = 30;
// Mirrors MIN_DURATION_MINUTES/MAX_DURATION_MINUTES in
// services-actions.ts — the fixed dropdown offers exactly these 7
// values, no free entry.
const DURATION_OPTIONS = [30, 45, 60, 75, 90, 105, 120] as const;
const DEFAULT_DURATION_MINUTES = 60;
// Price bounds (min €20; the max is the practitioner's effective ceiling) are
// resolved server-side and passed in via EarningsInfo now — see the page.

function formatPrice(priceCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(priceCents / 100);
}

// Reused for both the practitioner's own read-only display and (once
// rendered client-side) any future reuse — same splitTextAndUrls
// helper the email templates and client dashboard also use, so a URL
// in delivery info is clickable everywhere it's shown, not just some
// places.
function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {splitTextAndUrls(text).map((segment, i) =>
        segment.type === "url" ? (
          <a key={i} href={segment.value} target="_blank" rel="noreferrer">
            {segment.value}
          </a>
        ) : (
          <Fragment key={i}>{segment.value}</Fragment>
        ),
      )}
    </>
  );
}

// Same square-thumbnail treatment as the profile page's service tiles
// (components/practitioner-profile/PractitionerProfileView.tsx),
// including that file's own "no image → no placeholder" rule: renders
// nothing at all (not even a gradient box) when there's no image, so a
// service without one reads as an intentional text-only layout rather
// than something failed to load. Capped at a third of the tile's width
// via flex-basis so it scales instead of overflowing when it does render.
function ServiceImage({ imageUrl }: { imageUrl: string | null }) {
  if (!imageUrl) return null;
  return (
    <div
      style={{
        flex: "0 0 33%",
        maxWidth: "33%",
        aspectRatio: "1 / 1",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
  );
}

// The editable counterpart of ServiceImage above — same square tile,
// but with a pencil overlay (same EditPencilButton used for the
// profile's own avatar/banner) that opens the file picker, and a local
// object-URL preview so picking a file shows up immediately instead of
// only after Save. Unlike EditableImage.tsx (avatar/banner), this
// doesn't submit on selection — the file input stays named "image" and
// travels through with the rest of this same form's fields on the
// service's own Save button, since the image here is one field among
// several being edited together, not a standalone upload action.
//
// Remove works the same way — client-side only until Save, via a
// hidden "removeImage" input the server action checks. Picking a new
// file after clicking remove un-marks it (a fresh selection obviously
// means keep/replace, not clear); clicking remove after picking a file
// clears that pending selection too (both the preview state and the
// file input's own value), so Save can't end up submitting a file the
// UI just showed as removed.
function ServiceImageField({ currentImageUrl }: { currentImageUrl: string | null }) {
  const t = useTranslations("Services");
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const displayUrl = removed ? null : (previewUrl ?? currentImageUrl);

  // Revoke the previous object URL when a new file is picked or this
  // component unmounts — otherwise each selection leaks the blob URL
  // for the one it replaced.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <div
      style={{
        position: "relative",
        flex: "0 0 33%",
        maxWidth: "33%",
        aspectRatio: "1 / 1",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        background: displayUrl ? undefined : "linear-gradient(135deg, var(--bg-sunken), var(--accent-glow))",
      }}
    >
      {displayUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={displayUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}
      <input
        ref={inputRef}
        type="file"
        name="image"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            setPreviewUrl(URL.createObjectURL(file));
            setRemoved(false);
          }
        }}
      />
      {/* Only ever "1" when there's an existing (server-side) image to
          actually clear and nothing new was picked to replace it — a
          brand-new, not-yet-saved service has no image to remove in
          the first place. */}
      <input type="hidden" name="removeImage" value={removed && currentImageUrl ? "1" : ""} />
      <div style={{ position: "absolute", bottom: 6, right: 6, display: "flex", gap: 4 }}>
        <EditPencilButton label={t("imageLabel")} onClick={() => inputRef.current?.click()} />
        {displayUrl && (
          <RemoveImageButton
            label={t("removeImageLabel")}
            onClick={() => {
              setRemoved(true);
              setPreviewUrl(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
        )}
      </div>
    </div>
  );
}

function StatusBadge({ isActive, label }: { isActive: boolean; label: string }) {
  return (
    <span
      style={{
        font: "var(--text-caption)",
        padding: "2px 10px",
        borderRadius: "var(--radius-pill)",
        background: isActive ? "var(--accent-subtle)" : "var(--bg-sunken)",
        color: isActive ? "var(--accent-subtle-text)" : "var(--text-tertiary)",
      }}
    >
      {label}
    </span>
  );
}

function DeliveryFields({
  defaultType,
  defaultInfo,
  defaultPhoneNumber,
  locked,
  enabledTypes,
}: {
  defaultType: Service["delivery_type"];
  defaultInfo: string;
  defaultPhoneNumber: string;
  // Only the TYPE choice locks — a practitioner can still update the
  // meeting link/address text or their phone number after bookings
  // exist (contact info can legitimately change), per the request's own
  // explicit "still editable at any time: ...phone_number" list. Only
  // price/duration/deliveryType are structural enough to lock.
  locked: boolean;
  // Which delivery types this deployment offers (ENABLED_DELIVERY_TYPES,
  // resolved server-side and threaded down). A disabled type's option is absent
  // from the select — but a service that ALREADY has a now-disabled type still
  // shows its own option (defaultType), so editing it doesn't render oddly or
  // silently change the type. The server action enforces the same rule.
  enabledTypes: DeliveryType[];
}) {
  const t = useTranslations("Services");
  const [deliveryType, setDeliveryType] = useState<DeliveryType>(defaultType ?? "online");
  // Show an option when the type is offered, or when it's this service's own
  // current type (grandfathered so an existing service isn't broken). "online"
  // is always offered.
  const showOption = (type: DeliveryType) =>
    type === "online" || enabledTypes.includes(type) || defaultType === type;

  return (
    <>
      {locked ? (
        // A disabled select is excluded from form submission entirely
        // (browsers never include disabled controls in FormData) —
        // using only `disabled` here would silently drop deliveryType
        // from the submit and break saving ANY change to a locked
        // service, since it's a required field. So the visible select
        // is disabled (display-only, greyed out like durationMinutes/
        // price above) and a separate hidden input carries the real
        // value through to the server action instead.
        <label>
          {t("deliveryTypeLegend")}
          <select
            disabled
            value={deliveryType}
            className="form-field"
            style={{ display: "block", width: "100%", maxWidth: 220, background: "var(--bg-sunken)" }}
          >
            <option value="online">{t("deliveryTypeOnline")}</option>
            {showOption("in_person") && <option value="in_person">{t("deliveryTypeInPerson")}</option>}
            {showOption("phone") && <option value="phone">{t("deliveryTypePhone")}</option>}
          </select>
          <input type="hidden" name="deliveryType" value={deliveryType} />
        </label>
      ) : (
        <label>
          {t("deliveryTypeLegend")}
          {/* No width: "100%" here, unlike the text fields above — a
              select's content (Online/In-person/By phone) is short
              enough that stretching it to the full card width just
              leaves a wide empty box. Same intrinsic-sizing convention
              AvailabilitySection.tsx / AvailabilityExceptionsSection.tsx
              already use for their own <select> fields. Capped with
              maxWidth (not left fully auto) so it can't grow past a
              sensible size on very wide desktop cards, but still
              shrinks to fit narrow mobile viewports. */}
          <select
            name="deliveryType"
            value={deliveryType}
            onChange={(e) => setDeliveryType(e.target.value as DeliveryType)}
            className="form-field"
            style={{ display: "block", width: "100%", maxWidth: 220 }}
          >
            <option value="online">{t("deliveryTypeOnline")}</option>
            {showOption("in_person") && <option value="in_person">{t("deliveryTypeInPerson")}</option>}
            {showOption("phone") && <option value="phone">{t("deliveryTypePhone")}</option>}
          </select>
        </label>
      )}
      {deliveryType === "phone" ? (
        <label>
          {t("phoneNumberLabel")}
          <input name="phoneNumber" type="tel" required defaultValue={defaultPhoneNumber} maxLength={MAX_PHONE_LENGTH} className="form-field" style={{ width: "100%" }} />
        </label>
      ) : deliveryType === "in_person" ? (
        <label>
          {t("deliveryInfoLabelInPerson")}
          <input name="deliveryInfo" type="text" required defaultValue={defaultInfo} maxLength={MAX_DELIVERY_INFO_LENGTH} className="form-field" style={{ width: "100%" }} />
        </label>
      ) : (
        // online: no field at all — a per-booking meeting link will be
        // auto-generated (LiveKit) instead of practitioner-entered. See
        // services-actions.ts's parseServiceForm for the matching
        // server-side change (no longer required, and an existing
        // value from before this change is preserved, not overwritten).
        null
      )}
    </>
  );
}

// A fixed dropdown (30/45/60/75/90/105/120 minutes) — was a free
// numeric input. Same locked/unlocked disabled-select-plus-hidden-input
// pattern as DeliveryFields' own delivery-type select, for the same
// reason: a disabled control is dropped from form submission entirely,
// so a hidden input is what actually carries the real value through
// while the visible select just shows it, greyed out.
// The per-service "allow file exchange" toggle. Only rendered when the
// brand-level sessionDocuments flag is on (the parent decides that); the
// server action re-checks the flag regardless. Not a locked field — it
// only affects FUTURE bookings, since each snapshots the setting.
function DocumentsToggle({ defaultChecked }: { defaultChecked: boolean }) {
  const t = useTranslations("Services");
  return (
    <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-start" }}>
      <input type="checkbox" name="documentsEnabled" defaultChecked={defaultChecked} style={{ marginTop: 3, flexShrink: 0 }} />
      <span>
        <span style={{ display: "block" }}>{t("documentsLabel")}</span>
        <span style={{ display: "block", font: "var(--text-caption)", color: "var(--text-tertiary)" }}>{t("documentsHint")}</span>
      </span>
    </label>
  );
}

function DurationField({ defaultValue, locked }: { defaultValue: number; locked: boolean }) {
  const t = useTranslations("Services");
  const [duration, setDuration] = useState(defaultValue);
  // An existing service saved before this dropdown replaced the free
  // numeric input (or one with an off-grid value reached via a direct
  // API call) might not be one of the 7 fixed options — include it so
  // opening the edit form never silently rewrites a value the
  // practitioner didn't touch.
  const options: readonly number[] = (DURATION_OPTIONS as readonly number[]).includes(defaultValue)
    ? DURATION_OPTIONS
    : [...DURATION_OPTIONS, defaultValue].sort((a, b) => a - b);

  if (locked) {
    return (
      <label>
        {t("durationLabel")}
        <select
          disabled
          value={duration}
          className="form-field"
          style={{ display: "block", width: "100%", maxWidth: 220, background: "var(--bg-sunken)" }}
        >
          {options.map((minutes) => (
            <option key={minutes} value={minutes}>
              {t("durationOptionLabel", { minutes })}
            </option>
          ))}
        </select>
        <input type="hidden" name="durationMinutes" value={duration} />
      </label>
    );
  }

  return (
    <label>
      {t("durationLabel")}
      <select
        name="durationMinutes"
        value={duration}
        onChange={(e) => setDuration(Number(e.target.value))}
        required
        className="form-field"
        style={{ display: "block", width: "100%", maxWidth: 220 }}
      >
        {options.map((minutes) => (
          <option key={minutes} value={minutes}>
            {t("durationOptionLabel", { minutes })}
          </option>
        ))}
      </select>
    </label>
  );
}

const tileStyle = {
  display: "flex" as const,
  alignItems: "flex-start" as const,
  gap: "var(--space-4)",
  padding: "var(--space-4)",
  borderRadius: "var(--radius-lg)",
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
};

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

export type EarningsInfo = {
  // The practitioner's OWN effective commission rate (override ?? brand
  // default; 0 for a software_provider who keeps 100%) — resolved server-side
  // by the SAME function checkout uses, so the panel can't drift from what's
  // actually charged.
  commissionRate: number;
  providerName: string;
  processingFee: { minPct: number; maxPct: number; fixedCents: number };
  minPriceEuros: number;
  maxPriceEuros: number;
};

// The live "what you'll receive" breakdown, beneath the price, once a price is
// entered. Our commission is EXACT (computed on integer cents, identical to
// commissionCentsFor); the provider's fee is shown only as an APPROXIMATE range
// in a note — never folded into a single confident net figure. Zero commission
// (zero-commission brand or a software_provider) shows "the full amount", not a
// noisy "0% commission" line.
function EarningsBreakdown({ priceEuros, commissionRate, providerName, processingFee, minPriceEuros, maxPriceEuros }: { priceEuros: string } & EarningsInfo) {
  const t = useTranslations("Earnings");
  const locale = useLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const money = (cents: number, opts?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(intlLocale, { style: "currency", currency: "EUR", ...opts }).format(cents / 100);

  const euros = Number(priceEuros);
  if (!Number.isFinite(euros) || euros <= 0) return null; // appears once a price is entered

  const priceCents = Math.round(euros * 100);
  const commissionCents = Math.round(priceCents * commissionRate);
  const netCents = priceCents - commissionCents;
  const zero = commissionRate === 0;

  const feeVars = {
    provider: providerName,
    feeMin: String(processingFee.minPct),
    feeMax: String(processingFee.maxPct),
    feeFixed: money(processingFee.fixedCents),
  };
  const whole = { maximumFractionDigits: 0 } as const;

  const rowStyle = { display: "flex", justifyContent: "space-between", gap: "var(--space-3)" } as const;
  const label = { margin: 0, color: "var(--text-secondary)" } as const;
  const value = { margin: 0, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" } as const;
  const strongLabel = { ...label, color: "var(--text-primary)", fontWeight: 600 } as const;
  const strongValue = { ...value, color: "var(--text-primary)", fontWeight: 600 } as const;
  const note = { margin: 0, font: "var(--text-caption)", color: "var(--text-tertiary)" } as const;

  return (
    <div
      role="group"
      aria-label={t("heading")}
      style={{
        marginTop: "var(--space-2)",
        padding: "var(--space-3)",
        background: "var(--bg-sunken)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <p style={{ margin: 0, font: "var(--text-label)", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)" }}>
        {t("heading")}
      </p>
      <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)", font: "var(--text-body-sm)" }}>
        <div style={rowStyle}>
          <dt style={label}>{t("priceRow")}</dt>
          <dd style={value}>{money(priceCents)}</dd>
        </div>
        {zero ? (
          <div style={rowStyle}>
            <dt style={strongLabel}>{t("fullAmountRow")}</dt>
            <dd style={strongValue}>{money(priceCents)}</dd>
          </div>
        ) : (
          <>
            <div style={rowStyle}>
              <dt style={label}>{t("commissionRow", { rate: `${+(commissionRate * 100).toFixed(2)}` })}</dt>
              <dd style={value}>−{money(commissionCents)}</dd>
            </div>
            <div style={rowStyle}>
              <dt style={strongLabel}>{t("netRow")}</dt>
              <dd style={strongValue}>{money(netCents)}</dd>
            </div>
          </>
        )}
      </dl>
      <p style={note}>{zero ? t("processingNoteZero", feeVars) : t("processingNote", feeVars)}</p>
      <p style={note}>{t("taxNote")}</p>
      <p style={note}>{t("boundsNote", { min: money(minPriceEuros * 100, whole), max: money(maxPriceEuros * 100, whole) })}</p>
    </div>
  );
}

// The price input + hint + live earnings breakdown. The input is CONTROLLED
// (local state) so the breakdown recomputes as the number changes — the same
// local-state pattern DurationField/DeliveryFields already use.
function PriceField({ defaultValue, readOnly = false, earnings }: { defaultValue: string; readOnly?: boolean; earnings: EarningsInfo }) {
  const t = useTranslations("Services");
  const [priceEuros, setPriceEuros] = useState(defaultValue);
  return (
    <>
      <label>
        {t("priceLabel")}
        <input
          name="price"
          type="number"
          min={earnings.minPriceEuros}
          max={earnings.maxPriceEuros}
          step={0.01}
          required
          readOnly={readOnly}
          value={priceEuros}
          onChange={(e) => setPriceEuros(e.target.value)}
          className="form-field"
          style={{ width: "100%", background: readOnly ? "var(--bg-sunken)" : undefined }}
        />
        <span style={{ display: "block", font: "var(--text-caption)", color: "var(--text-tertiary)", marginTop: "var(--space-1)" }}>
          {t("priceHint", { min: earnings.minPriceEuros, max: earnings.maxPriceEuros })}
        </span>
      </label>
      <EarningsBreakdown priceEuros={priceEuros} {...earnings} />
    </>
  );
}

function ServiceRow({ service, enabledTypes, documentsFeatureEnabled, earnings }: { service: Service; enabledTypes: DeliveryType[]; documentsFeatureEnabled: boolean; earnings: EarningsInfo }) {
  const t = useTranslations("Services");
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateService, initialState);
  // Close the editor once a save succeeds — adjusted during render, not
  // via useEffect+setState, which this project's lint config flags
  // (react-hooks/set-state-in-effect) for the cascading-render risk.
  // Same pattern as EditableAbout.tsx etc. in components/practitioner-profile/.
  const [prevState, setPrevState] = useState(state);
  // Bumped every time the action returns (error or success) and used as
  // the <form>'s own key below — forces a remount of the form and its
  // DurationField/DeliveryFields children so a corrected defaultValue/
  // defaultType actually takes effect after a rejected submission. See
  // ServiceFormState's own comment (services-actions.ts) for why this is
  // needed at all.
  const [formKey, setFormKey] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    setFormKey((k) => k + 1);
    if (state?.success && isEditing) setIsEditing(false);
  }

  const locked = service.upcoming_booking_count > 0;
  const deleteDialogRef = useRef<ConfirmDialogHandle>(null);
  const hideDialogRef = useRef<ConfirmDialogHandle>(null);
  const deleteBlockedDialogRef = useRef<ConfirmDialogHandle>(null);

  if (isEditing) {
    return (
      <li style={{ marginBottom: "var(--space-4)" }}>
        <div style={tileStyle}>
          <form
            key={formKey}
            action={formAction}
            style={{ display: "flex", gap: "var(--space-4)", flex: 1, minWidth: 0 }}
          >
            {/* Inside the form (not a sibling like the read-only
                ServiceImage) so its file input travels through with
                the rest of these fields on Save — see this
                component's own comment for why it doesn't upload on
                selection the way avatar/banner does. */}
            <ServiceImageField currentImageUrl={service.image_url} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <input type="hidden" name="serviceId" value={service.id} />
            <label>
              {t("nameLabel")}
              <input name="name" type="text" required defaultValue={state?.values?.name ?? service.name} maxLength={MAX_NAME_LENGTH} className="form-field" style={{ width: "100%" }} />
            </label>
            <label>
              {t("descriptionLabel")}
              <textarea name="description" rows={2} defaultValue={state?.values?.description ?? service.description ?? ""} maxLength={MAX_DESCRIPTION_LENGTH} className="form-field" style={{ width: "100%" }} />
            </label>
            {locked && (
              // Practitioner-facing only — this whole page is already
              // scoped to the owning practitioner, never rendered for a
              // client. readOnly (not disabled) on the two inputs below
              // for the same reason DeliveryFields uses a hidden input
              // instead of a disabled radio: a disabled control is
              // dropped from form submission entirely, which would
              // break saving name/description/phone_number changes too.
              <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
                {t("structuralFieldsLockedNote", { count: service.upcoming_booking_count })}
              </p>
            )}
            <DurationField
              defaultValue={state?.values?.durationMinutes ? Number(state.values.durationMinutes) : service.duration_minutes}
              locked={locked}
            />
            <PriceField
              defaultValue={state?.values?.price ?? (service.price_cents / 100).toFixed(2)}
              readOnly={locked}
              earnings={earnings}
            />
            <DeliveryFields
              defaultType={(state?.values?.deliveryType as DeliveryType) || service.delivery_type}
              defaultInfo={state?.values?.deliveryInfo ?? (service.delivery_info ?? "")}
              defaultPhoneNumber={state?.values?.phoneNumber ?? (service.phone_number ?? "")}
              locked={locked}
              enabledTypes={enabledTypes}
            />
            {documentsFeatureEnabled && (
              <DocumentsToggle defaultChecked={state?.values ? state.values.documentsEnabled === "on" : service.documents_enabled} />
            )}
            {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Button type="submit" disabled={pending}>
                {pending ? t("saveButtonPending") : t("saveButton")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>
                {t("cancelButton")}
              </Button>
            </div>
            </div>
          </form>
        </div>
      </li>
    );
  }

  return (
    <li style={{ marginBottom: "var(--space-4)" }}>
      <div style={tileStyle}>
        <ServiceImage imageUrl={service.image_url} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <strong>{service.name}</strong>
            <StatusBadge isActive={service.is_active} label={service.is_active ? t("activeStatus") : t("hiddenStatus")} />
          </div>
          <p style={{ margin: "var(--space-1) 0", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
            {t("durationOptionLabel", { minutes: service.duration_minutes })} · {formatPrice(service.price_cents, service.currency)}
          </p>
          {service.description && (
            <p style={{ margin: "var(--space-1) 0", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>{service.description}</p>
          )}
          {service.delivery_type === "phone" ? (
            service.phone_number ? (
              <p style={{ margin: "var(--space-1) 0", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
                <strong>{t("deliveryTypePhone")}: </strong>
                {service.phone_number}
              </p>
            ) : (
              <p
                style={{
                  display: "inline-block",
                  margin: "var(--space-1) 0",
                  padding: "2px 10px",
                  borderRadius: "var(--radius-pill)",
                  background: "var(--accent-subtle)",
                  color: "var(--accent-subtle-text)",
                  font: "var(--text-caption)",
                }}
              >
                {t("deliveryInfoMissingNudge")}
              </p>
            )
          ) : service.delivery_type === "online" ? (
            // No nudge here even when delivery_info is empty — that's
            // the new normal for online (see DeliveryFields' own
            // comment), not a gap the practitioner can currently fix
            // through this form. Still shows a stored value from
            // before that change, if one exists.
            service.delivery_info && (
              <p style={{ margin: "var(--space-1) 0", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
                <strong>{t("deliveryTypeOnline")}: </strong>
                <LinkifiedText text={service.delivery_info} />
              </p>
            )
          ) : service.delivery_info ? (
            <p style={{ margin: "var(--space-1) 0", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
              <strong>{t("deliveryTypeInPerson")}: </strong>
              <LinkifiedText text={service.delivery_info} />
            </p>
          ) : (
            <p
              style={{
                display: "inline-block",
                margin: "var(--space-1) 0",
                padding: "2px 10px",
                borderRadius: "var(--radius-pill)",
                background: "var(--accent-subtle)",
                color: "var(--accent-subtle-text)",
                font: "var(--text-caption)",
              }}
            >
              {t("deliveryInfoMissingNudge")}
            </p>
          )}
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
            <Button type="button" variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
              {t("editButton")}
            </Button>
            {/* Hiding a service with upcoming bookings still goes ahead
                (it only stops NEW bookings — existing ones aren't
                touched), but is confirmed first, not instant, since it's
                otherwise easy to click without realizing bookings are
                unaffected. Un-hiding, and hiding a service with no
                upcoming bookings, stay a single click — nothing there
                needs a warning. */}
            {service.is_active && locked ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => hideDialogRef.current?.open()}>
                {t("hideButton")}
              </Button>
            ) : (
              <form action={setServiceActive.bind(null, service.id, !service.is_active)}>
                <Button type="submit" variant="secondary" size="sm">{service.is_active ? t("hideButton") : t("showButton")}</Button>
              </form>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => (locked ? deleteBlockedDialogRef.current?.open() : deleteDialogRef.current?.open())}
            >
              {t("deleteButton")}
            </Button>
          </div>
        </div>
      </div>
      <ConfirmDialog
        ref={deleteDialogRef}
        message={t("deleteConfirm", { name: service.name })}
        confirmLabel={t("deleteDialogConfirm")}
        cancelLabel={t("deleteDialogDismiss")}
        action={deleteService.bind(null, service.id)}
      />
      <ConfirmDialog
        ref={hideDialogRef}
        title={t("hideDialogTitle")}
        message={t("hideDialogMessage", { count: service.upcoming_booking_count })}
        confirmLabel={t("hideDialogConfirm")}
        cancelLabel={t("hideDialogCancel")}
        action={setServiceActive.bind(null, service.id, false)}
      />
      {/* bookings.service_id cascades on delete (see services-actions.ts's
          own comment) — a locked service is never actually deletable,
          this dialog explains why and offers hiding as the real path
          instead of a dead-end "delete failed" error. */}
      <ConfirmDialog
        ref={deleteBlockedDialogRef}
        title={t("deleteBlockedTitle")}
        message={t("deleteBlockedMessage", { count: service.upcoming_booking_count })}
        confirmLabel={t("deleteBlockedConfirm")}
        cancelLabel={t("deleteBlockedDismiss")}
        action={setServiceActive.bind(null, service.id, false)}
      />
    </li>
  );
}

export function ServicesSection({ services, enabledTypes, documentsFeatureEnabled, commissionRate, providerName, processingFee, minPriceEuros, maxPriceEuros }: { services: Service[]; enabledTypes: DeliveryType[]; documentsFeatureEnabled: boolean } & EarningsInfo) {
  // Bundle the earnings inputs once and thread them to every price field.
  const earnings: EarningsInfo = { commissionRate, providerName, processingFee, minPriceEuros, maxPriceEuros };
  const t = useTranslations("Services");
  const [isAdding, setIsAdding] = useState(false);
  const [state, formAction, pending] = useActionState(createService, initialState);
  // Same render-time-adjustment pattern as ServiceRow above, including
  // the formKey bump for the same form-reset-on-error reason.
  const [prevState, setPrevState] = useState(state);
  const [formKey, setFormKey] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    setFormKey((k) => k + 1);
    if (state?.success && isAdding) setIsAdding(false);
  }

  return (
    <section style={{ marginTop: "var(--space-8)" }}>
      <h2 style={{ font: "var(--text-heading-md)", margin: "0 0 var(--space-6)" }}>{t("title")}</h2>
      {services.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, marginBottom: "var(--space-4)" }}>
          {services.map((service) => (
            <ServiceRow key={service.id} service={service} enabledTypes={enabledTypes} documentsFeatureEnabled={documentsFeatureEnabled} earnings={earnings} />
          ))}
        </ul>
      ) : (
        <p style={{ color: "var(--text-tertiary)" }}>{t("noServicesYet")}</p>
      )}

      {!isAdding ? (
        <Button type="button" variant="secondary" onClick={() => setIsAdding(true)}>
          {t("addAnotherService")}
        </Button>
      ) : (
        <div style={tileStyle}>
          <form
            key={formKey}
            action={formAction}
            style={{ display: "flex", gap: "var(--space-4)", flex: 1, minWidth: 0 }}
          >
            <ServiceImageField currentImageUrl={null} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <label>
              {t("nameLabel")}
              <input name="name" type="text" required defaultValue={state?.values?.name ?? ""} maxLength={MAX_NAME_LENGTH} className="form-field" style={{ width: "100%" }} />
            </label>
            <label>
              {t("descriptionLabel")}
              <textarea name="description" rows={2} defaultValue={state?.values?.description ?? ""} maxLength={MAX_DESCRIPTION_LENGTH} className="form-field" style={{ width: "100%" }} />
            </label>
            <DurationField
              defaultValue={state?.values?.durationMinutes ? Number(state.values.durationMinutes) : DEFAULT_DURATION_MINUTES}
              locked={false}
            />
            <PriceField defaultValue={state?.values?.price ?? ""} earnings={earnings} />
            <DeliveryFields
              defaultType={(state?.values?.deliveryType as DeliveryType) || null}
              defaultInfo={state?.values?.deliveryInfo ?? ""}
              defaultPhoneNumber={state?.values?.phoneNumber ?? ""}
              locked={false}
              enabledTypes={enabledTypes}
            />
            {documentsFeatureEnabled && (
              <DocumentsToggle defaultChecked={state?.values?.documentsEnabled === "on"} />
            )}
            {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Button type="submit" disabled={pending}>
                {pending ? t("addButtonPending") : t("addButton")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIsAdding(false)}>
                {t("cancelButton")}
              </Button>
            </div>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
