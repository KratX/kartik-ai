#!/usr/bin/env node
/**
 * @file scripts/start-local-stack.mjs
 * @description Single-command Local Full-Stack HTTP Server Runner (Micro-step 8.5.a).
 * Boots the API Gateway (`createManagedHttpServer`) wired to deterministic in-memory
 * Auth, Chat, Agent, and Billing handlers so developers can test `/healthz`, `/readyz`,
 * and `/api/v1/*` routes over real HTTP (`http://127.0.0.1:8000`) with zero external keys.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  createSuccessEnvelope,
  generateEd25519KeyPair,
  INTERNAL_AUTH_HEADERS,
  verifyUserContextAssertion,
} from '../backend/shared/dist/index.js';
import {
  createGatewayRouter,
  createManagedHttpServer,
  InMemoryUpstreamHttpClient,
  loadGatewayConfig,
} from '../backend/gateway/dist/src/index.js';

export const DEMO_LOCAL_SESSION = Object.freeze({
  sessionId: 'sess_demo_local_001',
  userId: 'usr_demo_001',
  email: 'demo@kartik.ai',
  displayName: 'Kartik Demo User',
  avatarUrl: null,
  expiresAt: '2027-12-31T23:59:59.000Z',
});

/**
 * Starts the local multi-service Gateway HTTP server.
 *
 * @param {{ port?: number; host?: string; demoReadOnly?: boolean }} [options]
 */
