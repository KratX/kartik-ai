import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppError, REDIS_TTL_SECONDS } from '@kartik/shared';
import {
  CreditReservationService,
  InMemoryBillingRepository,
  InMemoryMoneyIdempotencyStore,
} from '../src/index.js';

const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('@kartik/billing CreditReservationService reserve/settle/release & no-overdraw proof (4.2.a)', () => {
  it('executes reserve -> partial settle (refunding unused hold) and reserve -> release with 30d money idempotency (§5.2, §5.4, §11)', async () => {
    const repository = new InMemoryBillingRepository();
    const idempotencyStore = new InMemoryMoneyIdempotencyStore();
    const service = new CreditReservationService({
      repository,
      idempotencyStore,
      initialFreeCredits: 100,
    });

    // 1. Reserve 20 credits for code_generation
    const reserved = await service.reserveCredits({
      requestId: 'idem_reserve_code_0001',
      traceId: 'trc_42a_01',
      userId: TEST_USER_ID,
      conversationId: 'conv_01',
      agent: 'coding',
      operation: 'code_generation',
    });

    assert.equal(reserved.status, 'reserved');
    assert.equal(reserved.reservedCredits, 20);

    const idemRecord = await idempotencyStore.get(
      `idem:${TEST_USER_ID}:idem_reserve_code_0001`,
    );
    assert.ok(idemRecord);
    assert.equal(idemRecord.ttlSeconds, REDIS_TTL_SECONDS.IDEMPOTENCY_MONEY);

    let balance = await service.getBalance(TEST_USER_ID);
    assert.equal(balance.availableCredits, 80);
    assert.equal(balance.reservedCredits, 20);

    // 2. Settle only 15 actual credits -> 5 unused credits refunded to availableCredits
    const settled = await service.settleCredits({
      requestId: 'idem_reserve_code_0001',
      reservationId: reserved.reservationId,
      traceId: 'trc_42a_02',
      userId: TEST_USER_ID,
      actualUnits: 15,
    });

    assert.equal(settled.status, 'settled');
    assert.equal(settled.settledCredits, 15);
    assert.equal(settled.refundedCredits, 5);
    assert.equal(settled.availableCreditsAfter, 85);
    assert.equal(settled.reservedCreditsAfter, 0);

    // 3. Reserve 30 credits for image_generation and release on provider failure
    const imgReserve = await service.reserveCredits({
      requestId: 'idem_reserve_image_0002',
      traceId: 'trc_42a_03',
      userId: TEST_USER_ID,
      conversationId: 'conv_01',
      agent: 'image',
      operation: 'image_generation',
    });

    balance = await service.getBalance(TEST_USER_ID);
    assert.equal(balance.availableCredits, 55);
    assert.equal(balance.reservedCredits, 30);

    const released = await service.releaseCredits({
      requestId: 'idem_reserve_image_0002',
      reservationId: imgReserve.reservationId,
      traceId: 'trc_42a_04',
      userId: TEST_USER_ID,
      reason: 'Image provider timed out before generation',
    });

    assert.equal(released.status, 'released');
    assert.equal(released.releasedCredits, 30);
    assert.equal(released.availableCreditsAfter, 85);
    assert.equal(released.reservedCreditsAfter, 0);
  });

  it('replays identical reserve requests idempotently and rejects mutated payloads with 409 IDEMPOTENCY_CONFLICT (§5.4, Invariant #15)', async () => {
    const repository = new InMemoryBillingRepository();
    const service = new CreditReservationService({
      repository,
      initialFreeCredits: 100,
    });

    const first = await service.reserveCredits({
      requestId: 'idem_replay_test_00001',
      traceId: 'trc_42a_05',
      userId: TEST_USER_ID,
      conversationId: 'conv_01',
      agent: 'chat',
      operation: 'chat_turn',
    });

    // Exact retry with same requestId and payload -> returns same reservationId, deducts only once
    const replay = await service.reserveCredits({
      requestId: 'idem_replay_test_00001',
      traceId: 'trc_42a_06',
      userId: TEST_USER_ID,
      conversationId: 'conv_01',
      agent: 'chat',
      operation: 'chat_turn',
    });

    assert.equal(replay.reservationId, first.reservationId);
    const balance = await service.getBalance(TEST_USER_ID);
    assert.equal(balance.availableCredits, 90);
    assert.equal(balance.reservedCredits, 10);

    // Retry with same requestId but different operation/agent -> 409 IDEMPOTENCY_CONFLICT
    await assert.rejects(
      () =>
        service.reserveCredits({
          requestId: 'idem_replay_test_00001',
          traceId: 'trc_42a_07',
          userId: TEST_USER_ID,
          conversationId: 'conv_01',
          agent: 'image',
          operation: 'image_generation',
        }),
      (err: unknown) => err instanceof AppError && err.code === 'IDEMPOTENCY_CONFLICT',
    );
  });

  it('enforces idempotent settle/release retries and rejects illegal cross-transitions with 409 IDEMPOTENCY_CONFLICT', async () => {
    const repository = new InMemoryBillingRepository();
    const service = new CreditReservationService({
      repository,
      initialFreeCredits: 100,
    });

    const res = await service.reserveCredits({
      requestId: 'idem_state_guard_00001',
      traceId: 'trc_42a_08',
      userId: TEST_USER_ID,
      conversationId: 'conv_01',
      agent: 'search',
      operation: 'web_search',
    });

    const settled1 = await service.settleCredits({
      requestId: 'idem_state_guard_00001',
      reservationId: res.reservationId,
      traceId: 'trc_42a_09',
      userId: TEST_USER_ID,
    });
    const settled2 = await service.settleCredits({
      requestId: 'idem_state_guard_00001',
      reservationId: res.reservationId,
      traceId: 'trc_42a_10',
      userId: TEST_USER_ID,
    });

    assert.equal(settled1.availableCreditsAfter, 85);
    assert.equal(settled2.availableCreditsAfter, 85);

    // Attempting to release an already-settled reservation -> 409 IDEMPOTENCY_CONFLICT
    await assert.rejects(
      () =>
        service.releaseCredits({
          requestId: 'idem_state_guard_00001',
          reservationId: res.reservationId,
          traceId: 'trc_42a_11',
          userId: TEST_USER_ID,
          reason: 'late release attempt',
        }),
      (err: unknown) => err instanceof AppError && err.code === 'IDEMPOTENCY_CONFLICT',
    );
  });

  it('proves zero overdraw under 10 concurrent 30-credit reservations against a 100-credit balance (Invariant #17, Phase 4 Exit Gate)', async () => {
    const repository = new InMemoryBillingRepository();
    const service = new CreditReservationService({
      repository,
      initialFreeCredits: 100,
    });

    // Fire 10 simultaneous reservations of 30 credits each against 100 initial credits
    const concurrentAttempts = Array.from({ length: 10 }, (_, idx) =>
      service.reserveCredits({
        requestId: `idem_concurrent_race_${String(idx).padStart(4, '0')}`,
        traceId: `trc_race_${idx}`,
        userId: TEST_USER_ID,
        conversationId: 'conv_concurrency',
        agent: 'image',
        operation: 'image_generation', // 30 credits each
      }),
    );

    const outcomes = await Promise.allSettled(concurrentAttempts);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    // Exactly 3 * 30 = 90 credits can be reserved; 7 must fail with 402 QUOTA_EXHAUSTED
    assert.equal(fulfilled.length, 3);
    assert.equal(rejected.length, 7);

    for (const failure of rejected) {
      assert.equal(failure.status, 'rejected');
      assert.equal(failure.reason instanceof AppError, true);
      assert.equal((failure.reason as AppError).code, 'QUOTA_EXHAUSTED');
    }

    const finalBalance = await service.getBalance(TEST_USER_ID);
    assert.equal(finalBalance.availableCredits, 10);
    assert.equal(finalBalance.reservedCredits, 90);
    assert.equal(finalBalance.availableCredits >= 0, true);
  });
});
