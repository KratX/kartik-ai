/**
 * @kartik/billing/server — Executable Service Bootstrap & Real `node:http` Server
 *
 * Implements:
 * 1. `bootstrapBillingService` (validates config, initializes `InMemoryBillingRepository`,
 *    `InMemoryMoneyIdempotencyStore`, `CreditReservationService`, `MockPaymentProvider`,
 *    `PaymentOrderService`, `createBillingRouter`, and `createManagedHttpServer` with raw body
 *    preservation for Razorpay webhook HMAC-SHA256 verification)
 * 2. `startBillingServer` + `isExecutedAsMainModule` auto-start with `SIGINT`/`SIGTERM` graceful shutdown.
 */

import {
  AppError,
  DEV_SHARED_BOOTSTRAP_DEFAULTS,
  RedisRateLimitStore,
  createLazyPostgresPool,
  createLogger,
  createManagedHttpServer,
  createRedisClientFromUrl,
  isExecutedAsMainModule,
  verifyDatabaseConnectivity,
  type DatabaseConnectivityCheckResult,
  type DatabasePool,
  type Logger,
  type ManagedHttpServer,
  type RateLimitCounterStore,
} from '@kartik/shared';
import { loadBillingConfig, type BillingServiceConfig } from './config/index.js';
import type {
  CreditAccountRecord,
  CreditLedgerEntryRecord,
} from './models/index.js';
import {
  InMemoryBillingRepository,
  PostgresBillingRepository,
  type BillingRepository,
  type LockedBillingAccountTx,
} from './repositories/index.js';
import { createBillingRouter, type BillingRouter } from './routes/index.js';
import {
  CreditReservationService,
  MockPaymentProvider,
  PaymentOrderService,
  RedisMoneyIdempotencyStore,
  type MoneyIdempotencyStore,
  type PaymentProvider,
} from './services/index.js';

class ResilientBillingRepository implements BillingRepository {
  private readonly primary: PostgresBillingRepository;
  private readonly fallback: InMemoryBillingRepository;
  private readonly failHard: boolean;
  private primaryHealthy = true;

  constructor(primary: PostgresBillingRepository, failHard: boolean) {
    this.primary = primary;
    this.fallback = new InMemoryBillingRepository();
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

  public ensureAccount(userId: string, initialCredits: number): Promise<CreditAccountRecord> {
    return this.run(
      () => this.primary.ensureAccount(userId, initialCredits),
      () => this.fallback.ensureAccount(userId, initialCredits),
    );
  }

  public withLockedAccount<T>(
    userId: string,
    initialCredits: number,
    fn: (tx: LockedBillingAccountTx) => Promise<T>,
  ): Promise<T> {
    return this.run(
      () => this.primary.withLockedAccount(userId, initialCredits, fn),
      () => this.fallback.withLockedAccount(userId, initialCredits, fn),
    );
  }

  public listLedgerEntries(
    userId: string,
    limit?: number,
  ): Promise<readonly CreditLedgerEntryRecord[]> {
    return this.run(
      () => this.primary.listLedgerEntries(userId, limit),
      () => this.fallback.listLedgerEntries(userId, limit),
    );
  }
}

export interface BillingServiceBootstrapOptions {
  readonly env?: Record<string, string | undefined>;
  readonly dbPool?: DatabasePool;
  readonly verifyDatabaseOnStart?: boolean;
  readonly repository?: BillingRepository;
  readonly idempotencyStore?: MoneyIdempotencyStore;
  readonly paymentProvider?: PaymentProvider;
  readonly rateLimitStore?: RateLimitCounterStore;
  readonly checkReadiness?: () => Promise<boolean>;
  readonly logger?: Logger;
}

export interface BillingServiceRuntime {
  readonly config: BillingServiceConfig;
  readonly logger: Logger;
  readonly dbPool: DatabasePool;
  readonly repository: BillingRepository;
  readonly creditService: CreditReservationService;
  readonly paymentService: PaymentOrderService;
  readonly router: BillingRouter;
  readonly httpServer: ManagedHttpServer;
  verifyDatabaseConnection(): Promise<DatabaseConnectivityCheckResult>;
}

export function buildBillingBootstrapEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const isProd = env.NODE_ENV === 'production';
  if (isProd) {
    return env;
  }
  return {
    NODE_ENV: env.NODE_ENV ?? 'development',
    PORT: env.PORT ?? env.PORT_BILLING ?? '8004',
    BILLING_DATABASE_URL:
      env.BILLING_DATABASE_URL ?? env.DATABASE_URL ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.databaseUrl,
    REDIS_URL: env.REDIS_URL ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.redisUrl,
    BILLING_MODE: env.BILLING_MODE ?? 'mock',
    USER_CONTEXT_PUBLIC_KEY:
      env.USER_CONTEXT_PUBLIC_KEY ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.userContextPublicKeyPem,
    GATEWAY_TO_BILLING_TOKEN:
      env.GATEWAY_TO_BILLING_TOKEN ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.gatewayToBillingToken,
    CHAT_TO_BILLING_TOKEN:
      env.CHAT_TO_BILLING_TOKEN ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.chatToBillingToken,
    RAZORPAY_KEY_ID: env.RAZORPAY_KEY_ID ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.razorpayKeyId,
    RAZORPAY_KEY_SECRET:
      env.RAZORPAY_KEY_SECRET ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.razorpayKeySecret,
    RAZORPAY_WEBHOOK_SECRET:
      env.RAZORPAY_WEBHOOK_SECRET ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.razorpayWebhookSecret,
    ...env,
  };
}

