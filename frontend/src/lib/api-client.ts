import type {
  AuthenticatedUserProfile,
  ChatMessageItem,
  ClientRecoveryAction,
  ConversationSummary,
  CreditBalanceSnapshot,
  FrontendErrorCode,
  SendMessageTurnResponse,
  SpecialistAgentName,
} from '../types/index.js';

/**
 * Authoritative client recovery policy per Blueprint §5.5 Error Catalogue.
 *
 * Highlights:
 * - `BILLING_UNAVAILABLE` (`503`): `retry_same_key` (safe to retry with the exact same `Idempotency-Key`).
 * - `EXECUTION_UNKNOWN` (`409`): `do_not_retry` (never blindly retry an ambiguous provider completion).
 * - `PROVIDER_TIMEOUT` / `PROVIDER_UNAVAILABLE` / `ARTIFACT_INVALID`: `retry_new_key` (previous reservation was released).
 */
export const ERROR_RECOVERY_POLICY: Readonly<
  Record<FrontendErrorCode, ClientRecoveryAction>
> = Object.freeze({
  VALIDATION_FAILED: 'do_not_retry',
  INVALID_CURSOR: 'restart_list',
  IDEMPOTENCY_KEY_REQUIRED: 'retry_new_key',
  PAYMENT_VERIFICATION_FAILED: 'do_not_retry',
  UNAUTHENTICATED: 'reauthenticate',
  QUOTA_EXHAUSTED: 'top_up_quota',
  FORBIDDEN: 'do_not_retry',
  DEMO_READ_ONLY: 'read_only_mode',
  NOT_FOUND: 'do_not_retry',
  RESOURCE_IN_USE: 'back_off',
  IDEMPOTENCY_CONFLICT: 'retry_new_key',
  EXECUTION_UNKNOWN: 'do_not_retry',
  RATE_LIMITED: 'back_off',
  INTERNAL_ERROR: 'do_not_retry',
  ARTIFACT_INVALID: 'retry_new_key',
  LIMITER_UNAVAILABLE: 'back_off',
  PROVIDER_UNAVAILABLE: 'retry_new_key',
  BILLING_UNAVAILABLE: 'retry_same_key',
  PROVIDER_TIMEOUT: 'retry_new_key',
});

export function resolveClientRecoveryAction(
  code: FrontendErrorCode,
): ClientRecoveryAction {
  return ERROR_RECOVERY_POLICY[code] ?? 'do_not_retry';
}

/**
 * Generates a high-entropy client-owned `Idempotency-Key` (`requestId`) per Invariant #15 & §8.3:
 * "Never generate or rewrite `requestId` on the server. It belongs to the client."
 */
export function generateClientIdempotencyKey(prefix = 'req'): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '') || 'req';
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `${cleanPrefix}_${globalThis.crypto.randomUUID()}`;
  }
  const fallbackHex = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
  return `${cleanPrefix}_${fallbackHex}`;
}

export class GatewayApiError extends Error {
  public readonly statusCode: number;
  public readonly code: FrontendErrorCode;
  public readonly traceId: string;
  public readonly requestId: string | undefined;
  public readonly recoveryAction: ClientRecoveryAction;
  public readonly retryAfterSeconds: number | null;
  public readonly details: Readonly<Record<string, readonly string[]>> | undefined;

  constructor(params: {
    readonly statusCode: number;
    readonly code: FrontendErrorCode;
    readonly message: string;
    readonly traceId: string;
    readonly requestId?: string;
    readonly retryAfterSeconds?: number | null;
    readonly details?: Readonly<Record<string, readonly string[]>>;
  }) {
    super(params.message);
    this.name = 'GatewayApiError';
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.traceId = params.traceId;
    this.requestId = params.requestId;
    this.recoveryAction = resolveClientRecoveryAction(params.code);
    this.retryAfterSeconds = params.retryAfterSeconds ?? null;
    this.details = params.details;
  }
}

export interface HttpTransportRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly headers: Readonly<Record<string, string>>;
  readonly credentials: 'include';
  readonly body?: string;
}

