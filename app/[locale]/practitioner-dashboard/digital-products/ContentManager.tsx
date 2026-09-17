"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import {
  saveContentItem,
  uploadContentPdf,
  setContentActive,
  deleteContentItem,
  type ContentActionState,
} from "../content-actions";

export type ManagedContentItem = {
  id: string;
  type: "video_youtube" | "pdf";
  title: string;
  description: string;
  priceEuros: string;
  youtubeVideoId: string;
  hasPdf: boolean;
  isActive: boolean;
};

const card = { border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", background: "var(--bg-surface)", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" } as const;
const field = { display: "flex", flexDirection: "column", gap: 4 } as const;
const labelStyle = { font: "var(--text-label)", color: "var(--text-secondary)" } as const;
const inputCls = "form-field";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant="primary" size="sm" disabled={pending}>{label}</Button>;
}

// Warning practitioners actually read before choosing to sell video this way.
function UnlistedWarning() {
  const t = useTranslations("DigitalProducts");
  return (
    <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--color-warning)", background: "color-mix(in oklab, var(--color-warning) 10%, transparent)", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-md)" }}>
      {t("unlistedWarning")}
    </p>
  );
}

function TypeFields({ t, type, defaultYoutube }: { t: (k: string) => string; type: "video_youtube" | "pdf"; defaultYoutube?: string }) {
  if (type !== "video_youtube") return null;
  return (
    <label style={field}>
      <span style={labelStyle}>{t("youtubeLabel")}</span>
      <input className={inputCls} name="youtube" defaultValue={defaultYoutube} placeholder="https://youtu.be/…" />
      <UnlistedWarning />
    </label>
  );
}

function NewProductForm() {
  const t = useTranslations("DigitalProducts");
  const [type, setType] = useState<"video_youtube" | "pdf">("video_youtube");
  const [state, action] = useActionState<ContentActionState, FormData>((p, fd) => saveContentItem(p, fd), null);

  return (
    <form action={action} style={{ ...card, borderStyle: "dashed" }}>
      <strong style={{ font: "var(--text-heading-sm)" }}>{t("newProduct")}</strong>
      <input type="hidden" name="type" value={type} />
      <div style={{ display: "flex", gap: "var(--space-3)" }}>
        <label><input type="radio" name="typeChoice" checked={type === "video_youtube"} onChange={() => setType("video_youtube")} /> {t("typeVideo")}</label>
        <label><input type="radio" name="typeChoice" checked={type === "pdf"} onChange={() => setType("pdf")} /> {t("typePdf")}</label>
      </div>
      <label style={field}><span style={labelStyle}>{t("titleLabel")}</span><input className={inputCls} name="title" required /></label>
      <label style={field}><span style={labelStyle}>{t("descLabel")}</span><textarea className={inputCls} name="description" rows={2} /></label>
      <label style={field}><span style={labelStyle}>{t("priceLabel")}</span><input className={inputCls} name="price" type="number" min="1" max="5000" step="0.01" required /></label>
      <TypeFields t={t} type={type} />
      {type === "pdf" && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>{t("pdfMissing")} — {t("uploadPdf")} ↓</p>}
      {state?.error && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{state.error}</p>}
      <SubmitButton label={t("create")} />
    </form>
  );
}

function ItemRow({ item }: { item: ManagedContentItem }) {
  const t = useTranslations("DigitalProducts");
  const [saveState, saveAction] = useActionState<ContentActionState, FormData>((p, fd) => saveContentItem(p, fd), null);
  const [uploadState, uploadAction] = useActionState<ContentActionState, FormData>((p, fd) => uploadContentPdf(p, fd), null);

  return (
    <div style={{ ...card, opacity: item.isActive ? 1 : 0.6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
        <span style={{ font: "var(--text-caption)", color: "var(--text-tertiary)" }}>
          {item.type === "video_youtube" ? t("typeVideo") : t("typePdf")}
          {!item.isActive && ` · ${t("inactiveBadge")}`}
        </span>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <form action={async () => { await setContentActive(item.id, !item.isActive); }}>
            <button type="submit" style={{ background: "none", border: "none", cursor: "pointer", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{item.isActive ? t("hide") : t("show")}</button>
          </form>
          <form action={async () => { await deleteContentItem(item.id); }}>
            <button type="submit" style={{ background: "none", border: "none", cursor: "pointer", font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{t("delete")}</button>
          </form>
        </div>
      </div>

      {/* Edit metadata (+ the video id for a video item). */}
      <form action={saveAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="type" value={item.type} />
        <label style={field}><span style={labelStyle}>{t("titleLabel")}</span><input className={inputCls} name="title" defaultValue={item.title} required /></label>
        <label style={field}><span style={labelStyle}>{t("descLabel")}</span><textarea className={inputCls} name="description" rows={2} defaultValue={item.description} /></label>
        <label style={field}><span style={labelStyle}>{t("priceLabel")}</span><input className={inputCls} name="price" type="number" min="1" max="5000" step="0.01" defaultValue={item.priceEuros} required /></label>
        <TypeFields t={t} type={item.type} defaultYoutube={item.youtubeVideoId} />
        {saveState?.error && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{saveState.error}</p>}
        {saveState?.success && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--color-success)" }}>{t("saved")}</p>}
        <SubmitButton label={t("save")} />
      </form>

      {/* PDF upload (pdf items only). */}
      {item.type === "pdf" && (
        <form action={uploadAction} style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-3)" }}>
          <input type="hidden" name="id" value={item.id} />
          <span style={{ font: "var(--text-body-sm)", color: item.hasPdf ? "var(--color-success)" : "var(--text-tertiary)" }}>{item.hasPdf ? t("pdfReady") : t("pdfMissing")}</span>
          <input className={inputCls} type="file" name="file" accept="application/pdf" required />
          {uploadState?.error && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{uploadState.error}</p>}
          {uploadState?.success && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--color-success)" }}>{t("saved")}</p>}
          <SubmitButton label={item.hasPdf ? t("replacePdf") : t("uploadPdf")} />
        </form>
      )}
    </div>
  );
}

export function ContentManager({ items }: { items: ManagedContentItem[] }) {
  const t = useTranslations("DigitalProducts");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <NewProductForm />
      {items.length === 0 ? (
        <p style={{ font: "var(--text-body-md)", color: "var(--text-tertiary)" }}>{t("manageEmpty")}</p>
      ) : (
        items.map((item) => <ItemRow key={item.id} item={item} />)
      )}
    </div>
  );
}
