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
  DEV_SHARED_BOOTSTRAP_DEFAULTS,
  InMemoryRateLimitStore,
  createLogger,
  createManagedHttpServer,
  isExecutedAsMainModule,
  type Logger,
  type ManagedHttpServer,
  type RateLimitCounterStore,
} from '@kartik/shared';
import { loadBillingConfig, type BillingServiceConfig } from './config/index.js';
import { InMemoryBillingRepository, type BillingRepository } from './repositories/index.js';
import { createBillingRouter, type BillingRouter } from './routes/index.js';
import {
  CreditReservationService,
  InMemoryMoneyIdempotencyStore,
  MockPaymentProvider,
  PaymentOrderService,
  type MoneyIdempotencyStore,
  type PaymentProvider,
} from './services/index.js';

export interface BillingServiceBootstrapOptions {
  readonly env?: Record<string, string | undefined>;
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
  readonly repository: BillingRepository;
  readonly creditService: CreditReservationService;
  readonly paymentService: PaymentOrderService;
  readonly router: BillingRouter;
  readonly httpServer: ManagedHttpServer;
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
    DEMO_READ_ONLY: env.DEMO_READ_ONLY ?? 'false',
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

  const repository = options.repository ?? new InMemoryBillingRepository();
  const idempotencyStore = options.idempotencyStore ?? new InMemoryMoneyIdempotencyStore();
  const paymentProvider = options.paymentProvider ?? new MockPaymentProvider();
  const rateLimitStore = options.rateLimitStore ?? new InMemoryRateLimitStore();

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

  const router = createBillingRouter({
    config,
    repository,
    creditService,
    paymentService,
    rateLimitStore,
    logger,
    ...(options.checkReadiness ? { checkReadiness: options.checkReadiness } : {}),
  });

  const httpServer = createManagedHttpServer({
    serviceName: 'billing',
    router,
    logger,
  });

  return Object.freeze({
    config,
    logger,
    repository,
    creditService,
    paymentService,
    router,
    httpServer,
  });
}

/**
 * Starts the Billing Service HTTP listener and registers `SIGINT`/`SIGTERM` graceful shutdown hooks.
 */
export async function startBillingServer(
  options: BillingServiceBootstrapOptions & { readonly host?: string; readonly port?: number } = {},
): Promise<BillingServiceRuntime & { readonly boundPort: number }> {
  const runtime = bootstrapBillingService(options);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const port = options.port ?? runtime.config.PORT;
  const { port: boundPort } = await runtime.httpServer.listen(port, host);

  const shutdown = async (signal: string) => {
    runtime.logger.info('Received shutdown signal; closing Billing HTTP server', { signal });
    try {
      await runtime.httpServer.close();
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
