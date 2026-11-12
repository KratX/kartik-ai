/**
 * @file frontend/tests/interactive-demo-harness.test.ts
 * @description Unit & integration tests for `@kartik/frontend/app/interactive-demo-harness`
 * (Micro-step 8.6.a — Interactive Multi-Agent Workbench, Idempotency Replay & DEMO_READ_ONLY).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInteractiveDemoHarness,
  GatewayApiError,
  inferSpecialistFromPrompt,
} from '../src/index.js';

describe('@kartik/frontend Interactive Multi-Agent Demo Harness (8.6.a)', () => {
  it('routes specialist turns, generates sandboxed coding artifacts, and enforces 0-charge Idempotency-Key replay (Invariants #11, #12, #15)', async () => {
    const harness = createInteractiveDemoHarness({ initialCredits: 200 });

    await harness.shell.bootstrapAndSignIn('mock_id_token_86a');
    const convs = harness.getConversations();
    assert.equal(convs.length, 1);
    const convId = convs[0]!.conversationId;

    // 1. Send a coding specialist turn
    harness.shell.store.setSelectedSpecialist('coding');
    const codingBundle = harness.getArtifactBundle('art_seed_sandbox_01');
    const res = await harness.shell.submitSpecialistTurn({
      conversationId: convId,
      prompt: 'Build an interactive token calculator widget',
      artifactBundleForPreview: codingBundle,
    });

    assert.equal(res.state.availableCredits, 190); // 200 - 10 (coding cost)
    assert.ok(res.sandboxPreview);
    assert.equal(res.sandboxPreview.iframeSandboxAttribute, 'allow-scripts');

    // 2. Replay the exact same turn with the same Idempotency-Key -> 0 credits deducted
    const replay = await harness.replayLastTurnWithSameIdempotencyKey();
    assert.ok(replay);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.remainingCredits, 190);
    assert.equal(harness.getCreditSnapshot().availableCredits, 190);

    // 3. Verify audit trail recorded both the initial 201 and the 200 idempotent replay
    const trail = harness.getAuditTrail();
    assert.equal(trail[0]?.idempotentReplay, true);
    assert.equal(trail[0]?.creditsDelta, 0);
    assert.equal(trail[1]?.idempotentReplay, false);
    assert.equal(trail[1]?.creditsDelta, -10);
  });

  it('enforces DEMO_READ_ONLY kill switch on mutating requests (403 DEMO_READ_ONLY) while allowing GET browsing (§12)', async () => {
    const harness = createInteractiveDemoHarness({
      initialCredits: 100,
      initialDemoReadOnly: true,
    });

    // GET browsing still succeeds under DEMO_READ_ONLY=true
    const convList = await harness.client.listConversations();
    assert.equal(convList.items.length, 1);

    // Mutating turn fails with 403 DEMO_READ_ONLY and activates demoReadOnlyBanner
    await assert.rejects(
      async () => {
        await harness.shell.submitSpecialistTurn({
          conversationId: convList.items[0]!.conversationId,
          prompt: 'Attempt write during read-only freeze',
        });
      },
      (err: unknown) =>
        err instanceof GatewayApiError &&
        err.statusCode === 403 &&
        err.code === 'DEMO_READ_ONLY',
    );
    assert.equal(harness.shell.getState().demoReadOnlyBanner, true);

    // Turning off DEMO_READ_ONLY restores mutating capability and tops up credits via server-priced planId
    harness.setDemoReadOnly(false);
    const topUp = await harness.shell.topUpCreditsWithPlan({
      planId: 'starter_100',
      razorpayPaymentId: 'pay_mock_86a',
      razorpaySignature: 'sig_mock_86a',
    });
    assert.equal(topUp.formattedOrderAmount, '₹99.00');
    assert.equal(topUp.verification.availableCreditsAfter, 200);
  });

  it('infers specialist agents deterministically from prompts and attachment presence', () => {
    assert.equal(
      inferSpecialistFromPrompt('Build a calculator widget in HTML', false),
      'coding',
    );
    assert.equal(
      inferSpecialistFromPrompt('Summarize page 4 of this document', true),
      'rag',
    );
    assert.equal(
      inferSpecialistFromPrompt('Search latest Node.js 26 news', false),
      'search',
    );
    assert.equal(
      inferSpecialistFromPrompt('Generate image of a minimal poster', false),
      'image',
    );
    assert.equal(
      inferSpecialistFromPrompt('Inspect image diagram architecture', false),
      'vision',
    );
    assert.equal(
      inferSpecialistFromPrompt('Hello, how are you today?', false),
      'chat',
    );
  });
});
