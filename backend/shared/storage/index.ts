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

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Durable disk-backed `ObjectStorage` implementation persisting binary objects and
 * `.meta.json` ownership descriptors on the local filesystem.
 * Enforces Invariants #10 & #20 (`404 NOT_FOUND` on missing or foreign-owned objects).
 */
export class FileSystemObjectStorage implements ObjectStorage {
  private readonly rootDir: string;
  private readonly signingSecret: string;
  private readonly baseEndpoint: string;

  constructor(options: {
    readonly rootDir?: string;
    readonly signingSecret?: string;
    readonly baseEndpoint?: string;
  } = {}) {
    this.rootDir = path.resolve(options.rootDir ?? '.data/object-storage');
    this.signingSecret = options.signingSecret ?? 'kartik-private-storage-signing-secret';
    this.baseEndpoint = options.baseEndpoint ?? 'http://localhost:9000/kartik-private';
  }

  private resolveSafePaths(key: string): {
    readonly dataPath: string;
    readonly metaPath: string;
  } {
    const normalized = key.replace(/^\/+/, '');
    if (normalized.includes('..') || normalized.includes('\\')) {
      throw new AppError('VALIDATION_FAILED', 'Invalid object storage key path');
    }
    const dataPath = path.resolve(this.rootDir, normalized);
    if (!dataPath.startsWith(this.rootDir + path.sep)) {
      throw new AppError('VALIDATION_FAILED', 'Object storage key escaped root directory');
    }
    return {
      dataPath,
      metaPath: `${dataPath}.meta.json`,
    };
  }

  async putPrivateObject(input: PutPrivateObjectInput): Promise<StoredPrivateObjectMetadata> {
    if (!input.key.includes(`/${input.ownerUserId}/`)) {
      throw new AppError('VALIDATION_FAILED', 'Object storage key must be scoped to ownerUserId');
    }
    const { dataPath, metaPath } = this.resolveSafePaths(input.key);
    await fs.mkdir(path.dirname(dataPath), { recursive: true });

    const metadata: StoredPrivateObjectMetadata = Object.freeze({
      key: input.key,
      ownerUserId: input.ownerUserId,
      mimeType: input.mimeType,
      sizeBytes: input.body.byteLength,
      sha256: input.sha256,
      createdAt: new Date().toISOString(),
    });

    await fs.writeFile(dataPath, input.body);
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf8');
    return metadata;
  }

  async headPrivateObject(key: string, requesterUserId: string): Promise<StoredPrivateObjectMetadata> {
    const { metaPath } = this.resolveSafePaths(key);
    try {
      const raw = await fs.readFile(metaPath, 'utf8');
      const metadata = JSON.parse(raw) as StoredPrivateObjectMetadata;
      if (metadata.ownerUserId !== requesterUserId) {
        throw new AppError('NOT_FOUND', 'Requested object was not found');
      }
      return Object.freeze(metadata);
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError('NOT_FOUND', 'Requested object was not found');
    }
  }

  async getPrivateObject(
    key: string,
    requesterUserId: string,
  ): Promise<{ readonly metadata: StoredPrivateObjectMetadata; readonly body: Uint8Array }> {
    const metadata = await this.headPrivateObject(key, requesterUserId);
    const { dataPath } = this.resolveSafePaths(key);
    try {
      const buf = await fs.readFile(dataPath);
      return Object.freeze({
        metadata,
        body: new Uint8Array(buf),
      });
    } catch {
      throw new AppError('NOT_FOUND', 'Requested object was not found');
    }
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
    const { dataPath, metaPath } = this.resolveSafePaths(key);
    try {
      const raw = await fs.readFile(metaPath, 'utf8');
      const metadata = JSON.parse(raw) as StoredPrivateObjectMetadata;
      if (metadata.ownerUserId !== ownerUserId) {
        throw new AppError('NOT_FOUND', 'Requested object was not found');
      }
      await fs.unlink(dataPath).catch(() => {});
      await fs.unlink(metaPath).catch(() => {});
      return true;
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      return false;
    }
  }
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function formatAmzDate(date: Date): { readonly amzDate: string; readonly dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function deriveAwsSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service = 's3',
): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

export interface S3CompatibleObjectStorageOptions {
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region?: string;
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly fallbackStorage?: ObjectStorage;
}

/**
 * Production S3 / Cloudflare R2 / MinIO private object storage adapter using AWS Signature V4 (`AWS4-HMAC-SHA256`).
 * Enforces private bucket semantics, server-side keys, and `x-amz-meta-owner-user-id` ownership checks (Invariants #10 & #20).
 */
export class S3CompatibleObjectStorage implements ObjectStorage {
  private readonly endpoint: string;
  private readonly bucket: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly region: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly fallback: ObjectStorage;

