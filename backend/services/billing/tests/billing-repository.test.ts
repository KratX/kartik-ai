import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError,
  ConfigValidationError,
  generateEd25519KeyPair,
  type DatabaseClient,
  type DatabasePool,
  type QueryResultRow,
} from '@kartik/shared';
import {
  BILLING_INITIAL_MIGRATION,
  DEFAULT_BILLING_PLANS,
  InMemoryBillingRepository,
  PostgresBillingRepository,
  loadBillingConfig,
  resolveBillingPlan,
} from '../src/index.js';

const TEST_KEY_PAIR = generateEd25519KeyPair();
const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';

const VALID_BILLING_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  BILLING_DATABASE_URL: 'postgresql://billing_user:secret@localhost:5432/kartik?schema=billing',
  REDIS_URL: 'redis://localhost:6379/0',
  USER_CONTEXT_PUBLIC_KEY: TEST_KEY_PAIR.publicKeyPem,
  GATEWAY_TO_BILLING_TOKEN: 's2s_gateway_to_billing_secret_01',
  CHAT_TO_BILLING_TOKEN: 's2s_chat_to_billing_secret_00001',
};

describe('@kartik/billing config, integer paise models & SELECT FOR UPDATE repository (4.1.a)', () => {
  it('validates Billing config with BILLING_MODE=mock default and enforces live Razorpay secrets when BILLING_MODE=live (§6 & §11)', () => {
    const config = loadBillingConfig(VALID_BILLING_ENV);
    assert.equal(config.PORT, 3004);
    assert.equal(config.BILLING_MODE, 'mock');
    assert.equal(config.FREE_TIER_INITIAL_CREDITS, 100);
    assert.equal(config.RESERVATION_TTL_SECONDS, 900);

    // Fails when BILLING_MODE=live without Razorpay secrets
    assert.throws(
      () =>
        loadBillingConfig({
          ...VALID_BILLING_ENV,
          BILLING_MODE: 'live',
        }),
      (err: unknown) => {
        if (!(err instanceof ConfigValidationError)) return false;
        assert.equal(err.invalidVariables.includes('RAZORPAY_KEY_ID'), true);
        assert.equal(err.invalidVariables.includes('RAZORPAY_KEY_SECRET'), true);
        assert.equal(err.invalidVariables.includes('RAZORPAY_WEBHOOK_SECRET'), true);
        return true;
      },
    );
  });

  it('defines server-side plans in integer paise and enforces non-negative CHECK constraints in 0001_billing_core.sql (§11, Invariant #17)', () => {
    for (const plan of DEFAULT_BILLING_PLANS) {
      assert.equal(Number.isInteger(plan.pricePaise), true);
      assert.equal(plan.currency, 'INR');
    }

    const starter = resolveBillingPlan('starter_inr_499');
    if (!starter) throw new Error('Expected starter plan');
    assert.equal(starter.pricePaise, 49_900);
    assert.equal(starter.creditsGranted, 500);

    const pro = resolveBillingPlan('pro_inr_1499');
    if (!pro) throw new Error('Expected pro plan');
    assert.equal(pro.pricePaise, 149_900);
    assert.equal(pro.creditsGranted, 2_000);

    assert.equal(resolveBillingPlan('unknown_plan'), null);

    // Verify 0001_billing_core.sql enforces non-negative balance CHECK constraints
    assert.match(BILLING_INITIAL_MIGRATION.sql, /CHECK \(available_credits >= 0\)/);
    assert.match(BILLING_INITIAL_MIGRATION.sql, /CHECK \(reserved_credits >= 0\)/);
    assert.match(BILLING_INITIAL_MIGRATION.sql, /CHECK \(amount_paise > 0\)/);
  });

  it('grants initial free-tier credits idempotently and rolls back atomically on negative balance attempts in InMemoryBillingRepository (Invariant #17)', async () => {
    const repo = new InMemoryBillingRepository();

    const first = await repo.ensureAccount(TEST_USER_ID, 100);
    const second = await repo.ensureAccount(TEST_USER_ID, 100);
    assert.equal(first.availableCredits, 100);
    assert.equal(second.availableCredits, 100);

    const ledgerBefore = await repo.listLedgerEntries(TEST_USER_ID);
    assert.equal(ledgerBefore.length, 1);
    assert.equal(ledgerBefore[0]?.entryType, 'INITIAL_GRANT');
    assert.equal(ledgerBefore[0]?.deltaCredits, 100);

    // Attempt a transaction that tries to set negative availableCredits -> throws 402 QUOTA_EXHAUSTED and rolls back
    await assert.rejects(
      () =>
        repo.withLockedAccount(TEST_USER_ID, 100, async (tx) => {
          await tx.appendLedgerEntry({
            userId: TEST_USER_ID,
            requestId: 'req_rollback_01',
            entryType: 'RESERVE_HOLD',
            deltaCredits: -150,
            balanceAfter: 0,
            description: 'Should roll back when balance update fails',
          });
          await tx.updateAccountBalances({
            availableCredits: -50,
            reservedCredits: 150,
          });
        }),
      (err: unknown) => err instanceof AppError && err.code === 'QUOTA_EXHAUSTED',
    );

    const afterRollback = await repo.ensureAccount(TEST_USER_ID, 100);
    assert.equal(afterRollback.availableCredits, 100);
    assert.equal(afterRollback.reservedCredits, 0);
    const ledgerAfter = await repo.listLedgerEntries(TEST_USER_ID);
    assert.equal(ledgerAfter.length, 1);
  });

  it('executes SELECT ... FOR UPDATE inside a BEGIN/COMMIT transaction in PostgresBillingRepository (Invariant #17)', async () => {
    const executedSql: string[] = [];

    const fakeClient: DatabaseClient = {
      async query<TRow = QueryResultRow>(text: string) {
        const normalized = text.replace(/\s+/g, ' ').trim();
        executedSql.push(normalized);

        if (normalized.includes('SELECT') && normalized.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                user_id: TEST_USER_ID,
                plan_id: 'free',
                available_credits: 100,
                reserved_credits: 0,
                lifetime_credited: 100,
                lifetime_debited: 0,
                created_at: '2026-11-11T00:00:00.000Z',
                updated_at: '2026-11-11T00:00:00.000Z',
              } as unknown as TRow,
            ],
            rowCount: 1,
          };
        }

        if (normalized.startsWith('UPDATE billing.credit_accounts')) {
          return {
            rows: [
              {
                user_id: TEST_USER_ID,
                plan_id: 'free',
                available_credits: 80,
                reserved_credits: 20,
                lifetime_credited: 100,
                lifetime_debited: 0,
                created_at: '2026-11-11T00:00:00.000Z',
                updated_at: '2026-11-11T00:00:01.000Z',
              } as unknown as TRow,
            ],
            rowCount: 1,
          };
        }

        return { rows: [], rowCount: 1 };
      },
      release() {},
    };

    const fakePool: DatabasePool = {
      async connect() {
        return fakeClient;
      },
      async query<TRow = QueryResultRow>(text: string) {
        return fakeClient.query<TRow>(text);
      },
      async end() {},
    };

    const pgRepo = new PostgresBillingRepository(fakePool);
    const updated = await pgRepo.withLockedAccount(TEST_USER_ID, 100, async (tx) => {
      assert.equal(tx.account.availableCredits, 100);
      return tx.updateAccountBalances({
        availableCredits: 80,
        reservedCredits: 20,
      });
    });

    assert.equal(updated.availableCredits, 80);
    assert.equal(updated.reservedCredits, 20);
    assert.equal(executedSql[0], 'BEGIN ISOLATION LEVEL READ COMMITTED');
    assert.ok(
      executedSql.some(
        (sql) =>
          sql.includes('FROM billing.credit_accounts') && sql.includes('FOR UPDATE'),
      ),
      'Must lock credit_accounts row with SELECT ... FOR UPDATE before reading or mutating balance',
    );
    assert.equal(executedSql[executedSql.length - 1], 'COMMIT');
  });
});
