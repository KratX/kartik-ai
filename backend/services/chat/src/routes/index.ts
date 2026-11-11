import crypto from 'node:crypto';
import { INTERNAL_AUTH_HEADERS } from '@kartik/shared/auth';
import {
  AppError,
  createSuccessEnvelope,
  mapErrorToHttpResponse,
} from '@kartik/shared/errors';
import {
  InMemoryRateLimitStore,
  type RateLimitCounterStore,
} from '@kartik/shared';
import { RedisKeys } from '@kartik/shared/redis';
import type { ChatConfig } from '../config/index.js';
import { ChatController } from '../controllers/index.js';
import {
  enforceChatDemoReadOnly,
  readSingleHeader,
  requireChatUserContext,
  type HttpHeaderMap,
} from '../middleware/index.js';
import type { ChatRepository } from '../repositories/index.js';
import type { ChatOrchestratorService } from '../services/index.js';

export interface ChatHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers?: HttpHeaderMap;
  readonly body?: unknown;
}

export interface ChatHttpResponse<T = unknown> {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: T;
}

export interface ChatRouterDependencies {
  readonly config: ChatConfig;
  readonly repository: ChatRepository;
  readonly orchestrator: ChatOrchestratorService;
  readonly rateLimitStore?: RateLimitCounterStore;
  readonly maxRequestsPerMinute?: number;
  readonly checkReadiness?: () => Promise<boolean>;
  readonly nowSeconds?: () => number;
}

function parseRoutePathAndQuery(rawPath: string): {
  readonly routePath: string;
  readonly query: URLSearchParams;
} {
  const [pathPart = '/', queryPart = ''] = rawPath.split('?');
  const trimmed = pathPart.replace(/\/+$/, '') || '/';
  const routePath = trimmed.startsWith('/api/v1/')
    ? trimmed.slice('/api/v1'.length)
    : trimmed;
  return {
    routePath,
    query: new URLSearchParams(queryPart),
  };
}

/**
 * Creates the HTTP router for `@kartik/chat` (Micro-step 6.3.a — Phase 6 Exit Gate).
 *
 * Enforces:
 * - Health & readiness probes (`GET /healthz`, `GET /readyz`)
 * - Ed25519 `x-user-context` verification (`aud === "chat"`) on all user routes (§6.4)
 * - `DEMO_READ_ONLY` kill switch on mutating methods (`POST`, `DELETE`) (§12)
 * - Per-user fixed-window rate limiting (`rate:user:{userId}:chat`, 429 `RATE_LIMITED` + `Retry-After`)
 * - Standard response envelope carrying `traceId`, `requestId`, and `nextCursor` (§5.4)
 */