export interface HttpTransportResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly json: () => Promise<unknown>;
}

export type HttpTransport = (
  request: HttpTransportRequest,
) => Promise<HttpTransportResponse>;

export interface KartikGatewayClientOptions {
  readonly baseUrl?: string;
  readonly transport?: HttpTransport;
  readonly idempotencyKeyGenerator?: (prefix?: string) => string;
}

export interface PaginatedFrontendResult<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly traceId: string;
}

/**
 * Typed Browser-to-Gateway API Client (`@kartik/frontend/lib/api-client`, Micro-step 7.1.a).
 *
 * Enforces:
 * - Invariant #1: All browser traffic targets `/api/v1/*` on the API Gateway; never calls `/internal/*`
 *   or private microservice ports (`4001..4004`).
 * - Invariant #11 & ADR 0002: Uses `credentials: 'include'` so `HttpOnly` session cookies are sent
 *   automatically by the browser without JavaScript ever reading raw session tokens.
 * - Invariant #15: Attaches a client-owned `Idempotency-Key` header on every mutating request (`POST`,
 *   `PUT`, `PATCH`, `DELETE`) and preserves the caller's key across safe retries (`BILLING_UNAVAILABLE`).
 */
export class KartikGatewayClient {
  private readonly baseUrl: string;
  private readonly transport: HttpTransport;
  private readonly generateKey: (prefix?: string) => string;

  constructor(options: KartikGatewayClientOptions = {}) {
    const rawBase = (options.baseUrl ?? '/api/v1').trim().replace(/\/+$/, '');
    if (rawBase.includes('/internal')) {
      throw new Error(
        'Invariant #1 & #14 violation: Frontend client must never target /internal routes',
      );
    }
    this.baseUrl = rawBase || '/api/v1';
    this.generateKey =
      options.idempotencyKeyGenerator ?? generateClientIdempotencyKey;
    this.transport =
      options.transport ??
      (async (req) => {
        const res = await globalThis.fetch(req.url, {
          method: req.method,
          headers: req.headers,
          credentials: req.credentials,
          ...(req.body !== undefined ? { body: req.body } : {}),
        });
        const retryAfter = res.headers.get('retry-after') ?? undefined;
        return {
          status: res.status,
          headers: { 'retry-after': retryAfter },
          json: () => res.json(),
        };
      });
  }

