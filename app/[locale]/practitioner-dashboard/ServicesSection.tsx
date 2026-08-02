"use client";

import { Fragment, useActionState, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/ConfirmDialog";
import {
  createService,
  updateService,
  setServiceActive,
  deleteService,
  type ServiceFormState,
} from "./services-actions";
import { splitTextAndUrls } from "@/lib/linkify";
import { SHOW_PHONE_DELIVERY_OPTION } from "@/lib/serviceDelivery";

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
// (components/practitioner-profile/PractitionerProfileView.tsx) — a
// gradient placeholder until an image is uploaded, capped at a third of
// the tile's width via flex-basis so it scales instead of overflowing.
function ServiceImage({ imageUrl }: { imageUrl: string | null }) {
  return (
    <div
      style={{
        flex: "0 0 33%",
        maxWidth: "33%",
        aspectRatio: "1 / 1",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        background: imageUrl ? undefined : "linear-gradient(135deg, var(--bg-sunken), var(--accent-glow))",
      }}
    >
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}
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
}) {
  const t = useTranslations("Services");
  const [deliveryType, setDeliveryType] = useState<DeliveryType>(defaultType ?? "online");
  const deliveryTypeLabel =
    deliveryType === "online" ? t("deliveryTypeOnline") : deliveryType === "in_person" ? t("deliveryTypeInPerson") : t("deliveryTypePhone");

  return (
    <>
      {locked ? (
        // A disabled radio input is excluded from form submission
        // entirely (browsers never include disabled controls in
        // FormData) — using `disabled` here would silently drop
        // deliveryType from the submit and break saving ANY change to a
        // locked service, since it's a required field. A hidden input
        // guarantees the current value is still submitted; the visible
        // radios only render when actually editable.
        <div>
          <span style={{ display: "block", font: "var(--text-label)", marginBottom: "var(--space-1)" }}>{t("deliveryTypeLegend")}</span>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>{deliveryTypeLabel}</p>
          <input type="hidden" name="deliveryType" value={deliveryType} />
        </div>
      ) : (
        <fieldset style={{ border: "none", padding: 0 }}>
          <legend style={{ padding: 0 }}>{t("deliveryTypeLegend")}</legend>
          <label style={{ display: "block" }}>
            <input
              type="radio"
              name="deliveryType"
              value="online"
              checked={deliveryType === "online"}
              onChange={() => setDeliveryType("online")}
            />{" "}
            {t("deliveryTypeOnline")}
          </label>
          <label style={{ display: "block" }}>
            <input
              type="radio"
              name="deliveryType"
              value="in_person"
              checked={deliveryType === "in_person"}
              onChange={() => setDeliveryType("in_person")}
            />{" "}
            {t("deliveryTypeInPerson")}
          </label>
          {SHOW_PHONE_DELIVERY_OPTION && (
            <label style={{ display: "block" }}>
              <input
                type="radio"
                name="deliveryType"
                value="phone"
                checked={deliveryType === "phone"}
                onChange={() => setDeliveryType("phone")}
              />{" "}
              {t("deliveryTypePhone")}
            </label>
          )}
        </fieldset>
      )}
      {deliveryType === "phone" ? (
        <label>
          {t("phoneNumberLabel")}
          <input name="phoneNumber" type="tel" required defaultValue={defaultPhoneNumber} maxLength={MAX_PHONE_LENGTH} className="form-field" style={{ width: "100%" }} />
        </label>
      ) : (
        <label>
          {deliveryType === "online" ? t("deliveryInfoLabelOnline") : t("deliveryInfoLabelInPerson")}
          <input name="deliveryInfo" type="text" required defaultValue={defaultInfo} maxLength={MAX_DELIVERY_INFO_LENGTH} className="form-field" style={{ width: "100%" }} />
        </label>
      )}
    </>
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

function ServiceRow({ service }: { service: Service }) {
  const t = useTranslations("Services");
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateService, initialState);
  // Close the editor once a save succeeds — adjusted during render, not
  // via useEffect+setState, which this project's lint config flags
  // (react-hooks/set-state-in-effect) for the cascading-render risk.
  // Same pattern as EditableAbout.tsx etc. in components/practitioner-profile/.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success && isEditing) setIsEditing(false);
  }

  const locked = service.upcoming_booking_count > 0;
  const deleteDialogRef = useRef<ConfirmDialogHandle>(null);

  if (isEditing) {
    return (
      <li style={{ marginBottom: "var(--space-4)" }}>
        <div style={tileStyle}>
          <ServiceImage imageUrl={service.image_url} />
          <form
            action={formAction}
            style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
          >
            <input type="hidden" name="serviceId" value={service.id} />
            <label>
              {t("nameLabel")}
              <input name="name" type="text" required defaultValue={service.name} maxLength={MAX_NAME_LENGTH} className="form-field" style={{ width: "100%" }} />
            </label>
            <label>
              {t("descriptionLabel")}
              <textarea name="description" rows={2} defaultValue={service.description ?? ""} maxLength={MAX_DESCRIPTION_LENGTH} className="form-field" style={{ width: "100%" }} />
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
            <label>
              {t("durationLabel")}
              <input
                name="durationMinutes"
                type="number"
                min={15}
                max={240}
                step={15}
                required
                readOnly={locked}
                defaultValue={service.duration_minutes}
                className="form-field"
                style={{ width: "100%", background: locked ? "var(--bg-sunken)" : undefined }}
              />
            </label>
            <label>
              {t("priceLabel")}
              <input
                name="price"
                type="number"
                min={0}
                step={0.01}
                required
                readOnly={locked}
                defaultValue={(service.price_cents / 100).toFixed(2)}
                className="form-field"
                style={{ width: "100%", background: locked ? "var(--bg-sunken)" : undefined }}
              />
            </label>
            <DeliveryFields
              defaultType={service.delivery_type}
              defaultInfo={service.delivery_info ?? ""}
              defaultPhoneNumber={service.phone_number ?? ""}
              locked={locked}
            />
            <label>
              {t("imageLabel")}
              <input type="file" name="image" accept="image/png,image/jpeg,image/webp" className="form-field" style={{ width: "100%" }} />
            </label>
            {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Button type="submit" disabled={pending}>
                {pending ? t("saveButtonPending") : t("saveButton")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>
                {t("cancelButton")}
              </Button>
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
            {service.duration_minutes} min · {formatPrice(service.price_cents, service.currency)}
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
          ) : service.delivery_info ? (
            <p style={{ margin: "var(--space-1) 0", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
              {service.delivery_type && (
                <strong>
                  {service.delivery_type === "online" ? t("deliveryTypeOnline") : t("deliveryTypeInPerson")}:{" "}
                </strong>
              )}
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
            <form action={setServiceActive.bind(null, service.id, !service.is_active)}>
              <Button type="submit" variant="secondary" size="sm">{service.is_active ? t("hideButton") : t("showButton")}</Button>
            </form>
            <Button type="button" variant="secondary" size="sm" onClick={() => deleteDialogRef.current?.open()}>
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
    </li>
  );
}

export function ServicesSection({ services }: { services: Service[] }) {
  const t = useTranslations("Services");
  const [isAdding, setIsAdding] = useState(false);
  const [state, formAction, pending] = useActionState(createService, initialState);
  // Same render-time-adjustment pattern as ServiceRow above.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success && isAdding) setIsAdding(false);
  }

  return (
    <section style={{ marginTop: "var(--space-8)" }}>
      <h2 style={{ font: "var(--text-heading-md)", margin: "0 0 var(--space-6)" }}>{t("title")}</h2>
      {services.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, marginBottom: "var(--space-4)" }}>
          {services.map((service) => (
            <ServiceRow key={service.id} service={service} />
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
            action={formAction}
            style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
          >
            <label>
              {t("nameLabel")}
              <input name="name" type="text" required maxLength={MAX_NAME_LENGTH} className="form-field" style={{ width: "100%" }} />
            </label>
            <label>
              {t("descriptionLabel")}
              <textarea name="description" rows={2} maxLength={MAX_DESCRIPTION_LENGTH} className="form-field" style={{ width: "100%" }} />
            </label>
            <label>
              {t("durationLabel")}
              <input name="durationMinutes" type="number" min={15} max={240} step={15} required className="form-field" style={{ width: "100%" }} />
            </label>
            <label>
              {t("priceLabel")}
              <input name="price" type="number" min={0} step={0.01} required className="form-field" style={{ width: "100%" }} />
            </label>
            <DeliveryFields defaultType={null} defaultInfo="" defaultPhoneNumber="" locked={false} />
            <label>
              {t("imageLabel")}
              <input type="file" name="image" accept="image/png,image/jpeg,image/webp" className="form-field" style={{ width: "100%" }} />
            </label>
            {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Button type="submit" disabled={pending}>
                {pending ? t("addButtonPending") : t("addButton")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIsAdding(false)}>
                {t("cancelButton")}
              </Button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
