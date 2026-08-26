import { fileTypeFromBuffer } from "file-type";
import { ALLOWED_DOCUMENT_TYPES, type AllowedDocumentMime } from "./config";

// Server-side file-type validation. These are user-supplied files that
// the OTHER party will open, so a forged extension or Content-Type must
// never decide what we store — we inspect the actual bytes. The browser-
// declared type is used only as a disambiguating hint for the two
// formats magic numbers genuinely can't resolve alone (legacy .doc and
// plain text); it is never trusted on its own.

export type DocumentValidation =
  | { ok: true; mime: AllowedDocumentMime; ext: string }
  | { ok: false; reason: "empty" | "type" };

// UTF-8 plain text has no magic number, so we validate it positively:
// reject anything containing a NUL byte (a hallmark of binary) and
// require the whole buffer to decode as strict UTF-8. This stops an
// arbitrary binary blob with no recognised signature slipping through
// labelled as "text/plain".
function isProbablyUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export async function validateDocumentBytes(bytes: Uint8Array, declaredType: string): Promise<DocumentValidation> {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };

  const sniffed = await fileTypeFromBuffer(bytes);

  if (sniffed) {
    // PDF and DOCX have unambiguous signatures file-type resolves
    // straight to our allowlisted MIME.
    if (sniffed.mime in ALLOWED_DOCUMENT_TYPES) {
      const mime = sniffed.mime as AllowedDocumentMime;
      return { ok: true, mime, ext: ALLOWED_DOCUMENT_TYPES[mime] };
    }
    // Legacy .doc is an OLE2 compound file; the header is shared with
    // .xls/.ppt, so file-type reports the generic container
    // (application/x-cfb). Accept it as .doc only when the client claims
    // Word — it is an Office document either way (never executable), and
    // this is as far as magic-byte inspection can go for the format.
    if (sniffed.mime === "application/x-cfb" && declaredType === "application/msword") {
      return { ok: true, mime: "application/msword", ext: "doc" };
    }
    // A recognised type we don't allow (image, archive, executable, …).
    return { ok: false, reason: "type" };
  }

  // No signature at all — only genuine UTF-8 plain text qualifies.
  if (declaredType === "text/plain" && isProbablyUtf8Text(bytes)) {
    return { ok: true, mime: "text/plain", ext: "txt" };
  }
  return { ok: false, reason: "type" };
}
