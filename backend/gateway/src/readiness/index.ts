/**
 * @file backend/gateway/src/readiness/index.ts
 * @description Cross-service cluster readiness aggregator, free-tier portfolio safety validator,
 * and 20-invariant registry for @kartik/gateway (Phase 8 / Micro-step 8.2.a — Final Exit Gate).
 *
 * Enforces Blueprint §3, §9 (Invariants #1–#20), §11 ("Never enable live payments on a publicly
 * reachable deployment"), and §12 (Free-tier & quota rules).
 */

import { AppError } from '@kartik/shared';
import type { UpstreamServiceTarget } from '../config/index.js';
import type { UpstreamHttpClient } from '../proxy/index.js';

export interface ArchitectureInvariantEntry {
  readonly id: number;
  readonly summary: string;
  readonly owningWorkspace:
    | '@kartik/shared'
    | '@kartik/auth'
    | '@kartik/gateway'
    | '@kartik/billing'
    | '@kartik/agent'
    | '@kartik/chat'
    | '@kartik/frontend';
  readonly verifiedByPhase: number;
}

/**
 * Authoritative registry of all 20 Kartik.ai Architecture Invariants (Blueprint §9).
 */
export const ARCHITECTURE_INVARIANTS_REGISTRY: readonly ArchitectureInvariantEntry[] =
  Object.freeze([
    {
      id: 1,
      summary: 'Browser talks to the backend only through the API Gateway (/api/v1/*).',
      owningWorkspace: '@kartik/gateway',
      verifiedByPhase: 3,
    },
    {
      id: 2,
      summary: 'Auth owns identity and application sessions; it owns no credits or payments.',
      owningWorkspace: '@kartik/auth',
      verifiedByPhase: 2,
    },
    {
      id: 3,
      summary: 'Chat owns conversations, messages, the run record, and the deletion lifecycle.',
      owningWorkspace: '@kartik/chat',
      verifiedByPhase: 6,
    },
    {
      id: 4,
      summary: 'Agent owns LangGraph execution, specialist behaviour, files, artifacts, objects, and vectors.',
      owningWorkspace: '@kartik/agent',
      verifiedByPhase: 5,
    },
    {
      id: 5,
      summary: 'Billing owns plans, entitlements, credit accounts, reservations, ledger, payments, and quota policy.',
      owningWorkspace: '@kartik/billing',
      verifiedByPhase: 4,
    },
    {
      id: 6,
      summary: 'Agent never calculates, reserves, settles, or mutates credits; Chat coordinates Billing around Agent.',
      owningWorkspace: '@kartik/chat',
      verifiedByPhase: 6,
    },
    {
      id: 7,
      summary: 'Services never read or write another service’s tables; PostgreSQL schema search_path enforces isolation.',
      owningWorkspace: '@kartik/shared',
      verifiedByPhase: 1,
    },
    {
      id: 8,
      summary: 'Shared code holds technical utilities and contracts only — never business logic.',
      owningWorkspace: '@kartik/shared',
      verifiedByPhase: 1,
    },
    {
      id: 9,
      summary: 'Vector retrieval is strictly filtered by authenticated userId and document identity.',
      owningWorkspace: '@kartik/agent',
      verifiedByPhase: 5,
    },
    {
      id: 10,
      summary: 'Objects are private; the browser receives short-lived, ownership-checked signed URLs.',
      owningWorkspace: '@kartik/shared',
      verifiedByPhase: 1,
    },
    {
      id: 11,
      summary: 'Generated code is previewed in an isolated browser sandbox (sandbox="allow-scripts") and never on the host.',
      owningWorkspace: '@kartik/frontend',
      verifiedByPhase: 7,
    },
    {
      id: 12,
      summary: 'All model output is untrusted input; validate JSON, filenames, MIME types, URLs, and artifact manifests.',
      owningWorkspace: '@kartik/agent',
      verifiedByPhase: 5,
    },
    {
      id: 13,
      summary: 'Provider adapters isolate graph nodes from vendor SDK details.',
      owningWorkspace: '@kartik/agent',
      verifiedByPhase: 5,
    },
    {
      id: 14,
      summary: 'Internal endpoints (/internal/*) never appear in the public route table and require service identity.',
      owningWorkspace: '@kartik/gateway',
      verifiedByPhase: 3,
    },
    {
      id: 15,
      summary: 'One logical run has one identity: client Idempotency-Key forwarded unchanged as requestId.',
      owningWorkspace: '@kartik/shared',
      verifiedByPhase: 1,
    },
    {
      id: 16,
      summary: 'Redis is a cache, session, and coordination dependency — never the authoritative store for balances.',
      owningWorkspace: '@kartik/billing',
      verifiedByPhase: 4,
    },
    {
      id: 17,
      summary: 'Every credit and payment mutation is a single PostgreSQL transaction locking rows with SELECT ... FOR UPDATE.',
      owningWorkspace: '@kartik/billing',
      verifiedByPhase: 4,
    },
    {
      id: 18,
      summary: 'Deletion cascades in strict order: vectors -> objects -> metadata, confirmed before marking purged.',
      owningWorkspace: '@kartik/chat',
      verifiedByPhase: 6,
    },
    {
      id: 19,
      summary: 'Providers are mocked by default (MOCK_AI=true); live calls are opt-in, budgeted, and counted.',
      owningWorkspace: '@kartik/agent',
      verifiedByPhase: 5,
    },
    {
      id: 20,
      summary: 'A resource that does not exist and a resource owned by someone else both return 404 NOT_FOUND.',
      owningWorkspace: '@kartik/shared',
      verifiedByPhase: 1,
    },
  ]);

