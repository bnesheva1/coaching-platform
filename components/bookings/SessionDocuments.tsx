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

// The upload cap shown in the UI. The server action + a DB trigger are the
// authoritative gate (lib/documents/config SESSION_DOCUMENT_MAX_FILES_PER_SIDE,
// default 3); this only decides when to hide the "add" control.
const MAX_FILES_PER_SIDE = 3;

// One file's display metadata. storage_path is never sent to the client — a
// download is minted on demand as a short-lived signed URL, keyed by id.
export type SessionDocumentFile = {
  id: string;
  fileName: string;
  byteSize: number;
  uploadedAt: string;
};

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

// Up to three files per side of a booking. The caller's own side is editable
// (add up to the cap / remove each); the counterparty's is read-only with a
// per-file download.
export function SessionDocuments({
  bookingId,
  perspective,
  clientDocuments,
  practitionerDocuments,
  timezone,
}: {
  bookingId: string;
  perspective: BookingPerspective;
  clientDocuments: SessionDocumentFile[];
  practitionerDocuments: SessionDocumentFile[];
  timezone: string;
}) {
  const t = useTranslations("SessionDocuments");
  const locale = useLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const changedFormatter = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  const yourSide = perspective === "client" ? "client" : "practitioner";
  const yours = perspective === "client" ? clientDocuments : practitionerDocuments;
  const theirs = perspective === "client" ? practitionerDocuments : clientDocuments;

  const lastChanged = (f: SessionDocumentFile) => t("lastChanged", { date: changedFormatter.format(new Date(f.uploadedAt)) });
  const fmtSize = (n: number) => formatBytes(n, intlLocale);

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
        <YourSide bookingId={bookingId} side={yourSide} files={yours} fmtSize={fmtSize} lastChanged={lastChanged} />
        <TheirSide files={theirs} fmtSize={fmtSize} lastChanged={lastChanged} />
      </div>
    </>
  );
}

function YourSide({
  bookingId,
  side,
  files,
  fmtSize,
  lastChanged,
}: {
  bookingId: string;
  side: "client" | "practitioner";
  files: SessionDocumentFile[];
  fmtSize: (n: number) => string;
  lastChanged: (f: SessionDocumentFile) => string;
}) {
  const t = useTranslations("SessionDocuments");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [uploadState, uploadAction, uploading] = useActionState<DocumentActionState, FormData>(uploadSessionDocument, null);
  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  const atMax = files.length >= MAX_FILES_PER_SIDE;

  function onRemove(documentId: string) {
    setRemoveError(null);
    const fd = new FormData();
    fd.set("documentId", documentId);
    startRemove(async () => {
      const result = await removeSessionDocument(null, fd);
      if (result?.error) setRemoveError(result.error);
    });
  }

  return (
    <div>
      <p style={{ ...subMetaStyle, color: "var(--text-secondary)", fontWeight: 600 }}>
        {t("yourDocuments")} {files.length > 0 && `(${files.length}/${MAX_FILES_PER_SIDE})`}
      </p>

      {files.map((f) => (
        <div key={f.id} style={{ ...rowStyle, marginTop: "var(--space-1)" }}>
          <FileText size={18} aria-hidden style={{ color: "var(--text-tertiary)", flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={metaStyle}>
              {f.fileName} · {fmtSize(f.byteSize)}
            </p>
            <p style={subMetaStyle}>{lastChanged(f)}</p>
          </div>
          <button
            type="button"
            className="focus-ring"
            disabled={uploading || removing}
            onClick={() => onRemove(f.id)}
            aria-label={t("removeNamed", { name: f.fileName })}
            style={{ ...iconLinkStyle, color: "var(--text-tertiary)", opacity: removing ? 0.6 : 1 }}
          >
            <Trash2 size={16} aria-hidden />
            {t("remove")}
          </button>
        </div>
      ))}

      {/* Add control — one fresh upload per submit, hidden once at the cap. */}
      {!atMax && (
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
            aria-label={t("uploadAria")}
            style={{ display: "none" }}
          />
          <button
            type="button"
            className="focus-ring"
            disabled={uploading || removing}
            onClick={() => fileInputRef.current?.click()}
            style={{ ...iconLinkStyle, opacity: uploading ? 0.6 : 1 }}
          >
            <Upload size={16} aria-hidden />
            {uploading ? t("uploading") : files.length > 0 ? t("addAnother") : t("upload")}
          </button>
          <p style={{ ...subMetaStyle, marginTop: "var(--space-1)" }}>{t("allowedHint")}</p>
          {/* Data-minimisation nudge + the retention window, informative. */}
          <p style={{ ...subMetaStyle, marginTop: "2px" }}>{t("uploadNotice")}</p>
        </form>
      )}
      {atMax && <p style={{ ...subMetaStyle, marginTop: "var(--space-2)" }}>{t("limitReached", { max: MAX_FILES_PER_SIDE })}</p>}

      {uploadState?.error && (
        <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{uploadState.error}</p>
      )}
      {removeError && (
        <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{removeError}</p>
      )}
    </div>
  );
}

function TheirSide({
  files,
  fmtSize,
  lastChanged,
}: {
  files: SessionDocumentFile[];
  fmtSize: (n: number) => string;
  lastChanged: (f: SessionDocumentFile) => string;
}) {
  const t = useTranslations("SessionDocuments");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [, startDownload] = useTransition();

  function onDownload(documentId: string) {
    setDownloadError(null);
    setDownloadingId(documentId);
    startDownload(async () => {
      const result = await getSessionDocumentUrl(documentId);
      if (result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
      } else {
        setDownloadError(t("downloadFailed"));
      }
      setDownloadingId(null);
    });
  }

  return (
    <div>
      <p style={{ ...subMetaStyle, color: "var(--text-secondary)", fontWeight: 600 }}>{t("theirDocuments")}</p>
      {files.length === 0 ? (
        <p style={{ ...metaStyle, marginTop: "var(--space-1)", color: "var(--text-tertiary)" }}>{t("theirEmpty")}</p>
      ) : (
        files.map((f) => (
          <div key={f.id} style={{ ...rowStyle, marginTop: "var(--space-1)" }}>
            <FileText size={18} aria-hidden style={{ color: "var(--text-tertiary)", flexShrink: 0, marginTop: 2 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={metaStyle}>
                {f.fileName} · {fmtSize(f.byteSize)}
              </p>
              <p style={subMetaStyle}>{lastChanged(f)}</p>
            </div>
            <button
              type="button"
              className="focus-ring"
              disabled={downloadingId === f.id}
              onClick={() => onDownload(f.id)}
              aria-label={t("downloadNamed", { name: f.fileName })}
              style={{ ...iconLinkStyle, opacity: downloadingId === f.id ? 0.6 : 1 }}
            >
              <Download size={16} aria-hidden />
              {downloadingId === f.id ? t("preparing") : t("download")}
            </button>
          </div>
        ))
      )}
      {downloadError && (
        <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{downloadError}</p>
      )}
    </div>
  );
}
