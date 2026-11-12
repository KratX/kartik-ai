/**
 * @kartik/frontend/features/uploads — Pre-Flight Client File Upload Validator (Micro-step 7.3.a).
 *
 * Enforces Blueprint §10 & §11:
 * - Validates extension, declared MIME type, byte size, and attachment count before sending over the wire.
 * - Strips any directory path components from `originalFilename` (the server still generates its own
 *   authoritative storage key per Invariant #10).
 */

export interface ClientUploadCandidate {
  readonly originalFilename: string;
  readonly declaredMimeType: string;
  readonly sizeBytes: number;
  readonly contentBase64: string;
}

export const MAX_CLIENT_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const MAX_ATTACHMENTS_PER_TURN = 5;

const ALLOWED_CLIENT_MIME_TO_EXTENSIONS: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
});

export function sanitizeUploadFilename(rawFilename: string): string {
  const withoutPath = rawFilename
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.trim();
  const cleaned = (withoutPath ?? '')
    .replace(/[\0<>:"|?*]/g, '')
    .replace(/^\.+/, '');
  if (!cleaned || cleaned.length > 160) {
    throw new Error('Invalid or empty upload filename');
  }
  return cleaned;
}

export function validateClientUploadCandidate(
  candidate: ClientUploadCandidate,
  currentAttachmentCount = 0,
): ClientUploadCandidate {
  if (currentAttachmentCount >= MAX_ATTACHMENTS_PER_TURN) {
    throw new Error(
      `Attachment limit reached (maximum ${MAX_ATTACHMENTS_PER_TURN} files per turn)`,
    );
  }

  const safeFilename = sanitizeUploadFilename(candidate.originalFilename);
  const allowedExts =
    ALLOWED_CLIENT_MIME_TO_EXTENSIONS[candidate.declaredMimeType];
  if (!allowedExts) {
    throw new Error(
      `Unsupported upload MIME type: "${candidate.declaredMimeType}"`,
    );
  }

  const dotIdx = safeFilename.lastIndexOf('.');
  const ext = dotIdx >= 0 ? safeFilename.slice(dotIdx).toLowerCase() : '';
  if (!allowedExts.includes(ext)) {
    throw new Error(
      `Filename extension "${ext}" does not match declared MIME type "${candidate.declaredMimeType}"`,
    );
  }

  if (
    !Number.isSafeInteger(candidate.sizeBytes) ||
    candidate.sizeBytes <= 0 ||
    candidate.sizeBytes > MAX_CLIENT_UPLOAD_BYTES
  ) {
    throw new Error(
      `Upload file size (${candidate.sizeBytes} bytes) must be between 1 and ${MAX_CLIENT_UPLOAD_BYTES} bytes`,
    );
  }

  if (!candidate.contentBase64 || candidate.contentBase64.trim().length === 0) {
    throw new Error('Upload contentBase64 must not be empty');
  }

  return Object.freeze({
    originalFilename: safeFilename,
    declaredMimeType: candidate.declaredMimeType,
    sizeBytes: candidate.sizeBytes,
    contentBase64: candidate.contentBase64,
  });
}
