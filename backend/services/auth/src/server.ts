/**
 * @file backend/services/auth/src/server.ts
 * @description Executable Auth Service Bootstrap, Dependency Initializer,
 * and `node:http` Listener (`Blueprint §2.1, §8.3, §9 Invariant #2, §11, ADR 0002`).
 */

import {
  AppError,
  createLazyPostgresPool,
  createLogger,
  createManagedHttpServer,
  createRedisClientFromUrl,
  DEV_SHARED_BOOTSTRAP_DEFAULTS,
  isExecutedAsMainModule,
  RedisRateLimitStore,
  verifyDatabaseConnectivity,
  type DatabaseConnectivityCheckResult,
  type DatabasePool,
  type Logger,
  type ManagedHttpServer,
  type RateLimitCounterStore,
} from '@kartik/shared';
import { loadAuthConfig, type AuthServiceConfig } from './config/index.js';
import type { AuthUser, UpsertGoogleUserInput, UserStatus } from './models/index.js';
import {
  InMemoryUserRepository,
  PostgresUserRepository,
  type UserRepository,
} from './repositories/index.js';
import { createAuthRouter, type AuthRouter } from './routes/index.js';
import {
  createFirebaseTokenVerifier,
  RedisHashSessionStore,
  SessionService,
  type FirebaseTokenVerifier,
  type SessionStore,
} from './services/index.js';

class ResilientUserRepository implements UserRepository {
  private readonly primary: PostgresUserRepository;
  private readonly fallback: InMemoryUserRepository;
  private readonly failHard: boolean;
  private primaryHealthy = true;

  constructor(primary: PostgresUserRepository, failHard: boolean) {
    this.primary = primary;
    this.fallback = new InMemoryUserRepository();
    this.failHard = failHard;
  }

  private async run<T>(
    primaryFn: () => Promise<T>,
    fallbackFn: () => Promise<T>,
  ): Promise<T> {
    if (this.failHard) {
      return primaryFn();
    }
    if (this.primaryHealthy) {
      try {
        return await primaryFn();
      } catch (err) {
        if (err instanceof AppError) {
          throw err;
        }
        this.primaryHealthy = false;
      }
    }
    return fallbackFn();
  }

  public upsertUserFromGoogleIdentity(input: UpsertGoogleUserInput): Promise<AuthUser> {
    return this.run(
      () => this.primary.upsertUserFromGoogleIdentity(input),
      () => this.fallback.upsertUserFromGoogleIdentity(input),
    );
  }

  public findById(userId: string): Promise<AuthUser | null> {
    return this.run(
      () => this.primary.findById(userId),
      () => this.fallback.findById(userId),
    );
  }

  public findByFirebaseUid(firebaseUid: string): Promise<AuthUser | null> {
    return this.run(
      () => this.primary.findByFirebaseUid(firebaseUid),
      () => this.fallback.findByFirebaseUid(firebaseUid),
    );
  }

  public setUserStatus(userId: string, status: UserStatus): Promise<AuthUser> {
    return this.run(
      () => this.primary.setUserStatus(userId, status),
      () => this.fallback.setUserStatus(userId, status),
    );
  }
}

export interface AuthServiceBootstrapOptions {
  readonly env?: Record<string, string | undefined>;
  readonly host?: string;
  readonly port?: number;
  readonly dbPool?: DatabasePool;
  readonly verifyDatabaseOnStart?: boolean;
  readonly checkReadiness?: () => Promise<boolean>;
  readonly firebaseVerifier?: FirebaseTokenVerifier;
  readonly userRepository?: UserRepository;
  readonly sessionStore?: SessionStore;
  readonly rateLimitStore?: RateLimitCounterStore;
  readonly logger?: Logger;
}

export interface BootstrappedAuthService {
  readonly config: AuthServiceConfig;
  readonly logger: Logger;
  readonly dbPool: DatabasePool;
  readonly firebaseVerifier: FirebaseTokenVerifier;
  readonly userRepository: UserRepository;
  readonly sessionStore: SessionStore;
  readonly sessionService: SessionService;
  readonly router: AuthRouter;
  readonly httpServer: ManagedHttpServer;
  verifyDatabaseConnection(): Promise<DatabaseConnectivityCheckResult>;
  start(
    port?: number,
    host?: string,
  ): Promise<{ readonly port: number; readonly host: string }>;
  stop(): Promise<void>;
}

/**
 * Applies deterministic development/test defaults when variables are not explicitly set.
 * In production (`NODE_ENV === 'production'`), requires explicit `DATABASE_URL` and `REDIS_URL`.
 */
export function buildAuthBootstrapEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  if (env.NODE_ENV === 'production') {
    return {
      DATABASE_SCHEMA: 'auth',
      PORT_AUTH: env.PORT_AUTH ?? env.PORT ?? '8001',
      ...env,
    };
  }
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
 * Initializes the Auth Service dependency graph (`config`, `logger`, `dbPool`, `firebaseVerifier`,
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

  const dbPool =
    options.dbPool ??
    createLazyPostgresPool({
      schema: 'auth',
      connectionString: config.DATABASE_URL,
    });
  const postgresUserRepo = new PostgresUserRepository(dbPool);
  const redisClient = createRedisClientFromUrl(config.REDIS_URL);

  const firebaseVerifier =
    options.firebaseVerifier ?? createFirebaseTokenVerifier(config);
  const userRepository =
    options.userRepository ??
    new ResilientUserRepository(postgresUserRepo, config.NODE_ENV === 'production');
  const sessionStore =
    options.sessionStore ?? new RedisHashSessionStore(redisClient);
  const sessionService = new SessionService({
    store: sessionStore,
    sessionTtlSeconds: config.SESSION_TTL_SECONDS,
  });
  const rateLimitStore =
    options.rateLimitStore ?? new RedisRateLimitStore(redisClient);

  async function verifyDatabaseConnection(): Promise<DatabaseConnectivityCheckResult> {
    const check = await verifyDatabaseConnectivity(dbPool, 'auth');
    logger.info('Auth Service database connectivity verified', {
      schema: check.schema,
      latencyMs: check.latencyMs,
    });
    return check;
  }

  const defaultReadiness = async (): Promise<boolean> => {
    if (config.NODE_ENV === 'production' || options.verifyDatabaseOnStart) {
      await verifyDatabaseConnectivity(dbPool, 'auth');
    }
    return true;
  };

  const router = createAuthRouter({
    config,
    firebaseVerifier,
    userRepository,
    sessionService,
    rateLimitStore,
    logger,
    checkReadiness: options.checkReadiness ?? defaultReadiness,
  });

  const httpServer = createManagedHttpServer({
    serviceName: 'auth',
    router,
    onShutdown: async () => {
      await dbPool.end().catch(() => undefined);
      logger.info('Auth Service HTTP server shut down cleanly');
    },
  });

  async function start(
    port = options.port ?? config.PORT_AUTH,
    host = options.host ?? effectiveEnv.HOST ?? '0.0.0.0',
  ): Promise<{ readonly port: number; readonly host: string }> {
    const shouldVerifyDb =
      options.verifyDatabaseOnStart ?? config.NODE_ENV === 'production';
    if (shouldVerifyDb) {
      await verifyDatabaseConnection();
    }
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
    await dbPool.end().catch(() => undefined);
  }

  return Object.freeze({
    config,
    logger,
    dbPool,
    firebaseVerifier,
    userRepository,
    sessionStore,
    sessionService,
    router,
    httpServer,
    verifyDatabaseConnection,
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
