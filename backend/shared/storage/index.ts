/**
 * @kartik/shared/storage — Private Object Storage Contract, Server-Side Key Generation & Magic-Byte Validation
 * (Blueprint §5.1, §10, §11 & Architecture Invariants #10, #18, #20).
 *
 * Architectural rules enforced here:
 * 1. Storage keys are ALWAYS generated server-side (`buildObjectStorageKey`); raw user
 *    filenames are never used as object keys (§11).
 * 2. Uploaded files are validated by byte size (`FILE_TOO_LARGE` 413), declared MIME type,
 *    file extension, and actual magic-byte header signature (`UNSUPPORTED_FILE_TYPE` 415) (§11).
 * 3. Objects are private. Short-lived signed URLs are issued ONLY after an ownership check;
 *    both missing objects and objects owned by another user return `404 NOT_FOUND`
 *    (Invariants #10 & #20).
 */
import { createHmac } from 'node:crypto';
import { AppError } from '../errors/index.js';

export const OBJECT_NAMESPACES = ['uploads', 'artifacts', 'images'] as const;
export type ObjectNamespace = (typeof OBJECT_NAMESPACES)[number];

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB (§6.1 MAX_UPLOAD_BYTES)
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300 as const; // 5 minutes
export const MAX_SIGNED_URL_TTL_SECONDS = 900 as const; // 15 minutes max