/**
 * Initializes all Billing Service dependencies and returns a ready-to-listen `BillingServiceRuntime`.
 */
export function bootstrapBillingService(
  options: BillingServiceBootstrapOptions = {},
): BillingServiceRuntime {
  const config = loadBillingConfig(buildBillingBootstrapEnv(options.env ?? process.env));
  const logger =
    options.logger ??
    createLogger({
      service: 'billing',
      level: config.NODE_ENV === 'test' ? 'error' : 'info',
    });

  const dbPool =
    options.dbPool ??
    createLazyPostgresPool({
      schema: 'billing',
      connectionString: config.BILLING_DATABASE_URL,
    });
  const postgresBillingRepo = new PostgresBillingRepository(dbPool);
  const redisClient = createRedisClientFromUrl(config.REDIS_URL);

  const repository =
    options.repository ??
    new ResilientBillingRepository(postgresBillingRepo, config.NODE_ENV === 'production');
  const idempotencyStore =
    options.idempotencyStore ?? new RedisMoneyIdempotencyStore(redisClient);
  const paymentProvider = options.paymentProvider ?? new MockPaymentProvider();
  const rateLimitStore =
    options.rateLimitStore ?? new RedisRateLimitStore(redisClient);

  const creditService = new CreditReservationService({
    repository,
    idempotencyStore,
    initialFreeCredits: config.FREE_TIER_INITIAL_CREDITS,
  });

  const paymentService = new PaymentOrderService({
    repository,
    paymentProvider,
    initialFreeCredits: config.FREE_TIER_INITIAL_CREDITS,
    razorpayKeySecret:
      config.RAZORPAY_KEY_SECRET || DEV_SHARED_BOOTSTRAP_DEFAULTS.razorpayKeySecret,
    razorpayWebhookSecret:
      config.RAZORPAY_WEBHOOK_SECRET || DEV_SHARED_BOOTSTRAP_DEFAULTS.razorpayWebhookSecret,
  });

  async function verifyDatabaseConnection(): Promise<DatabaseConnectivityCheckResult> {
    const check = await verifyDatabaseConnectivity(dbPool, 'billing');
    logger.info('Billing Service database connectivity verified', {
      schema: check.schema,
      latencyMs: check.latencyMs,
    });
    return check;
  }

  const defaultReadiness = async (): Promise<boolean> => {
    if (config.NODE_ENV === 'production' || options.verifyDatabaseOnStart) {
      await verifyDatabaseConnectivity(dbPool, 'billing');
    }
    return true;
  };

  const router = createBillingRouter({
    config,
    repository,
    creditService,
    paymentService,
    rateLimitStore,
    logger,
    checkReadiness: options.checkReadiness ?? defaultReadiness,
  });

  const httpServer = createManagedHttpServer({
    serviceName: 'billing',
    router,
    logger,
    onShutdown: async () => {
      await dbPool.end().catch(() => undefined);
    },
  });

  return Object.freeze({
    config,
    logger,
    dbPool,
    repository,
    creditService,
    paymentService,
    router,
    httpServer,
    verifyDatabaseConnection,
  });
}

/**
 * Starts the Billing Service HTTP listener and registers `SIGINT`/`SIGTERM` graceful shutdown hooks.
 */
export async function startBillingServer(
  options: BillingServiceBootstrapOptions & { readonly host?: string; readonly port?: number } = {},
): Promise<BillingServiceRuntime & { readonly boundPort: number }> {
  const runtime = bootstrapBillingService(options);
  const shouldVerifyDb =
    options.verifyDatabaseOnStart ?? runtime.config.NODE_ENV === 'production';
  if (shouldVerifyDb) {
    await runtime.verifyDatabaseConnection();
  }
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const port = options.port ?? runtime.config.PORT;
  const { port: boundPort } = await runtime.httpServer.listen(port, host);

  const shutdown = async (signal: string) => {
    runtime.logger.info('Received shutdown signal; closing Billing HTTP server', { signal });
    try {
      await runtime.httpServer.close();
      await runtime.dbPool.end().catch(() => undefined);
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  return Object.freeze({
    ...runtime,
    boundPort,
  });
}

if (isExecutedAsMainModule(import.meta.url)) {
  startBillingServer().catch((err: unknown) => {
    process.stderr.write(
      `[billing] Fatal startup error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
