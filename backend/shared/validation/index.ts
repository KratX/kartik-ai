/**
 * @kartik/shared/validation — Boundary Input Validation, Idempotency-Key & Cursor Pagination
 * (Blueprint §5.4, §10, Architecture Invariants #12, #15 & OpenAPI Contract).
 *
 * Architectural rules enforced here:
 * 1. `validateIdempotencyKey` validates the client's `Idempotency-Key` header and returns it
 *    unchanged as `requestId`. It NEVER generates or rewrites `requestId` (Invariant #15).
 *    Missing header -> `400 IDEMPOTENCY_KEY_REQUIRED`; malformed -> `400 VALIDATION_FAILED`.
 * 2. `encodePaginationCursor` / `decodePaginationCursor` bind `scope` and `userId` (plus optional
 *    HMAC integrity signature) so foreign, cross-resource, or tampered cursors fail with
 *    `400 VALIDATION_FAILED` (`openapi.yaml` /conversations/{id}/messages).
 * 3. `validateSafeRelativePath` and `validateArtifactManifest` reject path traversal (`..`),
 *    absolute paths, backslashes, null bytes, hidden files, and unsafe extensions (§10).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors/index.js';
import type { ArtifactManifest } from '../contracts/index.js';

export const DEFAULT_PAGE_LIMIT = 30 as const;
export const MAX_PAGE_LIMIT = 100 as const;

export const MAX_ARTIFACT_FILES = 25 as const;
export const MAX_ARTIFACT_FILE_BYTES = 512 * 1024; // 512 KB per file
export const MAX_ARTIFACT_TOTAL_BYTES = 2 * 1024 * 1024; // 2 MB total per artifact

export const ALLOWED_ARTIFACT_EXTENSIONS = [
  '.html',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.svg',
  '.txt',
] as const;

/**
 * Accepts UUID v4/v7 (36 chars) or safe client-generated idempotency keys (16..128 chars,
 * alphanumeric + hyphen/underscore). Rejects colons (Redis delimiter), whitespace, and empty strings.
 */
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Validates the client's `Idempotency-Key` header and returns it unchanged as `requestId` (§5.4).
 * Never generates or modifies the key (Architecture Invariant #15).
 */
export function validateIdempotencyKey(rawHeader: unknown): string {
  if (rawHeader === undefined || rawHeader === null) {
    throw new AppError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Mutating endpoints require an Idempotency-Key header',
      { details: { 'Idempotency-Key': ['Header is required'] } },
    );
  }

  if (typeof rawHeader !== 'string') {
    throw new AppError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key header must be a single string value',
      { details: { 'Idempotency-Key': ['Must be a string'] } },
    );
  }

  if (rawHeader.length === 0 || rawHeader.trim().length === 0) {
    throw new AppError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key header must not be empty',
      { details: { 'Idempotency-Key': ['Cannot be blank'] } },
    );
  }

  // Do not silently trim or rewrite: if leading/trailing whitespace or illegal chars exist, reject
  if (!IDEMPOTENCY_KEY_REGEX.test(rawHeader)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Idempotency-Key must be 16–128 characters of [A-Za-z0-9_-] (e.g. UUID v4 or ULID)',
      { details: { 'Idempotency-Key': ['Must match /^[A-Za-z0-9_-]{16,128}$/'] } },
    );
  }

  return rawHeader;
}

export interface PaginationCursorPayload {
  readonly scope: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly id: string;
}

export interface CursorVerifyOptions {
  readonly expectedScope: string;
  readonly expectedUserId: string;
  readonly secret?: string;
}

function computeCursorMac(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload, 'utf8').digest('base64url');
}

/**
 * Encodes a keyset pagination cursor `(createdAt, id)` bound to `scope` and `userId` (§5.4).
 */
export function encodePaginationCursor(
  payload: PaginationCursorPayload,
  secret = 'kartik-default-cursor-integrity-key',
): string {
  if (
    !payload.scope.trim() ||
    !payload.userId.trim() ||
    !payload.createdAt.trim() ||
    !payload.id.trim()
  ) {
    throw new AppError('VALIDATION_FAILED', 'Cursor payload requires non-empty scope, userId, createdAt, and id');
  }
  const timestampMs = Date.parse(payload.createdAt);
  if (Number.isNaN(timestampMs)) {
    throw new AppError('VALIDATION_FAILED', 'Cursor createdAt must be a valid ISO-8601 timestamp');
  }

  const normalized: PaginationCursorPayload = {
    scope: payload.scope.trim(),
    userId: payload.userId.trim(),
    createdAt: new Date(timestampMs).toISOString(),
    id: payload.id.trim(),
  };

  const encodedPayload = Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64url');
  const mac = computeCursorMac(encodedPayload, secret);
  return `${encodedPayload}.${mac}`;
}

