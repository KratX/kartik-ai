import { RedisKeys } from '@kartik/shared/redis';

export interface DailyBudgetStore {
  incrementHashCounter(
    key: string,
    field: string,
    ttlSeconds: number,
  ): Promise<number>;
  getHashCounter(key: string, field: string): Promise<number>;
}

export class InMemoryDailyBudgetStore implements DailyBudgetStore {
  private readonly store = new Map<
    string,
    { readonly fields: Map<string, number>; readonly expiresAtMs: number }
  >();

  public async incrementHashCounter(
    key: string,
    field: string,
    ttlSeconds: number,
  ): Promise<number> {
    const now = Date.now();
    const existing = this.store.get(key);
    if (!existing || existing.expiresAtMs <= now) {
      const fields = new Map<string, number>([[field, 1]]);
      this.store.set(key, {
        fields,
        expiresAtMs: now + ttlSeconds * 1000,
      });
      return 1;
    }

    const nextVal = (existing.fields.get(field) ?? 0) + 1;
    existing.fields.set(field, nextVal);
    return nextVal;
  }

  public async getHashCounter(key: string, field: string): Promise<number> {
    const now = Date.now();
    const existing = this.store.get(key);
    if (!existing || existing.expiresAtMs <= now) {
      return 0;
    }
    return existing.fields.get(field) ?? 0;
  }
}

export interface BudgetCheckDecision {
  readonly allowLive: boolean;
  readonly degradedToMock: boolean;
  readonly reason: 'mock_mode_default' | 'within_budget' | 'daily_budget_exhausted';
  readonly userDailyKey: string;
  readonly globalDailyKey: string;
  readonly currentCount: number;
  readonly dailyLimit: number;
}

/**
 * Enforces Blueprint §12 Free-tier & Quota rules:
 * "Enforce global per-provider daily budget counters in Redis, checked before every live call.
 * On exhaustion, degrade to mock mode with a clear message — do not fail hard."
 *
 * Uses canonical `RedisKeys.dailyQuota(userId, utcDayIso)` (`quota:{userId}:{day}`, 48h TTL, §5.2).
 */
export class DailyLiveBudgetGuard {
  private readonly store: DailyBudgetStore;
  private readonly dailyLimit: number;
  private readonly mockAiDefault: boolean;

  constructor(options: {
    readonly store: DailyBudgetStore;
    readonly dailyLimit: number;
    readonly mockAiDefault: boolean;
  }) {
    this.store = options.store;
    this.dailyLimit = options.dailyLimit;
    this.mockAiDefault = options.mockAiDefault;
  }

  public static formatUtcDayCompact(date: Date = new Date()): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }

  public async checkAndConsumeLiveCall(input: {
    readonly userId: string;
    readonly providerField: string;
    readonly now?: Date;
  }): Promise<BudgetCheckDecision> {
    const utcDay = DailyLiveBudgetGuard.formatUtcDayCompact(input.now);
    const userSpec = RedisKeys.dailyQuota(input.userId, utcDay);
    const globalSpec = RedisKeys.dailyQuota('global_live', utcDay);

    if (this.mockAiDefault) {
      return Object.freeze({
        allowLive: false,
        degradedToMock: false,
        reason: 'mock_mode_default',
        userDailyKey: userSpec.key,
        globalDailyKey: globalSpec.key,
        currentCount: 0,
        dailyLimit: this.dailyLimit,
      });
    }

    const globalCount = await this.store.incrementHashCounter(
      globalSpec.key,
      input.providerField,
      globalSpec.ttlSeconds,
    );
    const userCount = await this.store.incrementHashCounter(
      userSpec.key,
      input.providerField,
      userSpec.ttlSeconds,
    );

    const effectiveCount = Math.max(globalCount, userCount);
    if (effectiveCount > this.dailyLimit) {
      return Object.freeze({
        allowLive: false,
        degradedToMock: true,
        reason: 'daily_budget_exhausted',
        userDailyKey: userSpec.key,
        globalDailyKey: globalSpec.key,
        currentCount: effectiveCount,
        dailyLimit: this.dailyLimit,
      });
    }

    return Object.freeze({
      allowLive: true,
      degradedToMock: false,
      reason: 'within_budget',
      userDailyKey: userSpec.key,
      globalDailyKey: globalSpec.key,
      currentCount: effectiveCount,
      dailyLimit: this.dailyLimit,
    });
  }
}