export const ALLOWED_UPLOAD_MIME_TYPES = {
  'application/pdf': {
    extensions: ['.pdf'] as const,
    matchesMagicBytes: (buf: Uint8Array): boolean =>
      buf.length >= 5 &&
      buf[0] === 0x25 && // %
      buf[1] === 0x50 && // P
      buf[2] === 0x44 && // D
      buf[3] === 0x46 && // F
      buf[4] === 0x2d, // -
  },
  'image/png': {
    extensions: ['.png'] as const,
    matchesMagicBytes: (buf: Uint8Array): boolean =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a,
  },
  'image/jpeg': {
    extensions: ['.jpg', '.jpeg'] as const,
    matchesMagicBytes: (buf: Uint8Array): boolean =>
      buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  'image/webp': {
    extensions: ['.webp'] as const,
    matchesMagicBytes: (buf: Uint8Array): boolean =>
      buf.length >= 12 &&
      buf[0] === 0x52 && // R
      buf[1] === 0x49 && // I
      buf[2] === 0x46 && // F
      buf[3] === 0x46 && // F
      buf[8] === 0x57 && // W
      buf[9] === 0x45 && // E
      buf[10] === 0x42 && // B
      buf[11] === 0x50, // P
  },
} as const;

export type AllowedUploadMimeType = keyof typeof ALLOWED_UPLOAD_MIME_TYPES;

export interface BuildObjectKeyInput {
  readonly namespace: ObjectNamespace;
  readonly userId: string;
  readonly resourceId: string;
  readonly fileId: string;
  readonly extension: string;
}

function assertSafeStorageSegment(segment: string, label: string): string {
  if (typeof segment !== 'string' || !/^[A-Za-z0-9_-]{2,80}$/.test(segment)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Invalid object storage key segment (${label}): must match /^[A-Za-z0-9_-]{2,80}$/`,
    );
  }
  return segment;
}

/**
 * Generates a canonical server-side object storage key:
 * `{namespace}/{userId}/{resourceId}/{fileId}.{ext}` (§11).
 * Raw user filenames are never interpolated into storage keys.
 */
export function buildObjectStorageKey(input: BuildObjectKeyInput): string {
  if (!(OBJECT_NAMESPACES as readonly string[]).includes(input.namespace)) {
    throw new AppError('VALIDATION_FAILED', `Invalid object storage namespace: ${String(input.namespace)}`);
  }
  const userId = assertSafeStorageSegment(input.userId, 'userId');
  const resourceId = assertSafeStorageSegment(input.resourceId, 'resourceId');
  const fileId = assertSafeStorageSegment(input.fileId, 'fileId');

  const rawExt = input.extension.startsWith('.') ? input.extension.toLowerCase() : `.${input.extension.toLowerCase()}`;
  if (!/^\.[a-z0-9]{2,8}$/.test(rawExt)) {
    throw new AppError('VALIDATION_FAILED', `Invalid object storage file extension: ${input.extension}`);
  }

  return `${input.namespace}/${userId}/${resourceId}/${fileId}${rawExt}`;
}

export interface ValidateUploadInput {
  readonly originalFilename: string;
  readonly declaredMimeType: string;
  readonly sizeBytes: number;
  readonly headerBytes: Uint8Array;
  readonly maxUploadBytes?: number;
}

export interface ValidatedUploadDescriptor {
  readonly mimeType: AllowedUploadMimeType;
  readonly canonicalExtension: string;
  readonly sizeBytes: number;
}

/**
 * Validates file size (`FILE_TOO_LARGE` 413), declared MIME type, filename extension,
 * and actual magic-byte signature (`UNSUPPORTED_FILE_TYPE` 415) (§11).
 */
export function validateUploadFile(input: ValidateUploadInput): ValidatedUploadDescriptor {
  const maxBytes = input.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;

  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new AppError('VALIDATION_FAILED', 'Uploaded file sizeBytes must be a positive integer');
  }
  if (input.sizeBytes > maxBytes) {
    throw new AppError(
      'VALIDATION_FAILED',
      `File size (${input.sizeBytes} bytes) exceeds maximum allowed (${maxBytes} bytes)`,
      { details: { sizeBytes: ['FILE_TOO_LARGE'] } },
    );
  }

  const normalizedMime = input.declaredMimeType.trim().toLowerCase() as AllowedUploadMimeType;
  const spec = ALLOWED_UPLOAD_MIME_TYPES[normalizedMime];
  if (spec === undefined) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Unsupported MIME type "${input.declaredMimeType}"; allowed: ${Object.keys(ALLOWED_UPLOAD_MIME_TYPES).join(', ')}`,
      { details: { declaredMimeType: ['UNSUPPORTED_FILE_TYPE'] } },
    );
  }

  const lowerFilename = input.originalFilename.trim().toLowerCase();
  const matchedExt = spec.extensions.find((ext) => lowerFilename.endsWith(ext));
  if (matchedExt === undefined) {
    throw new AppError(
      'VALIDATION_FAILED',
      `File extension of "${input.originalFilename}" does not match declared MIME type "${normalizedMime}"`,
      { details: { originalFilename: ['UNSUPPORTED_FILE_TYPE'] } },
    );
  }

  if (!spec.matchesMagicBytes(input.headerBytes)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `File content magic-byte signature does not match declared MIME type "${normalizedMime}"`,
      { details: { headerBytes: ['UNSUPPORTED_FILE_TYPE'] } },
    );
  }

  return Object.freeze({
    mimeType: normalizedMime,
    canonicalExtension: matchedExt,
    sizeBytes: input.sizeBytes,
  });
}

export interface StoredPrivateObjectMetadata {
  readonly key: string;
  readonly ownerUserId: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly createdAt: string;
}

export interface PutPrivateObjectInput {
  readonly key: string;
  readonly ownerUserId: string;
  readonly mimeType: string;
  readonly body: Uint8Array;
  readonly sha256: string;
}

export interface SignedUrlIssueOptions {
  readonly key: string;
  readonly requesterUserId: string;
  readonly ttlSeconds?: number;
  readonly nowSeconds?: number;
}

export interface SignedDownloadUrlResult {
  readonly signedUrl: string;
  readonly expiresAt: string;
  readonly ttlSeconds: number;
}

export interface ObjectStorage {
  putPrivateObject(input: PutPrivateObjectInput): Promise<StoredPrivateObjectMetadata>;
  headPrivateObject(key: string, requesterUserId: string): Promise<StoredPrivateObjectMetadata>;
  getPrivateObject(
    key: string,
    requesterUserId: string,
  ): Promise<{ readonly metadata: StoredPrivateObjectMetadata; readonly body: Uint8Array }>;
  createSignedDownloadUrl(options: SignedUrlIssueOptions): Promise<SignedDownloadUrlResult>;
  deletePrivateObject(key: string, ownerUserId: string): Promise<boolean>;
}