export async function startLocalStackServer(options = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 8000);
  const host = options.host ?? '127.0.0.1';
  const demoReadOnly = options.demoReadOnly ?? process.env.DEMO_READ_ONLY === 'true';

  const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();

  const config = loadGatewayConfig({
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    SERVICE_TO_SERVICE_TOKEN:
      process.env.SERVICE_TO_SERVICE_TOKEN ?? 's2s-local-dev-stack-token-85a',
    USER_CONTEXT_SIGNING_KEY: privateKeyPem,
    CORS_ALLOWED_ORIGINS:
      process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000',
    DEMO_READ_ONLY: demoReadOnly ? 'true' : 'false',
  });

  let availableCredits = 200;
  const conversations = new Map([
    [
      'conv_demo_welcome_001',
      {
        conversationId: 'conv_demo_welcome_001',
        userId: DEMO_LOCAL_SESSION.userId,
        title: 'Welcome to Kartik.ai Architecture Walkthrough',
        deletionState: 'active',
        createdAt: '2026-11-09T00:00:00.000Z',
      },
    ],
  ]);
  const processedTurnsByRequestId = new Map();

  const upstream = new InMemoryUpstreamHttpClient();

  for (const svc of ['auth', 'chat', 'agent', 'billing']) {
    upstream.registerHandler(svc, 'GET', '/readyz', () => ({
      statusCode: 200,
      headers: {},
      body: { status: 'ready', service: svc },
    }));
  }

  // Auth routes
  upstream.registerHandler('auth', 'POST', '/auth/google', (req) => ({
    statusCode: 200,
    headers: {
      'set-cookie': `kartik_session=${DEMO_LOCAL_SESSION.sessionId}; Path=/; HttpOnly; SameSite=Lax`,
    },
    body: createSuccessEnvelope(
      req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID] ?? 'trc_local_auth',
      {
        user: {
          userId: DEMO_LOCAL_SESSION.userId,
          email: DEMO_LOCAL_SESSION.email,
          displayName: DEMO_LOCAL_SESSION.displayName,
          avatarUrl: DEMO_LOCAL_SESSION.avatarUrl,
        },
      },
    ),
  }));

  upstream.registerHandler('auth', 'POST', '/internal/sessions/introspect', (req) => {
    const body = req.body ?? {};
    if (body.sessionId === DEMO_LOCAL_SESSION.sessionId) {
      return {
        statusCode: 200,
        headers: {},
        body: createSuccessEnvelope('trc_introspect', DEMO_LOCAL_SESSION),
      };
    }
    return {
      statusCode: 401,
      headers: {},
      body: {
        traceId: 'trc_introspect',
        data: null,
        meta: { nextCursor: null },
        error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired session cookie' },
      },
    };
  });

  // Billing balance route
  upstream.registerHandler('billing', 'GET', '/billing/balance', (req) => {
    const claims = verifyUserContextAssertion(
      req.headers[INTERNAL_AUTH_HEADERS.USER_CONTEXT],
      publicKeyPem,
      { expectedAudience: 'billing' },
    );
    return {
      statusCode: 200,
      headers: {},
      body: createSuccessEnvelope(req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID], {
        userId: claims.sub,
        planId: 'plan_free_starter',
        availableCredits,
        reservedCredits: 0,
        billingMode: 'mock',
      }),
    };
  });

  // Chat conversations list & creation
  upstream.registerHandler('chat', 'GET', '/conversations', (req) => {
    const claims = verifyUserContextAssertion(
      req.headers[INTERNAL_AUTH_HEADERS.USER_CONTEXT],
      publicKeyPem,
      { expectedAudience: 'chat' },
    );
    const items = Array.from(conversations.values()).filter(
      (c) => c.userId === claims.sub && c.deletionState === 'active',
    );
    return {
      statusCode: 200,
      headers: {},
      body: createSuccessEnvelope(req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID], {
        items,
      }),
    };
  });

  upstream.registerHandler('chat', 'POST', '/conversations', (req) => {
    const claims = verifyUserContextAssertion(
      req.headers[INTERNAL_AUTH_HEADERS.USER_CONTEXT],
      publicKeyPem,
      { expectedAudience: 'chat' },
    );
    const requestId = req.headers[INTERNAL_AUTH_HEADERS.REQUEST_ID];
    const body = req.body ?? {};
    const conversationId = `conv_local_${conversations.size + 1}`;
    const record = {
      conversationId,
      userId: claims.sub,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'New Conversation',
      deletionState: 'active',
      createdAt: new Date().toISOString(),
    };
    conversations.set(conversationId, record);
    return {
      statusCode: 201,
      headers: {},
      body: createSuccessEnvelope(
        req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID],
        record,
        { requestId },
      ),
    };
  });

  upstream.registerHandler(
    'chat',
    'POST',
    '/conversations/conv_demo_welcome_001/messages',
    (req) => {
      verifyUserContextAssertion(
        req.headers[INTERNAL_AUTH_HEADERS.USER_CONTEXT],
        publicKeyPem,
        { expectedAudience: 'chat' },
      );
      const requestId = req.headers[INTERNAL_AUTH_HEADERS.REQUEST_ID];
      const traceId = req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID];

      if (processedTurnsByRequestId.has(requestId)) {
        return {
          statusCode: 200,
          headers: {},
          body: createSuccessEnvelope(
            traceId,
            {
              ...processedTurnsByRequestId.get(requestId),
              idempotentReplay: true,
            },
            { requestId },
          ),
        };
      }

      const body = req.body ?? {};
      const prompt = String(body.prompt ?? '');
      availableCredits = Math.max(0, availableCredits - 5);

      const payload = {
        conversationId: 'conv_demo_welcome_001',
        requestId,
        traceId,
        remainingCredits: availableCredits,
        idempotentReplay: false,
        assistantMessage: {
          messageId: `msg_local_${processedTurnsByRequestId.size + 1}`,
          role: 'assistant',
          agentUsed: /code|build|widget/i.test(prompt) ? 'coding' : 'chat',
          content: `[MOCK_AI=true] Processed turn for prompt: "${prompt}"`,
          citations: [],
          artifactIds: [],
        },
      };
      processedTurnsByRequestId.set(requestId, payload);

      return {
        statusCode: 201,
        headers: {},
        body: createSuccessEnvelope(traceId, payload, { requestId }),
      };
    },
  );

  const router = createGatewayRouter({
    config,
    upstreamClient: upstream,
  });

  const server = createManagedHttpServer({
    serviceName: 'gateway',
    router,
  });

  const bound = await server.listen(port, host);
  return {
    port: bound.port,
    host: bound.host,
    baseUrl: `http://${bound.host}:${bound.port}`,
    demoSessionCookie: `kartik_session=${DEMO_LOCAL_SESSION.sessionId}`,
    demoUser: DEMO_LOCAL_SESSION,
    close: () => server.close(),
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  startLocalStackServer()
    .then((stack) => {
      console.log(`Kartik.ai local stack listening on ${stack.baseUrl}`);
      console.log(`  Health check : ${stack.baseUrl}/healthz`);
      console.log(`  Ready check  : ${stack.baseUrl}/readyz`);
      console.log(`  Demo cookie  : ${stack.demoSessionCookie}`);
    })
    .catch((err) => {
      console.error('Failed to start local stack:', err);
      process.exit(1);
    });
}
