/**
 * @file backend/gateway/src/server/index.ts
 * @description Executable API Gateway Service Bootstrap, Dependency Initializer,
 * and `node:http` Listener (`Blueprint §2.1, §8.3, §9 Invariant #1, §11`).
 */

import {
  createLogger,
  createManagedHttpServer,
  DEV_SHARED_BOOTSTRAP_DEFAULTS,
  InMemoryRateLimitStore,
  isExecutedAsMainModule,
  type ExecutableServiceRouter,
  type Logger,
  type ManagedHttpServer,
  type ManagedHttpServerOptions,
  type RateLimitCounterStore,
} from '@kartik/shared';
import {
  loadGatewayConfig,
  type GatewayServiceConfig,
} from '../config/index.js';
import {
  FetchUpstreamHttpClient,
  type UpstreamHttpClient,
} from '../proxy/index.js';
import { CrossServiceHealthAggregator } from '../readiness/index.js';
import { createGatewayRouter, type GatewayRouter } from '../routes/index.js';

export {
  createManagedHttpServer,
  type ExecutableServiceRouter,
  type ManagedHttpServer,
  type ManagedHttpServerOptions,
};

export interface GatewayServiceBootstrapOptions {
  readonly env?: Record<string, string | undefined>;
  readonly host?: string;
  readonly port?: number;
  readonly upstreamClient?: UpstreamHttpClient;
  readonly rateLimitStore?: RateLimitCounterStore;
  readonly logger?: Logger;
  readonly checkClusterReadiness?: boolean;
}

export interface BootstrappedGatewayService {
  readonly config: GatewayServiceConfig;
  readonly logger: Logger;
  readonly upstreamClient: UpstreamHttpClient;
  readonly healthAggregator: CrossServiceHealthAggregator;
  readonly router: GatewayRouter;
  readonly httpServer: ManagedHttpServer;
  start(
    port?: number,
    host?: string,
  ): Promise<{ readonly port: number; readonly host: string }>;
  stop(): Promise<void>;
}

/**
 * Applies deterministic development/container defaults when variables are not explicitly set
 * so the API Gateway boots cleanly in local dev and container smoke tests.
 */
export function buildGatewayBootstrapEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  return {
    NODE_ENV: env.NODE_ENV ?? 'development',
    LOG_LEVEL: env.LOG_LEVEL ?? 'info',
    PORT_GATEWAY: env.PORT_GATEWAY ?? env.PORT ?? '8000',
    REDIS_URL: env.REDIS_URL ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.redisUrl,
    AUTH_SERVICE_URL: env.AUTH_SERVICE_URL ?? 'http://127.0.0.1:8001',
    CHAT_SERVICE_URL: env.CHAT_SERVICE_URL ?? 'http://127.0.0.1:8002',
    AGENT_SERVICE_URL: env.AGENT_SERVICE_URL ?? 'http://127.0.0.1:8003',
    BILLING_SERVICE_URL: env.BILLING_SERVICE_URL ?? 'http://127.0.0.1:8004',
    SERVICE_TO_SERVICE_TOKEN:
      env.SERVICE_TO_SERVICE_TOKEN ??
      DEV_SHARED_BOOTSTRAP_DEFAULTS.serviceToServiceToken,
    USER_CONTEXT_SIGNING_KEY:
      env.USER_CONTEXT_SIGNING_KEY ??
      DEV_SHARED_BOOTSTRAP_DEFAULTS.userContextPrivateKeyPem,
    CORS_ALLOWED_ORIGINS:
      env.CORS_ALLOWED_ORIGINS ??
      'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000',
    ...env,
  };
}

/**
 * Initializes the API Gateway dependency graph (`config`, `logger`, `upstreamClient`,
 * `rateLimitStore`, `healthAggregator`, `router`, and `httpServer`).
 */
export function bootstrapGatewayService(
  options: GatewayServiceBootstrapOptions = {},
): BootstrappedGatewayService {
  const effectiveEnv = buildGatewayBootstrapEnv(options.env ?? process.env);
  const config = loadGatewayConfig(effectiveEnv);
  const logger =
    options.logger ??
    createLogger({
      service: 'gateway',
      level: config.LOG_LEVEL,
    });

  const upstreamClient =
    options.upstreamClient ?? new FetchUpstreamHttpClient(config);
  const rateLimitStore =
    options.rateLimitStore ?? new InMemoryRateLimitStore();
  const healthAggregator = new CrossServiceHealthAggregator(upstreamClient);

  const router = createGatewayRouter({
    config,
    upstreamClient,
    rateLimitStore,
    logger,
    checkReadiness: async () => {
      if (options.checkClusterReadiness) {
        const summary = await healthAggregator.checkAllServices();
        return summary.status === 'ready';
      }
      return true;
    },
  });

  const httpServer = createManagedHttpServer({
    serviceName: 'gateway',
    router,
    onShutdown: async () => {
      logger.info('API Gateway HTTP server shut down cleanly');
    },
  });

  async function start(
    port = options.port ?? config.PORT_GATEWAY,
    host = options.host ?? effectiveEnv.HOST ?? '0.0.0.0',
  ): Promise<{ readonly port: number; readonly host: string }> {
    const bound = await httpServer.listen(port, host);
    logger.info('API Gateway HTTP listener started', {
      host: bound.host,
      port: bound.port,
    });
    return bound;
  }

  async function stop(): Promise<void> {
    await httpServer.close();
  }

  return Object.freeze({
    config,
    logger,
    upstreamClient,
    healthAggregator,
    router,
    httpServer,
    start,
    stop,
  });
}

/**
 * Boots the API Gateway HTTP listener and attaches `SIGINT`/`SIGTERM` graceful shutdown handlers.
 */
export async function startGatewayServer(
  options: GatewayServiceBootstrapOptions = {},
): Promise<BootstrappedGatewayService> {
  const runtime = bootstrapGatewayService(options);
  runtime.httpServer.attachSignalHandlers(runtime.logger);
  await runtime.start();
  return runtime;
}

if (isExecutedAsMainModule(import.meta.url)) {
  startGatewayServer().catch((err: unknown) => {
    console.error('[gateway] Fatal startup error:', err);
    process.exit(1);
  });
}