  public async request<T>(params: {
    readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    readonly path: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly keyPrefix?: string;
  }): Promise<{
    readonly data: T;
    readonly traceId: string;
    readonly requestId: string | undefined;
    readonly nextCursor: string | null;
  }> {
    const normalizedPath = params.path.startsWith('/')
      ? params.path
      : `/${params.path}`;
    if (
      normalizedPath === '/internal' ||
      normalizedPath.startsWith('/internal/')
    ) {
      throw new Error(
        'Invariant #14 violation: Browser client is forbidden from calling /internal/* endpoints',
      );
    }

    const isMutating = params.method !== 'GET';
    const effectiveIdempotencyKey = isMutating
      ? (params.idempotencyKey?.trim() ||
        this.generateKey(params.keyPrefix ?? 'req'))
      : undefined;

    const headers: Record<string, string> = {
      accept: 'application/json',
    };
    if (params.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (effectiveIdempotencyKey) {
      headers['Idempotency-Key'] = effectiveIdempotencyKey;
    }

    const response = await this.transport({
      url: `${this.baseUrl}${normalizedPath}`,
      method: params.method,
      headers,
      credentials: 'include',
      ...(params.body !== undefined
        ? { body: JSON.stringify(params.body) }
        : {}),
    });

    const rawJson = (await response.json()) as Record<string, unknown>;
    const traceId =
      typeof rawJson?.traceId === 'string' ? rawJson.traceId : 'trace_unknown';
    const requestId =
      typeof rawJson?.requestId === 'string'
        ? rawJson.requestId
        : effectiveIdempotencyKey;
    const metaObj =
      typeof rawJson?.meta === 'object' && rawJson.meta !== null
        ? (rawJson.meta as { nextCursor?: string | null })
        : undefined;
    const nextCursor =
      typeof metaObj?.nextCursor === 'string' ? metaObj.nextCursor : null;

    if (response.status >= 400 || rawJson?.error) {
      const errObj = (rawJson?.error ?? {}) as {
        code?: FrontendErrorCode;
        message?: string;
        details?: Record<string, readonly string[]>;
      };
      const retryHeader =
        response.headers?.['Retry-After'] ?? response.headers?.['retry-after'];
      const retryAfterSeconds =
        retryHeader && !Number.isNaN(Number(retryHeader))
          ? Number(retryHeader)
          : null;

      throw new GatewayApiError({
        statusCode: response.status,
        code: errObj.code ?? 'INTERNAL_ERROR',
        message: errObj.message ?? `Request failed with status ${response.status}`,
        traceId,
        requestId,
        retryAfterSeconds,
        details: errObj.details,
      });
    }

    return Object.freeze({
      data: rawJson.data as T,
      traceId,
      requestId,
      nextCursor,
    });
  }

  public async loginWithGoogle(idToken: string): Promise<AuthenticatedUserProfile> {
    const res = await this.request<{ readonly user: AuthenticatedUserProfile }>({
      method: 'POST',
      path: '/auth/google',
      body: { idToken },
      keyPrefix: 'req_auth',
    });
    return res.data.user;
  }

  public async getCurrentUser(): Promise<AuthenticatedUserProfile> {
    const res = await this.request<{ readonly user: AuthenticatedUserProfile }>({
      method: 'GET',
      path: '/auth/me',
    });
    return res.data.user;
  }

  public async logout(): Promise<void> {
    await this.request({
      method: 'POST',
      path: '/auth/logout',
      keyPrefix: 'req_logout',
    });
  }

  public async createConversation(
    title: string,
    idempotencyKey?: string,
  ): Promise<ConversationSummary> {
    const res = await this.request<ConversationSummary>({
      method: 'POST',
      path: '/conversations',
      body: { title },
      idempotencyKey,
      keyPrefix: 'req_conv',
    });
    return res.data;
  }

  public async listConversations(options?: {
    readonly limit?: number;
    readonly cursor?: string | null;
  }): Promise<PaginatedFrontendResult<ConversationSummary>> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.cursor) {
      params.set('cursor', options.cursor);
    }
    const qs = params.toString();
    const res = await this.request<{
      readonly items: readonly ConversationSummary[];
    }>({
      method: 'GET',
      path: `/conversations${qs ? `?${qs}` : ''}`,
    });
    return Object.freeze({
      items: res.data.items,
      nextCursor: res.nextCursor,
      traceId: res.traceId,
    });
  }

  public async sendMessage(input: {
    readonly conversationId: string;
    readonly prompt: string;
    readonly requestedAgent?: SpecialistAgentName;
    readonly attachmentFileIds?: readonly string[];
    readonly idempotencyKey?: string;
  }): Promise<SendMessageTurnResponse> {
    const res = await this.request<SendMessageTurnResponse>({
      method: 'POST',
      path: `/conversations/${encodeURIComponent(input.conversationId)}/messages`,
      body: {
        prompt: input.prompt,
        ...(input.requestedAgent ? { requestedAgent: input.requestedAgent } : {}),
        ...(input.attachmentFileIds
          ? { attachmentFileIds: input.attachmentFileIds }
          : {}),
      },
      idempotencyKey: input.idempotencyKey,
      keyPrefix: 'req_msg',
    });
    return res.data;
  }

  public async deleteConversation(
    conversationId: string,
    idempotencyKey?: string,
  ): Promise<void> {
    await this.request({
      method: 'DELETE',
      path: `/conversations/${encodeURIComponent(conversationId)}`,
      idempotencyKey,
      keyPrefix: 'req_del',
    });
  }

  public async getCreditBalance(): Promise<CreditBalanceSnapshot> {
    const res = await this.request<CreditBalanceSnapshot>({
      method: 'GET',
      path: '/billing/balance',
    });
    return res.data;
  }
}
