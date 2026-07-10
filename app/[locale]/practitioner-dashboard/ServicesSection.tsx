"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createService,
  updateService,
  setServiceActive,
  deleteService,
  type ServiceFormState,
} from "./services-actions";

type Service = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number;
  currency: string;
  is_active: boolean;
};

const initialState: ServiceFormState = null;

function formatPrice(priceCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(priceCents / 100);
}

function ServiceRow({ service }: { service: Service }) {
  const t = useTranslations("Services");
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateService, initialState);

  if (isEditing) {
    return (
      <li style={{ marginBottom: "1rem", border: "1px solid #ddd", padding: "0.75rem" }}>
        <form
          action={formAction}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          <input type="hidden" name="serviceId" value={service.id} />
          <label>
            {t("nameLabel")}
            <input name="name" type="text" required defaultValue={service.name} />
          </label>
          <label>
            {t("descriptionLabel")}
            <textarea name="description" rows={2} defaultValue={service.description ?? ""} />
          </label>
          <label>
            {t("durationLabel")}
            <input
              name="durationMinutes"
              type="number"
              min={15}
              max={240}
              step={15}
              required
              defaultValue={service.duration_minutes}
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
              defaultValue={(service.price_cents / 100).toFixed(2)}
            />
          </label>
          {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
          <div>
            <button type="submit" disabled={pending}>
              {pending ? t("saveButtonPending") : t("saveButton")}
            </button>{" "}
            <button type="button" onClick={() => setIsEditing(false)}>
              {t("cancelButton")}
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li style={{ marginBottom: "1rem" }}>
      <strong>{service.name}</strong> — {service.duration_minutes} min —{" "}
      {formatPrice(service.price_cents, service.currency)}{" "}
      <span style={{ color: service.is_active ? "green" : "#999" }}>
        {service.is_active ? t("activeStatus") : t("hiddenStatus")}
      </span>
      {service.description && <p style={{ margin: "0.25rem 0" }}>{service.description}</p>}
      <button type="button" onClick={() => setIsEditing(true)}>
        {t("editButton")}
      </button>{" "}
      <form action={setServiceActive.bind(null, service.id, !service.is_active)} style={{ display: "inline" }}>
        <button type="submit">{service.is_active ? t("hideButton") : t("showButton")}</button>
      </form>{" "}
      <form
        action={deleteService.bind(null, service.id)}
        style={{ display: "inline" }}
        onSubmit={(e) => {
          if (!confirm(t("deleteConfirm", { name: service.name }))) {
            e.preventDefault();
          }
        }}
      >
        <button type="submit">{t("deleteButton")}</button>
      </form>
    </li>
  );
}

export function ServicesSection({ services }: { services: Service[] }) {
  const t = useTranslations("Services");
  const [state, formAction, pending] = useActionState(createService, initialState);

  return (
    <section style={{ marginTop: "2rem", maxWidth: 400 }}>
      <h2>{t("title")}</h2>
      {services.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {services.map((service) => (
            <ServiceRow key={service.id} service={service} />
          ))}
        </ul>
      ) : (
        <p style={{ color: "#666" }}>{t("noServicesYet")}</p>
      )}

      <h3>{t("addNewTitle")}</h3>
      <form
        action={formAction}
        style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
      >
        <label>
          {t("nameLabel")}
          <input name="name" type="text" required />
        </label>
        <label>
          {t("descriptionLabel")}
          <textarea name="description" rows={2} />
        </label>
        <label>
          {t("durationLabel")}
          <input name="durationMinutes" type="number" min={15} max={240} step={15} required />
        </label>
        <label>
          {t("priceLabel")}
          <input name="price" type="number" min={0} step={0.01} required />
        </label>
        {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
        {state?.success && <p style={{ color: "green" }}>{t("addedMessage")}</p>}
        <button type="submit" disabled={pending}>
          {pending ? t("addButtonPending") : t("addButton")}
        </button>
      </form>
    </section>
  );
}