/**
 * Decodes and verifies a pagination cursor, rejecting tampered, malformed,
 * cross-endpoint (`scope`), or foreign-user (`userId`) cursors with `400 VALIDATION_FAILED`.
 */
export function decodePaginationCursor(
  cursor: string,
  options: CursorVerifyOptions,
): PaginationCursorPayload {
  if (typeof cursor !== 'string' || cursor.trim().length === 0) {
    throw new AppError('VALIDATION_FAILED', 'Pagination cursor must be a non-empty string', {
      details: { cursor: ['Empty cursor'] },
    });
  }

  const parts = cursor.split('.');
  if (parts.length !== 2) {
    throw new AppError('VALIDATION_FAILED', 'Malformed pagination cursor format', {
      details: { cursor: ['Expected payload.signature format'] },
    });
  }

  const [encodedPayload, providedMac] = parts as [string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(encodedPayload) || !/^[A-Za-z0-9_-]+$/.test(providedMac)) {
    throw new AppError('VALIDATION_FAILED', 'Malformed pagination cursor encoding', {
      details: { cursor: ['Invalid base64url characters'] },
    });
  }

  const secret = options.secret ?? 'kartik-default-cursor-integrity-key';
  const expectedMac = computeCursorMac(encodedPayload, secret);

  const providedBuf = Buffer.from(providedMac, 'utf8');
  const expectedBuf = Buffer.from(expectedMac, 'utf8');
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    throw new AppError('VALIDATION_FAILED', 'Tampered pagination cursor signature', {
      details: { cursor: ['Integrity check failed'] },
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Malformed pagination cursor JSON payload', {
      details: { cursor: ['Invalid JSON'] },
    });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid pagination cursor structure');
  }

  const rec = parsed as Record<string, unknown>;
  if (
    typeof rec.scope !== 'string' ||
    typeof rec.userId !== 'string' ||
    typeof rec.createdAt !== 'string' ||
    typeof rec.id !== 'string' ||
    !rec.id.trim() ||
    Number.isNaN(Date.parse(rec.createdAt))
  ) {
    throw new AppError('VALIDATION_FAILED', 'Incomplete pagination cursor fields');
  }

  if (rec.scope !== options.expectedScope || rec.userId !== options.expectedUserId) {
    throw new AppError('VALIDATION_FAILED', 'Foreign or cross-resource pagination cursor rejected', {
      details: { cursor: ['Cursor scope or owner does not match request'] },
    });
  }

  return Object.freeze({
    scope: rec.scope,
    userId: rec.userId,
    createdAt: rec.createdAt,
    id: rec.id,
  });
}

export interface ParsedPaginationQuery {
  readonly limit: number;
  readonly cursor: PaginationCursorPayload | null;
}

/**
 * Parses and validates `?limit` (1..100, default 30) and optional `?cursor` query parameters (§5.4).
 */
