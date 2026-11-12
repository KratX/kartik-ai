/**
 * @file backend/gateway/src/server/index.ts
 * @description Zero-dependency `node:http` Server Adapter with raw-body webhook preservation,
 * payload size limits, and graceful `SIGINT`/`SIGTERM` shutdown (`Blueprint §8.3 & §11`, Micro-step 8.4.a).
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

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
  readonly maxBodyBytes?: number;
  readonly onShutdown?: () => Promise<void> | void;
}

export interface ManagedHttpServer {
  readonly server: http.Server;
  listen(port: number, host?: string): Promise<{ readonly port: number; readonly host: string }>;
  close(): Promise<void>;
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
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
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

    const rawBuffer = chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
    const rawBodyString = rawBuffer.toString('utf8');

    let parsedBody: unknown = undefined;
    if (rawBuffer.byteLength > 0) {
      const contentType = (req.headers['content-type'] ?? '').toLowerCase();
      if (contentType.includes('application/json') || rawBodyString.trim().startsWith('{')) {
        try {
          parsedBody = JSON.parse(rawBodyString);
        } catch {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
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

    const normalizedHeaders: Record<string, string | readonly string[] | undefined> = {};
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

  return Object.freeze({
    server,
    listen,
    close,
  });
}
