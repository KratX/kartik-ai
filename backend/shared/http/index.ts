/**
 * @file backend/shared/http/index.ts
 * @description Shared `node:http` Managed Server Adapter, Signal-Driven Graceful Shutdown,
 * Main-Module Entrypoint Detection, and Deterministic Local Development Bootstrap Defaults
 * (`Blueprint §8.3, §9 Invariant #7, §11`).
 */

import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '../logger/index.js';

export interface ExecutableServiceRouter {
  execute(request: {
    readonly method: string;
    readonly path: string;
    readonly headers?: Readonly<
      Record<string, string | readonly string[] | undefined>
    >;
    readonly body?: unknown;
    readonly rawBody?: string | Buffer;
    readonly ip?: string;
  }): Promise<{
    readonly statusCode: number;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body: unknown;
  }>;
}

export interface ManagedHttpServerOptions {
  readonly serviceName: string;
  readonly router: ExecutableServiceRouter;
  readonly logger?: Logger;
  readonly maxBodyBytes?: number;
  readonly onShutdown?: () => Promise<void> | void;
}

export interface ManagedHttpServer {
  readonly server: http.Server;
  listen(
    port: number,
    host?: string,
  ): Promise<{ readonly port: number; readonly host: string }>;
  close(): Promise<void>;
  attachSignalHandlers(logger?: Logger): () => void;
}

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MiB

/**
 * Wraps any Kartik service router (`GatewayRouter`, `AuthRouter`, `ChatRouter`, `AgentRouter`, `BillingRouter`)
 * in a production-hardened `node:http` server.
 *
 * Enforces:
 * - Raw body preservation (`rawBody`) for `POST /webhooks/razorpay` and `POST /api/v1/webhooks/razorpay` (§11).
 * - Strict request body byte ceiling (`maxBodyBytes`) to prevent memory exhaustion.
 * - Idempotent graceful shutdown (`close()`) that drains connections and closes registered DB/Redis resources (§8.3).
 */
export function createManagedHttpServer(
  options: ManagedHttpServerOptions,
): ManagedHttpServer {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  let isShuttingDown = false;
  let closePromise: Promise<void> | null = null;

  const server = http.createServer(async (req, res) => {
    if (isShuttingDown) {
      res.writeHead(503, {
        'content-type': 'application/json; charset=utf-8',
        connection: 'close',
      });
      res.end(
        JSON.stringify({
          traceId: 'trc_shutting_down',
          data: null,
          meta: { nextCursor: null },
          error: {
            code: 'PROVIDER_UNAVAILABLE',
            message: `Service ${options.serviceName} is shutting down`,
          },
        }),
      );
      return;
    }

    const method = (req.method ?? 'GET').toUpperCase();
    const urlPath = req.url ?? '/';

    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let payloadTooLarge = false;

    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as Uint8Array);
      receivedBytes += buf.byteLength;
      if (receivedBytes > maxBodyBytes) {
        payloadTooLarge = true;
        break;
      }
      chunks.push(buf);
    }

    if (payloadTooLarge) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          traceId: 'trc_payload_limit',
          data: null,
          meta: { nextCursor: null },
          error: {
            code: 'VALIDATION_FAILED',
            message: `Request body exceeds maximum allowed size (${maxBodyBytes} bytes)`,
          },
        }),
      );
      return;
    }

    const rawBuffer =
      chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
    const rawBodyString = rawBuffer.toString('utf8');

    let parsedBody: unknown = undefined;
    if (rawBuffer.byteLength > 0) {
      const contentType = (req.headers['content-type'] ?? '').toLowerCase();
      if (
        contentType.includes('application/json') ||
        rawBodyString.trim().startsWith('{')
      ) {
        try {
          parsedBody = JSON.parse(rawBodyString);
        } catch {
          res.writeHead(400, {
            'content-type': 'application/json; charset=utf-8',
          });
          res.end(
            JSON.stringify({
              traceId: 'trc_invalid_json',
              data: null,
              meta: { nextCursor: null },
              error: {
                code: 'VALIDATION_FAILED',
                message: 'Malformed JSON request body',
              },
            }),
          );
          return;
        }
      }
    }

    const normalizedHeaders: Record<
      string,
      string | readonly string[] | undefined
    > = {};
    for (const [k, v] of Object.entries(req.headers)) {
      normalizedHeaders[k.toLowerCase()] = v;
    }

    const remoteIp =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
        : undefined) ??
      req.socket.remoteAddress ??
      '127.0.0.1';

    const dispatched = await options.router.execute({
      method,
      path: urlPath,
      headers: normalizedHeaders,
      ...(parsedBody !== undefined ? { body: parsedBody } : {}),
      ...(rawBuffer.byteLength > 0 ? { rawBody: rawBodyString } : {}),
      ip: remoteIp,
    });

    const outHeaders: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      ...(dispatched.headers ?? {}),
    };

    res.writeHead(dispatched.statusCode, outHeaders);
    if (dispatched.statusCode === 204 || dispatched.body === null) {
      res.end();
      return;
    }
    const contentTypeOut = (outHeaders['content-type'] ?? '').toLowerCase();
    if (
      typeof dispatched.body === 'string' &&
      !contentTypeOut.includes('application/json')
    ) {
      res.end(dispatched.body);
      return;
    }
    res.end(JSON.stringify(dispatched.body));
  });

  async function listen(
    port: number,
    host = '127.0.0.1',
  ): Promise<{ readonly port: number; readonly host: string }> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        const addr = server.address() as AddressInfo;
        resolve(
          Object.freeze({
            port: addr.port,
            host: addr.address,
          }),
        );
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  async function close(): Promise<void> {
    if (closePromise) {
      return closePromise;
    }
    isShuttingDown = true;
    closePromise = (async () => {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }
      if (options.onShutdown) {
        await options.onShutdown();
      }
    })();
    return closePromise;
  }

  function attachSignalHandlers(logger?: Logger): () => void {
    const handleSignal = (signal: NodeJS.Signals) => {
      logger?.info(`Received ${signal}; shutting down ${options.serviceName}`, {
        service: options.serviceName,
      });
      void close().finally(() => {
        process.removeListener('SIGINT', onSigInt);
        process.removeListener('SIGTERM', onSigTerm);
      });
    };
    const onSigInt = () => handleSignal('SIGINT');
    const onSigTerm = () => handleSignal('SIGTERM');
    process.once('SIGINT', onSigInt);
    process.once('SIGTERM', onSigTerm);

    return () => {
      process.removeListener('SIGINT', onSigInt);
      process.removeListener('SIGTERM', onSigTerm);
    };
  }

  return Object.freeze({
    server,
    listen,
    close,
    attachSignalHandlers,
  });
}