export function parsePaginationQuery(
  query: { readonly limit?: unknown; readonly cursor?: unknown },
  options: CursorVerifyOptions,
): ParsedPaginationQuery {
  let limit = DEFAULT_PAGE_LIMIT as number;

  if (query.limit !== undefined && query.limit !== null && query.limit !== '') {
    const parsedLimit =
      typeof query.limit === 'number'
        ? query.limit
        : typeof query.limit === 'string' && /^\d+$/.test(query.limit)
          ? Number.parseInt(query.limit, 10)
          : Number.NaN;

    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_PAGE_LIMIT) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Pagination limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`,
        { details: { limit: [`Must be 1..${MAX_PAGE_LIMIT}`] } },
      );
    }
    limit = parsedLimit;
  }

  let cursorPayload: PaginationCursorPayload | null = null;
  if (query.cursor !== undefined && query.cursor !== null && query.cursor !== '') {
    if (typeof query.cursor !== 'string') {
      throw new AppError('VALIDATION_FAILED', 'Pagination cursor must be a string', {
        details: { cursor: ['Must be a string'] },
      });
    }
    cursorPayload = decodePaginationCursor(query.cursor, options);
  }

  return Object.freeze({
    limit,
    cursor: cursorPayload,
  });
}

/**
 * Validates that an artifact file path is a safe relative path without traversal (`..`),
 * leading slashes, backslashes, null bytes, hidden dot-segments, or disallowed extensions (§10).
 */
export function validateSafeRelativePath(filePath: string): string {
  if (typeof filePath !== 'string' || filePath.trim().length === 0 || filePath !== filePath.trim()) {
    throw new AppError('ARTIFACT_INVALID', 'Artifact file path must be a non-empty trimmed string');
  }
  if (filePath.length > 180) {
    throw new AppError('ARTIFACT_INVALID', 'Artifact file path exceeds maximum length of 180 characters');
  }
  if (filePath.includes('\0') || filePath.includes('\\')) {
    throw new AppError('ARTIFACT_INVALID', 'Artifact file path contains forbidden null byte or backslash');
  }
  if (filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)) {
    throw new AppError('ARTIFACT_INVALID', 'Artifact file path must be relative, not absolute');
  }

  const segments = filePath.split('/');
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.startsWith('.')
    ) {
      throw new AppError(
        'ARTIFACT_INVALID',
        `Unsafe path segment "${segment}" in artifact path "${filePath}"`,
      );
    }
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
      throw new AppError(
        'ARTIFACT_INVALID',
        `Invalid characters in artifact path segment "${segment}"`,
      );
    }
  }

  const lower = filePath.toLowerCase();
  const hasAllowedExtension = ALLOWED_ARTIFACT_EXTENSIONS.some((ext) => lower.endsWith(ext));
  if (!hasAllowedExtension) {
    throw new AppError(
      'ARTIFACT_INVALID',
      `Unsupported file extension in "${filePath}"; allowed: ${ALLOWED_ARTIFACT_EXTENSIONS.join(', ')}`,
    );
  }

  return filePath;
}

/**
 * Validates an untrusted model-generated coding `ArtifactManifest` (§10, Invariant #12).
 */
export function validateArtifactManifest(input: unknown): ArtifactManifest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new AppError('ARTIFACT_INVALID', 'Artifact manifest must be a JSON object');
  }

  const raw = input as Record<string, unknown>;
  if (typeof raw.title !== 'string' || raw.title.trim().length === 0 || raw.title.length > 120) {
    throw new AppError('ARTIFACT_INVALID', 'Artifact manifest requires a title (1–120 chars)');
  }
  if (typeof raw.entryFile !== 'string') {
    throw new AppError('ARTIFACT_INVALID', 'Artifact manifest requires an entryFile path');
  }
  const entryFile = validateSafeRelativePath(raw.entryFile);

  if (!Array.isArray(raw.files) || raw.files.length === 0 || raw.files.length > MAX_ARTIFACT_FILES) {
    throw new AppError(
      'ARTIFACT_INVALID',
      `Artifact manifest must contain between 1 and ${MAX_ARTIFACT_FILES} files`,
    );
  }

  const seenPaths = new Set<string>();
  let totalBytes = 0;

  const validatedFiles = raw.files.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new AppError('ARTIFACT_INVALID', 'Each artifact manifest file entry must be an object');
    }
    const f = item as Record<string, unknown>;
    if (typeof f.path !== 'string') {
      throw new AppError('ARTIFACT_INVALID', 'Artifact file entry missing path');
    }
    const safePath = validateSafeRelativePath(f.path);
    if (seenPaths.has(safePath)) {
      throw new AppError('ARTIFACT_INVALID', `Duplicate file path in artifact manifest: ${safePath}`);
    }
    seenPaths.add(safePath);

    if (typeof f.mimeType !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(f.mimeType)) {
      throw new AppError('ARTIFACT_INVALID', `Invalid mimeType for artifact file "${safePath}"`);
    }
    if (
      typeof f.sizeBytes !== 'number' ||
      !Number.isInteger(f.sizeBytes) ||
      f.sizeBytes <= 0 ||
      f.sizeBytes > MAX_ARTIFACT_FILE_BYTES
    ) {
      throw new AppError(
        'ARTIFACT_INVALID',
        `Invalid sizeBytes for "${safePath}": must be 1..${MAX_ARTIFACT_FILE_BYTES}`,
      );
    }
    totalBytes += f.sizeBytes;
    if (totalBytes > MAX_ARTIFACT_TOTAL_BYTES) {
      throw new AppError('ARTIFACT_INVALID', 'Artifact manifest exceeds maximum total byte budget');
    }

    if (typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(f.sha256)) {
      throw new AppError('ARTIFACT_INVALID', `Invalid sha256 digest for "${safePath}"`);
    }

    return Object.freeze({
      path: safePath,
      mimeType: f.mimeType.toLowerCase(),
      sizeBytes: f.sizeBytes,
      sha256: f.sha256.toLowerCase(),
    });
  });

  if (!seenPaths.has(entryFile)) {
    throw new AppError('ARTIFACT_INVALID', `Artifact entryFile "${entryFile}" must exist in files[]`);
  }

  return Object.freeze({
    title: raw.title.trim(),
    entryFile,
    files: Object.freeze(validatedFiles),
  });
}
