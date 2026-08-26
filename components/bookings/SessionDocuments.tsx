"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { FileText, Download, Upload, Trash2 } from "lucide-react";
import {
  uploadSessionDocument,
  removeSessionDocument,
  getSessionDocumentUrl,
  type DocumentActionState,
} from "@/app/[locale]/bookings/session-documents-actions";
import { DOCUMENT_ACCEPT_ATTR } from "@/lib/documents/config";
import type { BookingPerspective } from "./BookingsList";

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

// The current-file metadata for one slot, or null when the slot is empty
// (or was purged by retention). storage_path is never sent to the client
// — a download is minted on demand as a short-lived signed URL.
export type SessionDocumentSlot = {
  fileName: string;
  byteSize: number;
  uploadedAt: string;
} | null;

function formatBytes(bytes: number, locale: string): string {
  const nf = (max: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: max });
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${nf(0).format(kb)} KB`;
  return `${nf(1).format(kb / 1024)} MB`;
}

const rowStyle = { display: "flex", gap: "var(--space-2)", alignItems: "flex-start" } as const;
const metaStyle = { margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)", wordBreak: "break-word" } as const;
const subMetaStyle = { margin: "2px 0 0", font: "var(--text-label)", color: "var(--text-tertiary)" } as const;
const iconLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  background: "none",
  border: "none",
  padding: 0,
  font: "var(--text-body-sm)",
  color: "var(--accent)",
  cursor: "pointer",
} as const;

// One document slot per side of a booking. The caller's own side is
// editable (upload / replace / remove); the counterparty's is read-only
// with a download. "Last changed" is shown on both so a party can tell a
// document moved under them after they'd read it.
export function SessionDocuments({
  bookingId,
  perspective,
  clientDocument,
  practitionerDocument,
  timezone,
}: {
  bookingId: string;
  perspective: BookingPerspective;
  clientDocument: SessionDocumentSlot;
  practitionerDocument: SessionDocumentSlot;
  timezone: string;
}) {
  const t = useTranslations("SessionDocuments");
  const locale = useLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const changedFormatter = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  const yourSide = perspective === "client" ? "client" : "practitioner";
  const theirSide = perspective === "client" ? "practitioner" : "client";
  const yours = perspective === "client" ? clientDocument : practitionerDocument;
  const theirs = perspective === "client" ? practitionerDocument : clientDocument;

  const lastChanged = (slot: NonNullable<SessionDocumentSlot>) =>
    t("lastChanged", { date: changedFormatter.format(new Date(slot.uploadedAt)) });

  return (
    <>
      <p
        style={{
          margin: "var(--space-3) 0 var(--space-1)",
          font: "var(--text-label)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--text-tertiary)",
        }}
      >
        {t("sectionHeading")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <YourSlot
          bookingId={bookingId}
          side={yourSide}
          slot={yours}
          formatSize={(n) => formatBytes(n, intlLocale)}
          lastChanged={lastChanged}
        />
        <TheirSlot
          bookingId={bookingId}
          side={theirSide}
          slot={theirs}
          formatSize={(n) => formatBytes(n, intlLocale)}
          lastChanged={lastChanged}
        />
      </div>
    </>
  );
}

function YourSlot({
  bookingId,
  side,
  slot,
  formatSize,
  lastChanged,
}: {
  bookingId: string;
  side: "client" | "practitioner";
  slot: SessionDocumentSlot;
  formatSize: (n: number) => string;
  lastChanged: (slot: NonNullable<SessionDocumentSlot>) => string;
}) {
  const t = useTranslations("SessionDocuments");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [uploadState, uploadAction, uploading] = useActionState<DocumentActionState, FormData>(uploadSessionDocument, null);
  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  function onRemove() {
    setRemoveError(null);
    const fd = new FormData();
    fd.set("bookingId", bookingId);
    fd.set("side", side);
    startRemove(async () => {
      const result = await removeSessionDocument(null, fd);
      if (result?.error) setRemoveError(result.error);
    });
  }

  return (
    <div>
      <p style={{ ...subMetaStyle, color: "var(--text-secondary)", fontWeight: 600 }}>{t("yourDocument")}</p>

      {slot && (
        <div style={{ ...rowStyle, marginTop: "var(--space-1)" }}>
          <FileText size={18} aria-hidden style={{ color: "var(--text-tertiary)", flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <p style={metaStyle}>
              {slot.fileName} · {formatSize(slot.byteSize)}
            </p>
            <p style={subMetaStyle}>{lastChanged(slot)}</p>
          </div>
        </div>
      )}

      {/* Native <input type=file> in a form wired to the upload action.
          The submit button doubles as "Replace" when a file already
          exists — one slot, so an upload always overwrites. */}
      <form ref={formRef} action={uploadAction} style={{ marginTop: "var(--space-2)" }}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <input type="hidden" name="side" value={side} />
        <input
          ref={fileInputRef}
          type="file"
          name="file"
          accept={DOCUMENT_ACCEPT_ATTR}
          required
          onChange={() => formRef.current?.requestSubmit()}
          disabled={uploading}
          aria-label={slot ? t("replaceAria") : t("uploadAria")}
          style={{ display: "none" }}
        />
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="focus-ring"
            disabled={uploading || removing}
            onClick={() => fileInputRef.current?.click()}
            style={{ ...iconLinkStyle, opacity: uploading ? 0.6 : 1 }}
          >
            <Upload size={16} aria-hidden />
            {uploading ? t("uploading") : slot ? t("replace") : t("upload")}
          </button>
          {slot && (
            <button
              type="button"
              className="focus-ring"
              disabled={uploading || removing}
              onClick={onRemove}
              style={{ ...iconLinkStyle, color: "var(--text-tertiary)", opacity: removing ? 0.6 : 1 }}
            >
              <Trash2 size={16} aria-hidden />
              {removing ? t("removing") : t("remove")}
            </button>
          )}
        </div>
        <p style={{ ...subMetaStyle, marginTop: "var(--space-1)" }}>{t("allowedHint")}</p>
      </form>

      {uploadState?.error && (
        <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--color-danger, crimson)" }}>
          {uploadState.error}
        </p>
      )}
      {removeError && (
        <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--color-danger, crimson)" }}>
          {removeError}
        </p>
      )}
    </div>
  );
}

function TheirSlot({
  bookingId,
  side,
  slot,
  formatSize,
  lastChanged,
}: {
  bookingId: string;
  side: "client" | "practitioner";
  slot: SessionDocumentSlot;
  formatSize: (n: number) => string;
  lastChanged: (slot: NonNullable<SessionDocumentSlot>) => string;
}) {
  const t = useTranslations("SessionDocuments");
  const [downloading, startDownload] = useTransition();
  const [downloadError, setDownloadError] = useState<string | null>(null);

  function onDownload() {
    setDownloadError(null);
    startDownload(async () => {
      const result = await getSessionDocumentUrl(bookingId, side);
      if (result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
      } else {
        setDownloadError(t("downloadFailed"));
      }
    });
  }

  return (
    <div>
      <p style={{ ...subMetaStyle, color: "var(--text-secondary)", fontWeight: 600 }}>{t("theirDocument")}</p>
      {slot ? (
        <>
          <div style={{ ...rowStyle, marginTop: "var(--space-1)" }}>
            <FileText size={18} aria-hidden style={{ color: "var(--text-tertiary)", flexShrink: 0, marginTop: 2 }} />
            <div style={{ minWidth: 0 }}>
              <p style={metaStyle}>
                {slot.fileName} · {formatSize(slot.byteSize)}
              </p>
              <p style={subMetaStyle}>{lastChanged(slot)}</p>
            </div>
          </div>
          <button
            type="button"
            className="focus-ring"
            disabled={downloading}
            onClick={onDownload}
            style={{ ...iconLinkStyle, marginTop: "var(--space-2)", opacity: downloading ? 0.6 : 1 }}
          >
            <Download size={16} aria-hidden />
            {downloading ? t("preparing") : t("download")}
          </button>
          {downloadError && (
            <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--color-danger, crimson)" }}>
              {downloadError}
            </p>
          )}
        </>
      ) : (
        <p style={{ ...metaStyle, marginTop: "var(--space-1)", color: "var(--text-tertiary)" }}>{t("theirEmpty")}</p>
      )}
    </div>
  );
}
