/**
 * @file server.ts
 * @description Kartik.ai Full-Stack Express + Vite Platform Server (Port 3000, Micro-step 9.3.a).
 *
 * Mounts:
 * 1. Health & Readiness probes (`GET /healthz`, `GET /readyz`)
 * 2. Public Gateway API (`/api/v1/*`) backed by `sharedPlatformRuntime` (`@kartik/agent` with
 *    `LiveGemini*Provider`, `AgentSlidingWindowRateLimiter`, `FileIngestionAndArtifactService`,
 *    `@kartik/billing`, `@kartik/auth`, and `@kartik/chat`)
 * 3. Direct Binary Artifact Streaming (`GET /api/v1/artifacts/:artifactId/raw`) delivering real
 *    `%PDF-1.4` (`application/pdf`), OpenXML `.pptx` (`PK\x03\x04`), and `.png` downloads
 * 4. Vite dev middleware in development or static `dist/` in production on Port 3000.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  createSuccessEnvelope,
  mapErrorToHttpResponse,
} from './backend/shared/errors/index.js';
import type { SpecialistAgentName } from './backend/shared/contracts/index.js';
import { sharedPlatformRuntime } from './src/server/platform-api-runtime.js';

function readHeaderString(req: Request, headerName: string): string | undefined {
  const raw = req.headers[headerName.toLowerCase()];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim().length > 0) {
    return raw[0].trim();
  }
  return undefined;
}

export function createKartikExpressApp() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  const sendEnvelope = <T>(
    req: Request,
    res: Response,
    statusCode: number,
    data: T,
    requestId?: string,
  ) => {
    const traceId =
      readHeaderString(req, 'x-trace-id') ??
      `trc_${crypto.randomBytes(8).toString('hex')}`;
    const resolvedReqId = requestId ?? readHeaderString(req, 'idempotency-key');
    res
      .status(statusCode)
      .json(createSuccessEnvelope(traceId, data, { requestId: resolvedReqId }));
  };

  const sendError = (req: Request, res: Response, err: unknown) => {
    const traceId =
      readHeaderString(req, 'x-trace-id') ??
      `trc_${crypto.randomBytes(8).toString('hex')}`;
    const requestId = readHeaderString(req, 'idempotency-key');
    const mapped = mapErrorToHttpResponse(err, { traceId, requestId });
    for (const [k, v] of Object.entries(mapped.headers)) {
      res.setHeader(k, v);
    }
    res.status(mapped.httpStatus).json(mapped.body);
  };

  // 1. Health & Readiness Probes
  app.get(['/healthz', '/api/v1/healthz'], (req, res) => {
    sendEnvelope(req, res, 200, { status: 'ok', service: 'gateway' });
  });

  app.get(['/readyz', '/api/v1/readyz'], (req, res) => {
    sendEnvelope(req, res, 200, {
      status: 'ready',
      service: 'gateway',
      upstreams: {
        auth: 'ready',
        chat: 'ready',
        agent: 'ready',
        billing: 'ready',
      },
    });
  });

  // 2. Auth Routes (/api/v1/auth/google, /api/v1/auth/me, /api/v1/auth/logout)
  app.post('/api/v1/auth/google', (req, res) => {
    try {
      const body = (req.body ?? {}) as { email?: string; displayName?: string };
      const session = sharedPlatformRuntime.loginWithGoogle(body);
      res.setHeader(
        'Set-Cookie',
        `kartik_session=${session.sessionId}; Path=/; HttpOnly; SameSite=Lax`,
      );
      sendEnvelope(req, res, 200, session);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.get('/api/v1/auth/me', (req, res) => {
    try {
      const status = sharedPlatformRuntime.getAuthStatus();
      sendEnvelope(req, res, 200, status);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.post('/api/v1/auth/logout', (req, res) => {
    try {
      const result = sharedPlatformRuntime.logout();
      res.setHeader('Set-Cookie', 'kartik_session=; Path=/; Max-Age=0; HttpOnly');
      sendEnvelope(req, res, 200, result);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  // 3. Demo Read-Only Toggle (/api/v1/demo/toggle-read-only)
  app.post('/api/v1/demo/toggle-read-only', (req, res) => {
    try {
      const body = (req.body ?? {}) as { enabled?: boolean };
      const result = sharedPlatformRuntime.toggleDemoReadOnly(body.enabled);
      sendEnvelope(req, res, 200, result);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  // 4. Conversations & Multi-Agent Turns
  app.get('/api/v1/conversations', (req, res) => {
    try {
      const list = sharedPlatformRuntime.listConversations();
      sendEnvelope(req, res, 200, list);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.post('/api/v1/conversations', (req, res) => {
    try {
      const body = (req.body ?? {}) as { title?: string };
      const conv = sharedPlatformRuntime.createConversation(body.title);
      sendEnvelope(req, res, 201, conv);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.get('/api/v1/conversations/:conversationId/messages', (req, res) => {
    try {
      const data = sharedPlatformRuntime.getConversationMessages(
        req.params.conversationId ?? '',
      );
      sendEnvelope(req, res, 200, data);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.post('/api/v1/conversations/:conversationId/messages', async (req, res) => {
    try {
      const requestId =
        readHeaderString(req, 'idempotency-key') ??
        readHeaderString(req, 'x-request-id') ??
        `req_${crypto.randomBytes(8).toString('hex')}`;
      const traceId =
        readHeaderString(req, 'x-trace-id') ??
        `trc_${crypto.randomBytes(8).toString('hex')}`;
      const body = (req.body ?? {}) as {
        prompt?: string;
        preferredAgent?: SpecialistAgentName;
        attachmentFileIds?: string[];
      };

      const turn = await sharedPlatformRuntime.sendMessageTurn({
        conversationId: req.params.conversationId ?? '',
        requestId,
        traceId,
        prompt: String(body.prompt ?? ''),
        preferredAgent: body.preferredAgent,
        attachmentFileIds: body.attachmentFileIds,
      });

      sendEnvelope(
        req,
        res,
        turn.idempotentReplay ? 200 : 201,
        turn,
        requestId,
      );
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.delete('/api/v1/conversations/:conversationId', async (req, res) => {
    try {
      const deleted = await sharedPlatformRuntime.deleteConversation(
        req.params.conversationId ?? '',
      );
      sendEnvelope(req, res, 200, deleted);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  // 5. File Upload & Listing (/api/v1/files, /api/v1/files/upload)
  app.post(['/api/v1/files', '/api/v1/files/upload'], async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        conversationId?: string;
        originalFilename?: string;
        declaredMimeType?: string;
        contentBase64?: string;
      };
      const uploaded = await sharedPlatformRuntime.uploadFile({
        conversationId: String(body.conversationId ?? 'conv_welcome_01'),
        originalFilename: String(body.originalFilename ?? ''),
        declaredMimeType: String(body.declaredMimeType ?? ''),
        contentBase64: String(body.contentBase64 ?? ''),
      });
      sendEnvelope(req, res, 201, uploaded);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.get('/api/v1/files', async (req, res) => {
    try {
      const list = await sharedPlatformRuntime.listFiles();
      sendEnvelope(req, res, 200, list);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  // 6. Artifacts & Direct Binary Streaming (/api/v1/artifacts/:artifactId, /content, /raw)
  app.get('/api/v1/artifacts/:artifactId/content', async (req, res) => {
    try {
      const data = await sharedPlatformRuntime.getArtifactContent(
        req.params.artifactId ?? '',
      );
      sendEnvelope(req, res, 200, data);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.get('/api/v1/artifacts/:artifactId/raw', async (req, res) => {
    try {
      const data = await sharedPlatformRuntime.getArtifactContent(
        req.params.artifactId ?? '',
      );
      const rawBuffer = Buffer.from(data.contentBase64, 'base64');
      const safeTitle = data.artifact.title
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 60) || 'kartik-artifact';
      const ext =
        data.artifact.artifactType === 'pdf_document'
          ? '.pdf'
          : data.artifact.artifactType === 'ppt_presentation'
            ? '.pptx'
            : data.artifact.artifactType === 'generated_image'
              ? '.png'
              : '.json';

      res.setHeader('Content-Type', data.artifact.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeTitle}${ext}"`,
      );
      res.setHeader('Content-Length', String(rawBuffer.byteLength));
      res.status(200).send(rawBuffer);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.get('/api/v1/artifacts/:artifactId', async (req, res) => {
    try {
      const data = await sharedPlatformRuntime.getArtifactContent(
        req.params.artifactId ?? '',
      );
      sendEnvelope(req, res, 200, data);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  // 7. Billing Balance, Plans, Server-Priced Orders & Razorpay Checkout Verification
  app.get(['/api/v1/billing/balance', '/api/v1/billing/plans'], (req, res) => {
    try {
      const summary = sharedPlatformRuntime.getBillingSummary();
      sendEnvelope(req, res, 200, summary);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.post('/api/v1/billing/orders', (req, res) => {
    try {
      const requestId =
        readHeaderString(req, 'idempotency-key') ??
        `req_ord_${crypto.randomBytes(8).toString('hex')}`;
      const body = (req.body ?? {}) as { planId?: string };
      const order = sharedPlatformRuntime.createBillingOrder({
        planId: String(body.planId ?? ''),
        requestId,
      });
      sendEnvelope(req, res, 201, order, requestId);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.post('/api/v1/billing/verify-checkout', (req, res) => {
    try {
      const requestId =
        readHeaderString(req, 'idempotency-key') ??
        `req_chk_${crypto.randomBytes(8).toString('hex')}`;
      const body = (req.body ?? {}) as { orderId?: string; paymentId?: string };
      const verified = sharedPlatformRuntime.verifyCheckoutAndCredit({
        orderId: String(body.orderId ?? ''),
        paymentId: body.paymentId,
        requestId,
      });
      sendEnvelope(req, res, 200, verified, requestId);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  return app;
}

async function startServer() {
  const app = createKartikExpressApp();
  const port = Number(process.env.PORT ?? 3000);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[Kartik.ai] Full-stack platform server listening on http://0.0.0.0:${port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void startServer();
}