export function createChatRouter(deps: ChatRouterDependencies) {
  const controller = new ChatController({
    config: deps.config,
    repository: deps.repository,
    orchestrator: deps.orchestrator,
    checkReadiness: deps.checkReadiness,
  });

  const rateLimitStore = deps.rateLimitStore ?? new InMemoryRateLimitStore();
  const maxRequestsPerMinute = deps.maxRequestsPerMinute ?? 60;

  async function enforceUserRateLimit(userId: string): Promise<void> {
    const nowSec = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    const windowBucket = String(Math.floor(nowSec / 60));
    const spec = RedisKeys.userRateLimit('chat', userId, windowBucket, 60);
    const result = await rateLimitStore.incrementAndGet(spec);
    if (result.count > maxRequestsPerMinute) {
      throw new AppError(
        'RATE_LIMITED',
        'Too many chat requests; please retry shortly',
        { retryAfterSeconds: result.ttlSeconds },
      );
    }
  }

  async function execute<T = unknown>(
    req: ChatHttpRequest,
  ): Promise<ChatHttpResponse<T>> {
    const headers = req.headers ?? {};
    const traceId =
      readSingleHeader(headers, INTERNAL_AUTH_HEADERS.TRACE_ID) ??
      `trace_${crypto.randomBytes(8).toString('hex')}`;
    const requestId =
      readSingleHeader(headers, INTERNAL_AUTH_HEADERS.REQUEST_ID) ??
      readSingleHeader(headers, 'idempotency-key');

    try {
      const method = req.method.toUpperCase();
      const { routePath, query } = parseRoutePathAndQuery(req.path);

      if (method === 'GET' && routePath === '/healthz') {
        const data = controller.getHealthz();
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: createSuccessEnvelope(traceId, data, { requestId }) as T,
        };
      }

      if (method === 'GET' && routePath === '/readyz') {
        const data = await controller.getReadyz();
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: createSuccessEnvelope(traceId, data, { requestId }) as T,
        };
      }

      // Verify Ed25519 x-user-context assertion (expectedAudience: 'chat')
      const claims = requireChatUserContext(
        headers,
        deps.config,
        deps.nowSeconds?.(),
      );
      const effectiveTraceId = claims.traceId || traceId;

      // Enforce DEMO_READ_ONLY kill switch on mutating methods (§12)
      enforceChatDemoReadOnly(method, deps.config);

      // Enforce per-user fixed-window rate limit (§5.2)
      await enforceUserRateLimit(claims.sub);

      if (method === 'POST' && routePath === '/conversations') {
        const created = await controller.createConversation({
          userId: claims.sub,
          requestId,
          body: req.body,
        });
        return {
          statusCode: 201,
          headers: { 'content-type': 'application/json' },
          body: createSuccessEnvelope(effectiveTraceId, created, {
            requestId,
          }) as T,
        };
      }

      if (method === 'GET' && routePath === '/conversations') {
        const page = await controller.listConversations({
          userId: claims.sub,
          limit: query.get('limit') ?? undefined,
          cursor: query.get('cursor') ?? undefined,
        });
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: createSuccessEnvelope(
            effectiveTraceId,
            { items: page.items },
            {
              requestId,
              nextCursor: page.nextCursor,
            },
          ) as T,
        };
      }

      // Match /conversations/:conversationId/messages
      const messagesMatch = /^\/conversations\/([^/]+)\/messages$/.exec(
        routePath,
      );
      if (messagesMatch && messagesMatch[1]) {
        const conversationId = decodeURIComponent(messagesMatch[1]);
        if (method === 'GET') {
          const page = await controller.listMessages({
            userId: claims.sub,
            conversationId,
            limit: query.get('limit') ?? undefined,
            cursor: query.get('cursor') ?? undefined,
          });
          return {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: createSuccessEnvelope(
              effectiveTraceId,
              { items: page.items },
              {
                requestId,
                nextCursor: page.nextCursor,
              },
            ) as T,
          };
        }

        if (method === 'POST') {
          const turnResult = await controller.sendMessage({
            userId: claims.sub,
            conversationId,
            requestId,
            traceId: effectiveTraceId,
            body: req.body,
          });
          return {
            statusCode: turnResult.idempotentReplay ? 200 : 201,
            headers: { 'content-type': 'application/json' },
            body: createSuccessEnvelope(effectiveTraceId, turnResult, {
              requestId: turnResult.requestId,
            }) as T,
          };
        }
      }

      // Match /conversations/:conversationId
      const convMatch = /^\/conversations\/([^/]+)$/.exec(routePath);
      if (convMatch && convMatch[1]) {
        const conversationId = decodeURIComponent(convMatch[1]);
        if (method === 'GET') {
          const conv = await controller.getConversation(
            claims.sub,
            conversationId,
          );
          return {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: createSuccessEnvelope(effectiveTraceId, conv, {
              requestId,
            }) as T,
          };
        }

        if (method === 'DELETE') {
          const deleted = await controller.deleteConversation({
            userId: claims.sub,
            conversationId,
            requestId,
            traceId: effectiveTraceId,
          });
          return {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: createSuccessEnvelope(effectiveTraceId, deleted, {
              requestId,
            }) as T,
          };
        }
      }

      throw new AppError(
        'NOT_FOUND',
        `Route ${method} ${routePath} not found on chat service`,
      );
    } catch (err) {
      const mapped = mapErrorToHttpResponse(err, { traceId, requestId });
      return {
        statusCode: mapped.httpStatus,
        headers: {
          'content-type': 'application/json',
          ...mapped.headers,
        },
        body: mapped.body as T,
      };
    }
  }

  return Object.freeze({
    controller,
    execute,
  });
}
