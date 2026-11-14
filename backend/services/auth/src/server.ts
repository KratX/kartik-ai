/**
 * @file backend/services/auth/src/server.ts
 * @description Executable Auth Service Bootstrap, Dependency Initializer,
 * and `node:http` Listener (`Blueprint §2.1, §8.3, §9 Invariant #2, §11, ADR 0002`).
 */

import {
  createLogger,
  createManagedHttpServer,
  DEV_SHARED_BOOTSTRAP_DEFAULTS,
  InMemoryRateLimitStore,
  isExecutedAsMainModule,
  type Logger,
  type ManagedHttpServer,
  type RateLimitCounterStore,
} from '@kartik/shared';
import { loadAuthConfig, type AuthServiceConfig } from './config/index.js';
import {
  InMemoryUserRepository,
  type UserRepository,
} from './repositories/index.js';
import { createAuthRouter, type AuthRouter } from './routes/index.js';
import {
  createFirebaseTokenVerifier,
  InMemorySessionStore,
  SessionService,
  type FirebaseTokenVerifier,
  type SessionStore,
} from './services/index.js';

export interface AuthServiceBootstrapOptions {
  readonly env?: Record<string, string | undefined>;
  readonly host?: string;
  readonly port?: number;
  readonly firebaseVerifier?: FirebaseTokenVerifier;
  readonly userRepository?: UserRepository;
  readonly sessionStore?: SessionStore;
  readonly rateLimitStore?: RateLimitCounterStore;
  readonly logger?: Logger;
}

export interface BootstrappedAuthService {
  readonly config: AuthServiceConfig;
  readonly logger: Logger;
  readonly firebaseVerifier: FirebaseTokenVerifier;
  readonly userRepository: UserRepository;
  readonly sessionStore: SessionStore;
  readonly sessionService: SessionService;
  readonly router: AuthRouter;
  readonly httpServer: ManagedHttpServer;
  start(
    port?: number,
    host?: string,
  ): Promise<{ readonly port: number; readonly host: string }>;
  stop(): Promise<void>;
}

/**
 * Applies deterministic development/container defaults when variables are not explicitly set
 * so the Auth Service boots cleanly in local dev and container smoke tests.
 */
export function buildAuthBootstrapEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  return {
    NODE_ENV: env.NODE_ENV ?? 'development',
    LOG_LEVEL: env.LOG_LEVEL ?? 'info',
    PORT_AUTH: env.PORT_AUTH ?? env.PORT ?? '8001',
    DATABASE_URL: env.DATABASE_URL ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.databaseUrl,
    DATABASE_SCHEMA: 'auth',
    REDIS_URL: env.REDIS_URL ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.redisUrl,
    SERVICE_TO_SERVICE_TOKEN:
      env.SERVICE_TO_SERVICE_TOKEN ??
      DEV_SHARED_BOOTSTRAP_DEFAULTS.serviceToServiceToken,
    AUTH_PROVIDER_MODE: env.AUTH_PROVIDER_MODE ?? 'mock',
    ...env,
  };
}

/**
 * Initializes the Auth Service dependency graph (`config`, `logger`, `firebaseVerifier`,
 * `userRepository`, `sessionStore`, `sessionService`, `router`, and `httpServer`).
 */
export function bootstrapAuthService(
  options: AuthServiceBootstrapOptions = {},
): BootstrappedAuthService {
  const effectiveEnv = buildAuthBootstrapEnv(options.env ?? process.env);
  const config = loadAuthConfig(effectiveEnv);
  const logger =
    options.logger ??
    createLogger({
      service: 'auth',
      level: config.LOG_LEVEL,
    });

  const firebaseVerifier =
    options.firebaseVerifier ?? createFirebaseTokenVerifier(config);
  const userRepository =
    options.userRepository ?? new InMemoryUserRepository();
  const sessionStore = options.sessionStore ?? new InMemorySessionStore();
  const sessionService = new SessionService({
    store: sessionStore,
    sessionTtlSeconds: config.SESSION_TTL_SECONDS,
  });
  const rateLimitStore =
    options.rateLimitStore ?? new InMemoryRateLimitStore();

  const router = createAuthRouter({
    config,
    firebaseVerifier,
    userRepository,
    sessionService,
    rateLimitStore,
    logger,
    checkReadiness: async () => true,
  });

  const httpServer = createManagedHttpServer({
    serviceName: 'auth',
    router,
    onShutdown: async () => {
      logger.info('Auth Service HTTP server shut down cleanly');
    },
  });

  async function start(
    port = options.port ?? config.PORT_AUTH,
    host = options.host ?? effectiveEnv.HOST ?? '0.0.0.0',
  ): Promise<{ readonly port: number; readonly host: string }> {
    const bound = await httpServer.listen(port, host);
    logger.info('Auth Service HTTP listener started', {
      host: bound.host,
      port: bound.port,
      providerMode: config.AUTH_PROVIDER_MODE,
    });
    return bound;
  }

  async function stop(): Promise<void> {
    await httpServer.close();
  }

  return Object.freeze({
    config,
    logger,
    firebaseVerifier,
    userRepository,
    sessionStore,
    sessionService,
    router,
    httpServer,
    start,
    stop,
  });
}

/**
 * Boots the Auth Service HTTP listener and attaches `SIGINT`/`SIGTERM` graceful shutdown handlers.
 */
export async function startAuthServer(
  options: AuthServiceBootstrapOptions = {},
): Promise<BootstrappedAuthService> {
  const runtime = bootstrapAuthService(options);
  runtime.httpServer.attachSignalHandlers(runtime.logger);
  await runtime.start();
  return runtime;
}

if (isExecutedAsMainModule(import.meta.url)) {
  startAuthServer().catch((err: unknown) => {
    console.error('[auth] Fatal startup error:', err);
    process.exit(1);
  });
}