  constructor(options: S3CompatibleObjectStorageOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, '');
    this.bucket = options.bucket;
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
    this.region = options.region ?? 'auto';
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.fallback = options.fallbackStorage ?? new FileSystemObjectStorage();
  }

  private buildSignedHeaders(params: {
    readonly method: 'PUT' | 'GET' | 'HEAD' | 'DELETE';
    readonly canonicalUri: string;
    readonly host: string;
    readonly payloadHash: string;
    readonly extraHeaders?: Readonly<Record<string, string>>;
    readonly now?: Date;
  }): Record<string, string> {
    const { amzDate, dateStamp } = formatAmzDate(params.now ?? new Date());
    const allHeaders: Record<string, string> = {
      host: params.host,
      'x-amz-content-sha256': params.payloadHash,
      'x-amz-date': amzDate,
      ...(params.extraHeaders ?? {}),
    };

    const sortedHeaderKeys = Object.keys(allHeaders)
      .map((k) => k.toLowerCase())
      .sort();
    const canonicalHeaders = sortedHeaderKeys
      .map((k) => `${k}:${(allHeaders[k] ?? '').trim()}\n`)
      .join('');
    const signedHeaders = sortedHeaderKeys.join(';');

    const canonicalRequest = [
      params.method,
      params.canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      params.payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = deriveAwsSigningKey(this.secretAccessKey, dateStamp, this.region, 's3');
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    return {
      ...allHeaders,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  async putPrivateObject(input: PutPrivateObjectInput): Promise<StoredPrivateObjectMetadata> {
    if (!input.key.includes(`/${input.ownerUserId}/`)) {
      throw new AppError('VALIDATION_FAILED', 'Object storage key must be scoped to ownerUserId');
    }
    const createdAt = new Date().toISOString();
    const parsedUrl = new URL(`${this.endpoint}/${this.bucket}/${input.key}`);
    const payloadHash = sha256Hex(input.body);
    const headers = this.buildSignedHeaders({
      method: 'PUT',
      canonicalUri: parsedUrl.pathname,
      host: parsedUrl.host,
      payloadHash,
      extraHeaders: {
        'content-type': input.mimeType,
        'x-amz-meta-owner-user-id': input.ownerUserId,
        'x-amz-meta-sha256': input.sha256,
        'x-amz-meta-created-at': createdAt,
      },
    });

    try {
      const res = await this.fetchImpl(parsedUrl.toString(), {
        method: 'PUT',
        headers,
        body: Buffer.from(input.body),
      });
      if (!res.ok) {
        throw new Error(`S3 PUT failed with status ${res.status}`);
      }
      await this.fallback.putPrivateObject(input);
      return Object.freeze({
        key: input.key,
        ownerUserId: input.ownerUserId,
        mimeType: input.mimeType,
        sizeBytes: input.body.byteLength,
        sha256: input.sha256,
        createdAt,
      });
    } catch {
      return this.fallback.putPrivateObject(input);
    }
  }

  async headPrivateObject(key: string, requesterUserId: string): Promise<StoredPrivateObjectMetadata> {
    const parsedUrl = new URL(`${this.endpoint}/${this.bucket}/${key}`);
    const headers = this.buildSignedHeaders({
      method: 'HEAD',
      canonicalUri: parsedUrl.pathname,
      host: parsedUrl.host,
      payloadHash: sha256Hex(''),
    });

    try {
      const res = await this.fetchImpl(parsedUrl.toString(), {
        method: 'HEAD',
        headers,
      });
      if (res.status === 404) {
        throw new AppError('NOT_FOUND', 'Requested object was not found');
      }
      if (!res.ok) {
        throw new Error(`S3 HEAD failed with status ${res.status}`);
      }
      const ownerUserId = res.headers.get('x-amz-meta-owner-user-id') ?? '';
      if (ownerUserId !== requesterUserId) {
        throw new AppError('NOT_FOUND', 'Requested object was not found');
      }
      return Object.freeze({
        key,
        ownerUserId,
        mimeType: res.headers.get('content-type') ?? 'application/octet-stream',
        sizeBytes: Number(res.headers.get('content-length') ?? 0),
        sha256: res.headers.get('x-amz-meta-sha256') ?? '',
        createdAt: res.headers.get('x-amz-meta-created-at') ?? new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      return this.fallback.headPrivateObject(key, requesterUserId);
    }
  }

  async getPrivateObject(
    key: string,
    requesterUserId: string,
  ): Promise<{ readonly metadata: StoredPrivateObjectMetadata; readonly body: Uint8Array }> {
    const parsedUrl = new URL(`${this.endpoint}/${this.bucket}/${key}`);
    const headers = this.buildSignedHeaders({
      method: 'GET',
      canonicalUri: parsedUrl.pathname,
      host: parsedUrl.host,
      payloadHash: sha256Hex(''),
    });

    try {
      const res = await this.fetchImpl(parsedUrl.toString(), {
        method: 'GET',
        headers,
      });
      if (res.status === 404) {
        throw new AppError('NOT_FOUND', 'Requested object was not found');
      }
      if (!res.ok) {
        throw new Error(`S3 GET failed with status ${res.status}`);
      }
      const ownerUserId = res.headers.get('x-amz-meta-owner-user-id') ?? '';
      if (ownerUserId !== requesterUserId) {
        throw new AppError('NOT_FOUND', 'Requested object was not found');
      }
      const ab = await res.arrayBuffer();
      const body = new Uint8Array(ab);
      const metadata: StoredPrivateObjectMetadata = Object.freeze({
        key,
        ownerUserId,
        mimeType: res.headers.get('content-type') ?? 'application/octet-stream',
        sizeBytes: body.byteLength,
        sha256: res.headers.get('x-amz-meta-sha256') ?? sha256Hex(body),
        createdAt: res.headers.get('x-amz-meta-created-at') ?? new Date().toISOString(),
      });
      return Object.freeze({ metadata, body });
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      return this.fallback.getPrivateObject(key, requesterUserId);
    }
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
    const nowDate = new Date(nowSeconds * 1000);
    const { amzDate, dateStamp } = formatAmzDate(nowDate);
    const parsedUrl = new URL(`${this.endpoint}/${this.bucket}/${metadata.key}`);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const credential = `${this.accessKeyId}/${credentialScope}`;

    const queryParams = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(ttlSeconds),
      'X-Amz-SignedHeaders': 'host',
    });
    queryParams.sort();

    const canonicalRequest = [
      'GET',
      parsedUrl.pathname,
      queryParams.toString(),
      `host:${parsedUrl.host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = deriveAwsSigningKey(this.secretAccessKey, dateStamp, this.region, 's3');
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    const signedUrl = `${parsedUrl.origin}${parsedUrl.pathname}?${queryParams.toString()}&X-Amz-Signature=${signature}`;
    return Object.freeze({
      signedUrl,
      expiresAt: new Date((nowSeconds + ttlSeconds) * 1000).toISOString(),
      ttlSeconds,
    });
  }

  async deletePrivateObject(key: string, ownerUserId: string): Promise<boolean> {
    await this.headPrivateObject(key, ownerUserId).catch((err) => {
      if (err instanceof AppError && err.code === 'NOT_FOUND') {
        return null;
      }
      throw err;
    });

    const parsedUrl = new URL(`${this.endpoint}/${this.bucket}/${key}`);
    const headers = this.buildSignedHeaders({
      method: 'DELETE',
      canonicalUri: parsedUrl.pathname,
      host: parsedUrl.host,
      payloadHash: sha256Hex(''),
    });

    try {
      const res = await this.fetchImpl(parsedUrl.toString(), {
        method: 'DELETE',
        headers,
      });
      await this.fallback.deletePrivateObject(key, ownerUserId);
      return res.ok || res.status === 204;
    } catch {
      return this.fallback.deletePrivateObject(key, ownerUserId);
    }
  }
}

export function createObjectStorageFromEnv(
  env: Record<string, string | undefined> = process.env,
): ObjectStorage {
  if (env.NODE_ENV === 'test' || env.OBJECT_STORAGE_MODE === 'memory') {
    return new InMemoryObjectStorage();
  }
  const endpoint = env.OBJECT_STORAGE_ENDPOINT ?? env.R2_ENDPOINT;
  const bucket = env.OBJECT_STORAGE_BUCKET ?? 'kartik-private';
  const accessKeyId = env.OBJECT_STORAGE_ACCESS_KEY ?? env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.OBJECT_STORAGE_SECRET_KEY ?? env.R2_SECRET_ACCESS_KEY;

  const fsStorage = new FileSystemObjectStorage({
    rootDir: env.OBJECT_STORAGE_DIR ?? '.data/object-storage',
    baseEndpoint: endpoint ? `${endpoint.replace(/\/+$/, '')}/${bucket}` : undefined,
  });

  if (endpoint && accessKeyId && secretAccessKey) {
    return new S3CompatibleObjectStorage({
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
      region: env.OBJECT_STORAGE_REGION ?? 'auto',
      fallbackStorage: fsStorage,
    });
  }

  return fsStorage;
}

