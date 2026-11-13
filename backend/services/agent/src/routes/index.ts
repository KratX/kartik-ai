import crypto from 'node:crypto';
import { INTERNAL_AUTH_HEADERS } from '@kartik/shared/auth';
import {
  AppError,
  createSuccessEnvelope,
  mapErrorToHttpResponse,
} from '@kartik/shared/errors';
import type { AgentConfig } from '../config/index.js';
import { AgentController } from '../controllers/index.js';
import type { AgentGraphExecutor } from '../graph/index.js';
import {
  readSingleHeader,
  requireAgentServiceAuth,
  requireAgentUserContext,
  type HttpHeaderMap,
} from '../middleware/index.js';
import type { FileIngestionAndArtifactService } from '../rag/index.js';
import type { AgentRepository } from '../repositories/index.js';

export interface AgentHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers?: HttpHeaderMap;
  readonly body?: unknown;
}

export interface AgentHttpResponse<T = unknown> {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: T;
}

export interface AgentRouterDependencies {
  readonly config: AgentConfig;
  readonly repository: AgentRepository;
  readonly ingestionService: FileIngestionAndArtifactService;
  readonly graphExecutor: AgentGraphExecutor;
  readonly checkReadiness?: () => Promise<boolean>;
  readonly nowSeconds?: () => number;
}

function normalizeAgentRoutePath(rawPath: string): string {
  const withoutQuery = (rawPath.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
  if (withoutQuery.startsWith('/api/v1/')) {
    return withoutQuery.slice('/api/v1'.length);
  }
  return withoutQuery;
}

/**
 * Creates the HTTP router for `@kartik/agent` (Micro-step 5.4.a — Phase 5 Exit Gate).
 *
 * Separates:
 * 1. Health & readiness probes (`GET /healthz`, `GET /readyz`)
 * 2. Public user-scoped routes (`POST /files`, `GET /files`, `GET /files/:fileId`, `GET /artifacts/:artifactId`)
 *    protected by Ed25519 `x-user-context` (`aud === "agent"`)
 * 3. Internal Chat-to-Agent routes (`POST /internal/agent/execute`, `POST /internal/agent/purge`)
 *    protected by constant-time `x-service-caller: chat` + `x-service-token` verification.
 */
export function createAgentRouter(deps: AgentRouterDependencies) {
  const controller = new AgentController({
    repository: deps.repository,
    ingestionService: deps.ingestionService,
    graphExecutor: deps.graphExecutor,
    checkReadiness: deps.checkReadiness,
  });

  async function execute<T = unknown>(
    req: AgentHttpRequest,
  ): Promise<AgentHttpResponse<T>> {
    const headers = req.headers ?? {};
    const traceId =
      readSingleHeader(headers, INTERNAL_AUTH_HEADERS.TRACE_ID) ??
      `trace_${crypto.randomBytes(8).toString('hex')}`;
    const requestId = readSingleHeader(headers, INTERNAL_AUTH_HEADERS.REQUEST_ID);

    try {
      const method = req.method.toUpperCase();
      const routePath = normalizeAgentRoutePath(req.path);

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

      // Public user routes (forwarded by Gateway with Ed25519 x-user-context aud="agent")
      if (method === 'POST' && (routePath === '/files' || routePath === '/files/upload')) {
        const claims = requireAgentUserContext(
          headers,
          deps.config,
          deps.nowSeconds?.(),
        );
        const file = await controller.uploadFile(claims.sub, req.body);
        return {
          statusCode: 201,
          headers: { 'content-type': 'application/json' },
          body: createSuccessEnvelope(claims.traceId || traceId, file, {
            requestId,
          }) as T,
        };
      }

      if (method === 'GET' && routePath === '/files') {
        const claims = requireAgentUserContext(
          headers,
          deps.config,
          deps.nowSeconds?.(),
        );
        const list = await controller.listFiles(claims.sub);
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: createSuccessEnvelope(claims.traceId || traceId, list, {
            requestId,
          }) as T,
        };
      }

      if (method === 'GET' && routePath.startsWith('/files/')) {
        const fileId = routePath.slice('/files/'.length).trim();
        const claims = requireAgentUserContext(
          headers,
          deps.config,
          deps.nowSeconds?.(),
        );
        const result = await controller.getFile(claims.sub, fileId);
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: createSuccessEnvelope(claims.traceId || traceId, result, {
            requestId,
          }) as T,
        };
      }

      if (
        method === 'GET' &&
        routePath.startsWith('/artifacts/') &&
        routePath.endsWith('/content')
      ) {
        const artifactId = routePath
          .slice('/artifacts/'.length, -'/content'.length)
          .replace(/\/+$/, '')
          .trim();
        const claims = requireAgentUserContext(
          headers,
          deps.config,
          deps.nowSeconds?.(),
        );
        const result = await controller.getArtifactContent(claims.sub, artifactId);
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: createSuccessEnvelope(claims.traceId || traceId, result, {
            requestId,
          }) as T,
        };
      }

      if (method === 'GET' && routePath.startsWith('/artifacts/')) {
        const artifactId = routePath.slice('/artifacts/'.length).trim();
        const claims = requireAgentUserContext(
          headers,
          deps.config,
          deps.nowSeconds?.(),
        );
        const result = await controller.getArtifact(claims.sub, artifactId);
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: createSuccessEnvelope(claims.traceId || traceId, result, {
            requestId,
          }) as T,
        };
      }

      // Internal Chat -> Agent routes (Invariant #14)
      if (method === 'POST' && routePath === '/internal/agent/execute') {
        requireAgentServiceAuth(headers, deps.config);
        const result = await controller.executeInternalTurn(req.body);
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: createSuccessEnvelope(traceId, result, {
            requestId: result.requestId || requestId,
          }) as T,
        };
      }

      if (method === 'POST' && routePath === '/internal/agent/purge') {
        requireAgentServiceAuth(headers, deps.config);
        const report = await controller.purgeInternalResources(req.body);
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: createSuccessEnvelope(traceId, report, { requestId }) as T,
        };
      }

      throw new AppError(
        'NOT_FOUND',
        `Route ${method} ${routePath} not found on agent service`,
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