export interface PortfolioFreeTierReadinessReport {
  readonly compliant: boolean;
  readonly mockAiDefault: boolean;
  readonly imageProviderMode: 'mock' | 'live';
  readonly billingMode: 'mock' | 'razorpay_test';
  readonly demoReadOnly: boolean;
  readonly dailyLiveBudgetPerProvider: number;
  readonly violations: readonly string[];
  readonly postureStatement: string;
}

/**
 * Validates environment settings against the Kartik.ai Free-Tier & Portfolio Security Rules
 * (Blueprint §11 & §12):
 * - Rejects live Razorpay keys (`rzp_live_*`) on any deployment (`§11`).
 * - Requires `MOCK_AI=true`, `IMAGE_PROVIDER=mock`, and `BILLING_MODE=mock` by default (`§12`).
 * - When live AI is opted in (`MOCK_AI=false`), requires a bounded positive integer `DAILY_LIVE_CALL_BUDGET` (`<= 500`).
 */
export function verifyPortfolioFreeTierReadiness(
  env: Readonly<Record<string, string | undefined>>,
): PortfolioFreeTierReadinessReport {
  const violations: string[] = [];

  const mockAiRaw = (env.MOCK_AI ?? 'true').trim().toLowerCase();
  const mockAiDefault = mockAiRaw === 'true';
  if (mockAiRaw !== 'true' && mockAiRaw !== 'false') {
    violations.push('MOCK_AI must be explicitly "true" or "false"');
  }

  const imageProviderRaw = (env.IMAGE_PROVIDER ?? 'mock').trim().toLowerCase();
  if (imageProviderRaw !== 'mock' && imageProviderRaw !== 'live') {
    violations.push('IMAGE_PROVIDER must be "mock" or "live"');
  }

  const billingModeRaw = (env.BILLING_MODE ?? 'mock').trim().toLowerCase();
  if (billingModeRaw !== 'mock' && billingModeRaw !== 'razorpay_test') {
    violations.push(
      'BILLING_MODE must be "mock" or "razorpay_test" — live payments are forbidden on public deployments (§11)',
    );
  }

  const razorpayKeyId = (env.RAZORPAY_KEY_ID ?? '').trim();
  if (razorpayKeyId.startsWith('rzp_live_')) {
    violations.push(
      'RAZORPAY_KEY_ID starts with "rzp_live_": live Razorpay keys are strictly forbidden on public deployments (§11)',
    );
  }

  const demoReadOnlyRaw = (env.DEMO_READ_ONLY ?? 'false').trim().toLowerCase();
  if (demoReadOnlyRaw !== 'true' && demoReadOnlyRaw !== 'false') {
    violations.push('DEMO_READ_ONLY must be "true" or "false"');
  }

  const budgetRaw = env.DAILY_LIVE_CALL_BUDGET ?? '50';
  const parsedBudget = Number(budgetRaw);
  if (!Number.isInteger(parsedBudget) || parsedBudget < 0 || parsedBudget > 500) {
    violations.push(
      'DAILY_LIVE_CALL_BUDGET must be an integer between 0 and 500 to protect daily free-tier allowances (§12)',
    );
  }

  if ((!mockAiDefault || imageProviderRaw === 'live') && parsedBudget <= 0) {
    violations.push(
      'Opting into live AI providers requires a positive DAILY_LIVE_CALL_BUDGET ceiling in Redis (§12)',
    );
  }

  if (violations.length > 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Portfolio free-tier readiness check failed: ${violations.join('; ')}`,
    );
  }

  return Object.freeze({
    compliant: true,
    mockAiDefault,
    imageProviderMode: imageProviderRaw as 'mock' | 'live',
    billingMode: billingModeRaw as 'mock' | 'razorpay_test',
    demoReadOnly: demoReadOnlyRaw === 'true',
    dailyLiveBudgetPerProvider: parsedBudget,
    violations: Object.freeze([]),
    // Required phrasing per Blueprint §12:
    postureStatement:
      'Designed to stay within available free allowances, subject to current eligibility and usage.',
  });
}

export interface ClusterReadinessSummary {
  readonly status: 'ready' | 'degraded';
  readonly services: Readonly<Record<UpstreamServiceTarget, boolean>>;
  readonly unhealthyServices: readonly UpstreamServiceTarget[];
}

/**
 * Probes `/readyz` across all four internal services (`auth`, `chat`, `agent`, `billing`)
 * through the Gateway's `UpstreamHttpClient`.
 */
export class CrossServiceHealthAggregator {
  private readonly upstreamClient: UpstreamHttpClient;
  private static readonly TARGETS: readonly UpstreamServiceTarget[] = [
    'auth',
    'chat',
    'agent',
    'billing',
  ];

  constructor(upstreamClient: UpstreamHttpClient) {
    this.upstreamClient = upstreamClient;
  }

  public async checkAllServices(
    traceId = 'trc_cluster_readyz',
  ): Promise<ClusterReadinessSummary> {
    const services: Record<UpstreamServiceTarget, boolean> = {
      auth: false,
      chat: false,
      agent: false,
      billing: false,
    };
    const unhealthyServices: UpstreamServiceTarget[] = [];

    for (const target of CrossServiceHealthAggregator.TARGETS) {
      try {
        const res = await this.upstreamClient.forward({
          target,
          method: 'GET',
          path: '/readyz',
          headers: {
            'x-trace-id': traceId,
          },
        });
        const ok = res.statusCode === 200;
        services[target] = ok;
        if (!ok) {
          unhealthyServices.push(target);
        }
      } catch {
        services[target] = false;
        unhealthyServices.push(target);
      }
    }

    return Object.freeze({
      status: unhealthyServices.length === 0 ? 'ready' : 'degraded',
      services: Object.freeze(services),
      unhealthyServices: Object.freeze(unhealthyServices),
    });
  }
}
