/**
 * Kartik.ai — Standard Error Catalogue, AppError & Response Envelope (`@kartik/shared/errors`)
 * Blueprint §5.4, §5.5, §7.2 (Phase 1 Exit Gate), and §13 (Sprint Step 7).
 *
 * Pure TypeScript, zero external dependencies (ADR 0005).
 * Rules enforced:
 * 1. Exact 19 normative error codes with fixed HTTP status codes and client actions (§5.5).
 * 2. Anti-enumeration rule: missing resources and foreign-owned resources both use `NOT_FOUND` (404).
 * 3. Single response envelope (`{ requestId?, traceId, data, meta: { nextCursor }, error }`) (§5.4).
 * 4. Unknown runtime exceptions map to `500 INTERNAL_ERROR` with a generic safe message — never leaking stack traces, provider messages, or database paths.
 */

export const ERROR_CATALOGUE = {
  VALIDATION_FAILED: { httpStatus: 400, clientAction: 'Fix the request' },
  INVALID_CURSOR: { httpStatus: 400, clientAction: 'Restart the list' },
  IDEMPOTENCY_KEY_REQUIRED: { httpStatus: 400, clientAction: 'Retry with a key' },
  PAYMENT_VERIFICATION_FAILED: { httpStatus: 400, clientAction: 'Do not retry; report with traceId' },
  UNAUTHENTICATED: { httpStatus: 401, clientAction: 'Sign in again' },
  QUOTA_EXHAUSTED: { httpStatus: 402, clientAction: 'Top up or wait for the window' },
  FORBIDDEN: { httpStatus: 403, clientAction: 'Do not retry' },
  DEMO_READ_ONLY: { httpStatus: 403, clientAction: 'Browse only; do not retry' },
  NOT_FOUND: { httpStatus: 404, clientAction: 'Do not retry' },
  RESOURCE_IN_USE: { httpStatus: 409, clientAction: 'Retry after it finishes' },
  IDEMPOTENCY_CONFLICT: { httpStatus: 409, clientAction: 'New key' },
  EXECUTION_UNKNOWN: { httpStatus: 409, clientAction: 'New key; never blind retry' },
  RATE_LIMITED: { httpStatus: 429, clientAction: 'Back off' },
  INTERNAL_ERROR: { httpStatus: 500, clientAction: 'Report with traceId' },
  ARTIFACT_INVALID: { httpStatus: 502, clientAction: 'Retry with a new key' },
  LIMITER_UNAVAILABLE: { httpStatus: 503, clientAction: 'Retry later' },
  PROVIDER_UNAVAILABLE: { httpStatus: 503, clientAction: 'Retry later with a new key' },
  BILLING_UNAVAILABLE: { httpStatus: 503, clientAction: 'Retry with the same key' },
  PROVIDER_TIMEOUT: { httpStatus: 504, clientAction: 'Retry later with a new key' },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

export interface ApiErrorPayload {
  code: ErrorCode;
  message: string;
  details?: Record<string, string[]>;
}

export interface ApiResponseEnvelope<T> {
  requestId?: string;
  traceId: string;
  data: T | null;
  meta: {
    nextCursor: string | null;
  };
  error: ApiErrorPayload | null;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, string[]>;
  public readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      details?: Record<string, string[]>;
      retryAfterSeconds?: number;
      cause?: unknown;
    }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = ERROR_CATALOGUE[code].httpStatus;
    if (options?.details) {
      this.details = options.details;
    }
    if (options?.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/**
 * Builds the canonical success envelope from Blueprint §5.4.
 */
export function createSuccessEnvelope<T>(
  traceId: string,
  data: T,
  options?: { requestId?: string; nextCursor?: string | null }
): ApiResponseEnvelope<T> {
  const envelope: ApiResponseEnvelope<T> = {
    traceId,
    data,
    meta: {
      nextCursor: options?.nextCursor ?? null,
    },
    error: null,
  };
  if (options?.requestId) {
    envelope.requestId = options.requestId;
  }
  return envelope;
}

/**
 * Maps any error (`AppError` or unexpected runtime exception) to its HTTP status, headers, and safe response envelope (§5.4 & §5.5).
 * Never exposes stack traces, database paths, or raw provider messages from untyped errors.
 */
export function mapErrorToHttpResponse(
  error: unknown,
  context: { traceId: string; requestId?: string }
): {
  httpStatus: number;
  headers: Record<string, string>;
  body: ApiResponseEnvelope<null>;
} {
  const appErr = isAppError(error)
    ? error
    : new AppError('INTERNAL_ERROR', 'An unexpected server error occurred. Please report with traceId.');

  const headers: Record<string, string> = {};
  if (appErr.code === 'RATE_LIMITED' && appErr.retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(Math.max(1, Math.ceil(appErr.retryAfterSeconds)));
  }

  const errorPayload: ApiErrorPayload = {
    code: appErr.code,
    message: appErr.message,
  };
  if (appErr.details) {
    errorPayload.details = appErr.details;
  }

  const body: ApiResponseEnvelope<null> = {
    traceId: context.traceId,
    data: null,
    meta: { nextCursor: null },
    error: errorPayload,
  };
  if (context.requestId) {
    body.requestId = context.requestId;
  }

  return {
    httpStatus: appErr.httpStatus,
    headers,
    body,
  };
}