/**
 * Checks whether the current ES module (`import.meta.url`) was invoked directly
 * as the Node.js process entrypoint (`node <script>`).
 */
export function isExecutedAsMainModule(
  importMetaUrl: string,
  argv1: string | undefined = process.argv[1],
): boolean {
  if (!argv1) {
    return false;
  }
  try {
    const modulePath = path.resolve(fileURLToPath(importMetaUrl));
    const entryPath = path.resolve(argv1);
    return modulePath === entryPath;
  } catch {
    return false;
  }
}

/**
 * Deterministically derives an Ed25519 PKCS#8 private key and SPKI public key PEM pair
 * from a fixed development seed so that all 5 microservices (`gateway`, `auth`, `chat`,
 * `agent`, `billing`) share identical `USER_CONTEXT_SIGNING_KEY` / `USER_CONTEXT_PUBLIC_KEY`
 * credentials when started in separate OS processes during local development or container smoke tests.
 */
function createDeterministicDevEd25519KeyPair(): {
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
} {
  // PKCS#8 ASN.1 prefix for a 32-byte Ed25519 private key seed (RFC 8410)
  const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const seed = createHash('sha256')
    .update('kartik-ai-deterministic-local-dev-ed25519-seed-v4.3', 'utf8')
    .digest();
  const der = Buffer.concat([pkcs8Prefix, seed]);
  const privKey = createPrivateKey({
    key: der,
    format: 'der',
    type: 'pkcs8',
  });
  const pubKey = createPublicKey(privKey);

  return Object.freeze({
    privateKeyPem: privKey
      .export({ format: 'pem', type: 'pkcs8' })
      .toString('utf8'),
    publicKeyPem: pubKey
      .export({ format: 'pem', type: 'spki' })
      .toString('utf8'),
  });
}

const DEV_KEYPAIR = createDeterministicDevEd25519KeyPair();

export const DEV_SHARED_BOOTSTRAP_DEFAULTS = Object.freeze({
  databaseUrl: 'postgresql://kartik:kartik@127.0.0.1:5432/kartik',
  redisUrl: 'redis://127.0.0.1:6379',
  qdrantUrl: 'http://127.0.0.1:6333',
  serviceToServiceToken: 's2s-kartik-internal-gateway-token-v43',
  chatToAgentToken: 's2s-kartik-internal-chat-to-agent-v43',
  chatToBillingToken: 's2s-kartik-internal-chat-to-billing-v43',
  gatewayToBillingToken: 's2s-kartik-internal-gateway-to-billing-v43',
  cursorSigningSecret: 'kartik-default-cursor-integrity-key',
  razorpayKeyId: 'rzp_test_kartik_local_dev_0001',
  razorpayKeySecret: 'rzp_test_kartik_local_dev_secret_0001',
  razorpayWebhookSecret: 'rzp_test_kartik_local_dev_webhook_0001',
  userContextPrivateKeyPem: DEV_KEYPAIR.privateKeyPem,
  userContextPublicKeyPem: DEV_KEYPAIR.publicKeyPem,
});
