/**
 * @file server.ts
 * @description Kartik.ai Full-Stack Express + Vite Platform Server (Demo / Local Mode, Port 3000).
 *
 * Security & Multi-User Isolation:
 * - Restricted to demo/local use (`assertRootRuntimeDemoOrLocalOnly`).
 * - Zero global `currentUser` state: every request resolves its own authenticated identity
 *   (`req.authIdentity`) from a verified Firebase ID token (`Authorization: Bearer <idToken>`)
 *   or a server-issued `HttpOnly` session cookie created strictly from a verified Firebase ID token.
 * - Never trusts caller-supplied `uid`, `email`, `displayName`, or unverified JWT payloads.
 * - Protected routes enforce `requireAuth` and scope all operations to the authenticated user.
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { isExecutedAsMainModule } from './backend/shared/http/index.js';
import {
  AppError,
  createSuccessEnvelope,
  mapErrorToHttpResponse,
} from './backend/shared/errors/index.js';
import type { SpecialistAgentName } from './backend/shared/contracts/index.js';
import {
  assertRootRuntimeDemoOrLocalOnly,
  type KartikPlatformRuntime,
  sharedPlatformRuntime,
} from './src/server/platform-api-runtime.js';
import {
  extractSessionCookieId,
  optionalAuth,
  registerSessionIdentityResolver,
  requireAuth,
  verifyRequestFirebaseToken,
  type AuthRequest,
  type VerifiedRequestIdentity,
} from './src/middleware/auth.ts';

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

function requireAuthenticatedIdentity(req: Request): VerifiedRequestIdentity {
  const authReq = req as AuthRequest;
  if (!authReq.authIdentity || !authReq.authIdentity.uid) {
    throw new AppError(
      'UNAUTHENTICATED',
      'Authentication required: provide a verified Firebase ID token',
    );
  }
  return authReq.authIdentity;
}

export function createKartikExpressApp(
  runtime: KartikPlatformRuntime = sharedPlatformRuntime,
  env: NodeJS.ProcessEnv = process.env,
) {
  assertRootRuntimeDemoOrLocalOnly(env);
  registerSessionIdentityResolver((sessionId) =>
    runtime.resolveSessionIdentity(sessionId),
  );

  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use(optionalAuth);

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
    res.status(statusCode).json({
      ok: true,
      ...createSuccessEnvelope(traceId, data, { requestId: resolvedReqId }),
    });
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
    res.status(mapped.httpStatus).json({
      ok: false,
      ...mapped.body,
    });
  };

  // 1. Health & Readiness Probes
  app.get(['/healthz', '/api/v1/healthz'], (req, res) => {
    sendEnvelope(req, res, 200, {
      status: 'ok',
      service: 'gateway',
      runtimeScope: 'demo-local-only',
    });
  });

  app.get(['/readyz', '/api/v1/readyz'], (req, res) => {
    sendEnvelope(req, res, 200, {
      status: 'ready',
      service: 'gateway',
      runtimeScope: 'demo-local-only',
      upstreams: {
        auth: 'ready',
        chat: 'ready',
        agent: 'ready',
        billing: 'ready',
      },
    });
  });

  // 2. Auth Routes (/api/v1/auth/firebase-config, /api/v1/auth/google, /api/v1/auth/me, /api/v1/auth/logout)
  app.get('/api/v1/auth/firebase-config', (req, res) => {
    try {
      const stripQuotes = (v?: string) => (v ?? '').trim().replace(/^["']|["']$/g, '');
      const isPlaceholderProject = (v: string) =>
        !v ||
        v === 'your-firebase-project' ||
        v === 'kartik-mock-project' ||
        v === 'demo-project';
      const isPlaceholderApiKey = (v: string) =>
        !v || v === 'your_firebase_web_api_key' || v === 'demo-firebase-api-key';

      let apiKey = stripQuotes(process.env.VITE_FIREBASE_API_KEY);
      let authDomain = stripQuotes(process.env.VITE_FIREBASE_AUTH_DOMAIN);
      let projectId = stripQuotes(
        process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
      );
      let appId = stripQuotes(process.env.VITE_FIREBASE_APP_ID);
      let oAuthClientId = stripQuotes(process.env.VITE_GOOGLE_OAUTH_CLIENT_ID);

      try {
        const appletCfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
        if (fs.existsSync(appletCfgPath)) {
          const raw = JSON.parse(fs.readFileSync(appletCfgPath, 'utf8')) as Record<
            string,
            string | undefined
          >;
          apiKey = !isPlaceholderApiKey(apiKey) ? apiKey : stripQuotes(raw.apiKey);
          projectId = !isPlaceholderProject(projectId)
            ? projectId
            : stripQuotes(raw.projectId);
          authDomain =
            authDomain && !authDomain.includes('your-firebase-project')
              ? authDomain
              : stripQuotes(raw.authDomain);
          appId = appId || stripQuotes(raw.appId);
          oAuthClientId = oAuthClientId || stripQuotes(raw.oAuthClientId);
        }
      } catch {
        // Optional fallback file not present
      }

      sendEnvelope(req, res, 200, {
        brandName: 'kartik-ai',
        apiKey,
        authDomain: authDomain || (projectId ? `${projectId}.firebaseapp.com` : ''),
        projectId,
        appId,
        oAuthClientId,
        enabled: Boolean(!isPlaceholderApiKey(apiKey) && !isPlaceholderProject(projectId)),
      });
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.post('/api/v1/auth/google', async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const body = (req.body ?? {}) as { idToken?: string };
      const bearerHeader = readHeaderString(req, 'authorization');
      const rawToken =
        body.idToken?.trim() ||
        (bearerHeader?.startsWith('Bearer ') ? bearerHeader.slice(7).trim() : '');

      // Strictly require a verified Firebase ID token; never trust caller-supplied uid/email
      let verifiedIdentity = authReq.authIdentity;
      if (!verifiedIdentity || rawToken) {
        const verified = await verifyRequestFirebaseToken(rawToken);
        verifiedIdentity = verified.identity;
      }

      const session = runtime.loginWithGoogle(verifiedIdentity);
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
      const authReq = req as AuthRequest;
      const status = runtime.getAuthStatus(authReq.authIdentity ?? null);
      sendEnvelope(req, res, 200, status);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.post('/api/v1/auth/logout', (req, res) => {
    try {
      const sessionId =
        (req as AuthRequest).sessionId ?? extractSessionCookieId(req);
      const result = runtime.logout(sessionId);
      res.setHeader('Set-Cookie', 'kartik_session=; Path=/; Max-Age=0; HttpOnly');
      sendEnvelope(req, res, 200, result);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  // 3. Demo Read-Only Toggle (/api/v1/demo/toggle-read-only) — Protected
  app.post('/api/v1/demo/toggle-read-only', requireAuth, (req, res) => {
    try {
      const actor = requireAuthenticatedIdentity(req);
      const body = (req.body ?? {}) as { enabled?: boolean };
      const result = runtime.toggleDemoReadOnly(actor, body.enabled);
      sendEnvelope(req, res, 200, result);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  // 4. Conversations & Multi-Agent Turns — Protected & Request-Scoped
  app.get('/api/v1/conversations', requireAuth, (req, res) => {
    try {
      const actor = requireAuthenticatedIdentity(req);
      const list = runtime.listConversations(actor);
      sendEnvelope(req, res, 200, list);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.post('/api/v1/conversations', requireAuth, (req, res) => {
    try {
      const actor = requireAuthenticatedIdentity(req);
      const body = (req.body ?? {}) as { title?: string };
      const conv = runtime.createConversation(actor, body.title);
      sendEnvelope(req, res, 201, conv);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.get(
    '/api/v1/conversations/:conversationId/messages',
    requireAuth,
    (req, res) => {
      try {
        const actor = requireAuthenticatedIdentity(req);
        const data = runtime.getConversationMessages(
          actor,
          req.params.conversationId ?? '',
        );
        sendEnvelope(req, res, 200, data);
      } catch (err) {
        sendError(req, res, err);
      }
    },
  );

  app.post(
    '/api/v1/conversations/:conversationId/messages',
    requireAuth,
    async (req, res) => {
      try {
        const actor = requireAuthenticatedIdentity(req);
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

        const turn = await runtime.sendMessageTurn(actor, {
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
    },
  );

  app.delete(
    '/api/v1/conversations/:conversationId',
    requireAuth,
    async (req, res) => {
      try {
        const actor = requireAuthenticatedIdentity(req);
        const deleted = await runtime.deleteConversation(
          actor,
          req.params.conversationId ?? '',
        );
        sendEnvelope(req, res, 200, deleted);
      } catch (err) {
        sendError(req, res, err);
      }
    },
  );

  // 5. File Upload & Listing (/api/v1/files, /api/v1/files/upload) — Protected & Request-Scoped
  app.post(
    ['/api/v1/files', '/api/v1/files/upload'],
    requireAuth,
    async (req, res) => {
      try {
        const actor = requireAuthenticatedIdentity(req);
        const body = (req.body ?? {}) as {
          conversationId?: string;
          originalFilename?: string;
          declaredMimeType?: string;
          contentBase64?: string;
        };
        const uploaded = await runtime.uploadFile(actor, {
          conversationId: String(body.conversationId ?? 'conv_welcome_01'),
          originalFilename: String(body.originalFilename ?? ''),
          declaredMimeType: String(body.declaredMimeType ?? ''),
          contentBase64: String(body.contentBase64 ?? ''),
        });
        sendEnvelope(req, res, 201, uploaded);
      } catch (err) {
        sendError(req, res, err);
      }
    },
  );

  app.get('/api/v1/files', requireAuth, async (req, res) => {
    try {
      const actor = requireAuthenticatedIdentity(req);
      const list = await runtime.listFiles(actor);
      sendEnvelope(req, res, 200, list);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  // 6. Artifacts & Direct Binary Streaming (/api/v1/artifacts/:artifactId, /content, /raw) — Protected & Request-Scoped
  app.get(
    '/api/v1/artifacts/:artifactId/content',
    requireAuth,
    async (req, res) => {
      try {
        const actor = requireAuthenticatedIdentity(req);
        const data = await runtime.getArtifactContent(
          actor,
          req.params.artifactId ?? '',
        );
        sendEnvelope(req, res, 200, data);
      } catch (err) {
        sendError(req, res, err);
      }
    },
  );

  app.get(
    '/api/v1/artifacts/:artifactId/raw',
    requireAuth,
    async (req, res) => {
      try {
        const actor = requireAuthenticatedIdentity(req);
        const data = await runtime.getArtifactContent(
          actor,
          req.params.artifactId ?? '',
        );
        const rawBuffer = Buffer.from(data.contentBase64, 'base64');
        const safeTitle =
          data.artifact.title
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
    },
  );

  app.get('/api/v1/artifacts/:artifactId', requireAuth, async (req, res) => {
    try {
      const actor = requireAuthenticatedIdentity(req);
      const data = await runtime.getArtifactContent(
        actor,
        req.params.artifactId ?? '',
      );
      sendEnvelope(req, res, 200, data);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  // 7. Billing Balance, Plans, Server-Priced Orders & Razorpay Checkout Verification — Protected & Request-Scoped
  app.get(
    ['/api/v1/billing/balance', '/api/v1/billing/plans'],
    requireAuth,
    (req, res) => {
      try {
        const actor = requireAuthenticatedIdentity(req);
        const summary = runtime.getBillingSummary(actor);
        sendEnvelope(req, res, 200, summary);
      } catch (err) {
        sendError(req, res, err);
      }
    },
  );

  app.post('/api/v1/billing/orders', requireAuth, async (req, res) => {
    try {
      const actor = requireAuthenticatedIdentity(req);
      const requestId =
        readHeaderString(req, 'idempotency-key') ??
        `req_ord_${crypto.randomBytes(8).toString('hex')}`;
      const body = (req.body ?? {}) as { planId?: string };
      const order = await runtime.createBillingOrder(actor, {
        planId: String(body.planId ?? ''),
        requestId,
      });
      sendEnvelope(req, res, 201, order, requestId);
    } catch (err) {
      sendError(req, res, err);
    }
  });

  app.post(
    ['/api/v1/billing/verify', '/api/v1/billing/verify-checkout', '/billing/verify'],
    requireAuth,
    (req, res) => {
      try {
        const actor = requireAuthenticatedIdentity(req);
        const requestId =
          readHeaderString(req, 'idempotency-key') ??
          `req_chk_${crypto.randomBytes(8).toString('hex')}`;
        const body = (req.body ?? {}) as {
          orderId?: string;
          paymentId?: string;
          signature?: string;
          razorpayOrderId?: string;
          razorpayPaymentId?: string;
          razorpaySignature?: string;
        };
        const verified = runtime.verifyCheckoutAndCredit(actor, {
          orderId: String(body.orderId ?? body.razorpayOrderId ?? ''),
          paymentId: body.paymentId ?? body.razorpayPaymentId,
          signature: body.signature ?? body.razorpaySignature,
          requestId,
        });
        sendEnvelope(req, res, 200, verified, requestId);
      } catch (err) {
        sendError(req, res, err);
      }
    },
  );

  return app;
}

async function startServer() {
  assertRootRuntimeDemoOrLocalOnly(process.env);
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
    console.log(
      `[Kartik.ai] Demo/local full-stack platform server ready at http://localhost:${port}`,
    );
  });
}

if (isExecutedAsMainModule(import.meta.url)) {
  void startServer();
}
