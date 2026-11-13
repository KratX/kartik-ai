/**
 * @kartik/agent/services/agent-rate-limiter — Per-Agent Sliding-Window Rate Limiter
 * (Blueprint §9.4, §12, §15.1 & Tutorial Part 2 `checkAgentLimit`).
 *
 * Enforces the normative per-minute limits per user and specialist agent:
 * - `chat`: 20 requests / minute
 * - Specialist agents (`coding`, `pdf`, `ppt`, `rag`, `vision`, `image`, `search`): 5 requests / minute
 *
 * Returns `429 RATE_LIMITED` with `retryAfterSeconds` when exceeded.
 */

import { AppError } from '@kartik/shared/errors';
import { RedisKeys } from '@kartik/shared/redis';
import type { SpecialistAgentName } from '@kartik/shared/contracts';

export const AGENT_RATE_LIMITS_PER_MINUTE: Readonly<Record<SpecialistAgentName, number>> =
  Object.freeze({
    chat: 20,
    coding: 5,
    pdf: 5,
    ppt: 5,
    rag: 5,
    vision: 5,
    image: 5,
    search: 5,
  });

export const AGENT_RATE_LIMIT_WINDOW_SECONDS = 60 as const;

export interface AgentRateLimitCheckResult {
  readonly allowed: boolean;
  readonly agent: SpecialistAgentName;
  readonly limit: number;
  readonly limitPerMinute: number;
  readonly currentCount: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  readonly redisKey: string;
}

export type AgentRateLimitDecision = AgentRateLimitCheckResult;

export interface AgentRateLimitStore {
  incrementWindowCounter(key: string, ttlSeconds: number, nowMs?: number): Promise<{
    readonly count: number;
    readonly expiresAtMs: number;
  }>;
}

export class InMemoryAgentRateLimitStore implements AgentRateLimitStore {
  private readonly nowFn: () => number;
  private readonly windows = new Map<
    string,
    { count: number; readonly expiresAtMs: number }
  >();

  constructor(nowFn: () => number = () => Date.now()) {
    this.nowFn = nowFn;
  }

  public async incrementWindowCounter(
    key: string,
    ttlSeconds: number,
    nowMs: number = this.nowFn(),
  ): Promise<{ readonly count: number; readonly expiresAtMs: number }> {
    const existing = this.windows.get(key);
    if (!existing || existing.expiresAtMs <= nowMs) {
      const expiresAtMs = nowMs + ttlSeconds * 1000;
      this.windows.set(key, { count: 1, expiresAtMs });
      return { count: 1, expiresAtMs };
    }
    existing.count += 1;
    return { count: existing.count, expiresAtMs: existing.expiresAtMs };
  }
}

export class AgentSlidingWindowRateLimiter {
  private readonly store: AgentRateLimitStore;
  private readonly limits: Readonly<Record<SpecialistAgentName, number>>;
  private readonly windowSeconds: number;

  constructor(options?: {
    readonly store?: AgentRateLimitStore;
    readonly limits?: Partial<Record<SpecialistAgentName, number>>;
    readonly windowSeconds?: number;
  }) {
    this.store = options?.store ?? new InMemoryAgentRateLimitStore();
    this.limits = Object.freeze({
      ...AGENT_RATE_LIMITS_PER_MINUTE,
      ...(options?.limits ?? {}),
    });
    this.windowSeconds = options?.windowSeconds ?? AGENT_RATE_LIMIT_WINDOW_SECONDS;
  }

  public async checkAgentLimit(input: {
    readonly userId: string;
    readonly agent: SpecialistAgentName;
    readonly nowMs?: number;
    readonly throwOnExceeded?: boolean;
  }): Promise<AgentRateLimitCheckResult> {
    const nowMs = input.nowMs ?? Date.now();
    const minuteBucket = String(Math.floor(nowMs / (this.windowSeconds * 1000)));
    const keySpec = RedisKeys.userRateLimit(
      input.agent,
      input.userId,
      minuteBucket,
      this.windowSeconds,
    );

    const limit = this.limits[input.agent] ?? 5;
    const { count, expiresAtMs } = await this.store.incrementWindowCounter(
      keySpec.key,
      keySpec.ttlSeconds,
      input.nowMs,
    );

    const retryAfterSeconds = Math.max(1, Math.ceil((expiresAtMs - nowMs) / 1000));
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);

    const decision: AgentRateLimitCheckResult = Object.freeze({
      allowed,
      agent: input.agent,
      limit,
      limitPerMinute: limit,
      currentCount: count,
      remaining,
      retryAfterSeconds: allowed ? 0 : retryAfterSeconds,
      redisKey: keySpec.key,
    });

    if (!allowed && (input.throwOnExceeded ?? true)) {
      throw new AppError(
        'RATE_LIMITED',
        `Rate limit exceeded for ${input.agent} agent (${limit} requests/min). Please retry in ${retryAfterSeconds}s.`,
        {
          retryAfterSeconds,
          details: {
            agent: [input.agent],
            retryAfterSeconds: [String(retryAfterSeconds)],
          },
        },
      );
    }

    return decision;
  }
}