/**
 * Deterministic private object storage adapter for unit/contract testing and mock mode.
 * Enforces ownership checks and anti-enumeration (`404 NOT_FOUND` on missing OR foreign objects).
 */
export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<
    string,
    { readonly metadata: StoredPrivateObjectMetadata; readonly body: Uint8Array }
  >();
  private readonly signingSecret: string;
  private readonly baseEndpoint: string;

  constructor(options: { readonly signingSecret?: string; readonly baseEndpoint?: string } = {}) {
    this.signingSecret = options.signingSecret ?? 'kartik-private-storage-signing-secret';
    this.baseEndpoint = options.baseEndpoint ?? 'http://localhost:9000/kartik-private';
  }

  async putPrivateObject(input: PutPrivateObjectInput): Promise<StoredPrivateObjectMetadata> {
    if (!input.key.includes(`/${input.ownerUserId}/`)) {
      throw new AppError('VALIDATION_FAILED', 'Object storage key must be scoped to ownerUserId');
    }
    const metadata: StoredPrivateObjectMetadata = Object.freeze({
      key: input.key,
      ownerUserId: input.ownerUserId,
      mimeType: input.mimeType,
      sizeBytes: input.body.byteLength,
      sha256: input.sha256,
      createdAt: new Date().toISOString(),
    });
    this.objects.set(input.key, {
      metadata,
      body: new Uint8Array(input.body),
    });
    return metadata;
  }

  async headPrivateObject(key: string, requesterUserId: string): Promise<StoredPrivateObjectMetadata> {
    const record = this.objects.get(key);
    // Invariant #20: missing resource and foreign-owned resource both return 404 NOT_FOUND
    if (record === undefined || record.metadata.ownerUserId !== requesterUserId) {
      throw new AppError('NOT_FOUND', 'Requested object was not found');
    }
    return record.metadata;
  }

  async getPrivateObject(
    key: string,
    requesterUserId: string,
  ): Promise<{ readonly metadata: StoredPrivateObjectMetadata; readonly body: Uint8Array }> {
    const record = this.objects.get(key);
    if (record === undefined || record.metadata.ownerUserId !== requesterUserId) {
      throw new AppError('NOT_FOUND', 'Requested object was not found');
    }
    return Object.freeze({
      metadata: record.metadata,
      body: new Uint8Array(record.body),
    });
  }

  async createSignedDownloadUrl(options: SignedUrlIssueOptions): Promise<SignedDownloadUrlResult> {
    const metadata = await this.headPrivateObject(options.key, options.requesterUserId);
    const ttlSeconds = options.ttlSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS;

    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_SIGNED_URL_TTL_SECONDS) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Signed URL ttlSeconds must be between 1 and ${MAX_SIGNED_URL_TTL_SECONDS}`,
      );
    }

    const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
    const expiresEpoch = nowSeconds + ttlSeconds;
    const canonical = `${metadata.key}:${metadata.ownerUserId}:${expiresEpoch}`;
    const signature = createHmac('sha256', this.signingSecret).update(canonical, 'utf8').digest('hex');

    const signedUrl = `${this.baseEndpoint}/${metadata.key}?X-Amz-Expires=${ttlSeconds}&X-Amz-Signature=${signature}`;
    return Object.freeze({
      signedUrl,
      expiresAt: new Date(expiresEpoch * 1000).toISOString(),
      ttlSeconds,
    });
  }

  async deletePrivateObject(key: string, ownerUserId: string): Promise<boolean> {
    const record = this.objects.get(key);
    if (record === undefined) {
      return false;
    }
    if (record.metadata.ownerUserId !== ownerUserId) {
      throw new AppError('NOT_FOUND', 'Requested object was not found');
    }
    return this.objects.delete(key);
  }
}
