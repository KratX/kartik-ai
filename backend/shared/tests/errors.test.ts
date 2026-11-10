import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_CATALOGUE,
  AppError,
  createSuccessEnvelope,
  mapErrorToHttpResponse,
} from '../errors/index.js';

describe('@kartik/shared/errors catalogue, envelope & mapper (1.3.a)', () => {
  it('defines all 19 normative error codes with exact HTTP statuses (§5.5)', () => {
    const codes = Object.keys(ERROR_CATALOGUE);
    assert.equal(codes.length, 19);
    assert.equal(ERROR_CATALOGUE.VALIDATION_FAILED.httpStatus, 400);
    assert.equal(ERROR_CATALOGUE.UNAUTHENTICATED.httpStatus, 401);
    assert.equal(ERROR_CATALOGUE.QUOTA_EXHAUSTED.httpStatus, 402);
    assert.equal(ERROR_CATALOGUE.FORBIDDEN.httpStatus, 403);
    assert.equal(ERROR_CATALOGUE.DEMO_READ_ONLY.httpStatus, 403);
    assert.equal(ERROR_CATALOGUE.NOT_FOUND.httpStatus, 404);
    assert.equal(ERROR_CATALOGUE.IDEMPOTENCY_CONFLICT.httpStatus, 409);
    assert.equal(ERROR_CATALOGUE.EXECUTION_UNKNOWN.httpStatus, 409);
    assert.equal(ERROR_CATALOGUE.RATE_LIMITED.httpStatus, 429);
    assert.equal(ERROR_CATALOGUE.ARTIFACT_INVALID.httpStatus, 502);
    assert.equal(ERROR_CATALOGUE.LIMITER_UNAVAILABLE.httpStatus, 503);
    assert.equal(ERROR_CATALOGUE.PROVIDER_TIMEOUT.httpStatus, 504);
  });

  it('builds the canonical success envelope with traceId, requestId, and nextCursor (§5.4)', () => {
    const env = createSuccessEnvelope(
      '01JB7Z3K5S8F2Q0M3N6P9R1T4V',
      { items: ['conv_1'] },
      { requestId: '9f0c1c1e-6b1f-4d2a-9a25-1c1d5f8d5a11', nextCursor: 'cursor_abc' }
    );

    assert.equal(env.traceId, '01JB7Z3K5S8F2Q0M3N6P9R1T4V');
    assert.equal(env.requestId, '9f0c1c1e-6b1f-4d2a-9a25-1c1d5f8d5a11');
    assert.deepEqual(env.data, { items: ['conv_1'] });
    assert.equal(env.meta.nextCursor, 'cursor_abc');
    assert.equal(env.error, null);
  });

  it('maps AppError with validation details and Retry-After header on RATE_LIMITED', () => {
    const rateErr = new AppError('RATE_LIMITED', 'Too many chat requests.', {
      retryAfterSeconds: 15,
    });
    const res = mapErrorToHttpResponse(rateErr, {
      traceId: '01JB7Z3K5S8F2Q0M3N6P9R1T4V',
      requestId: 'req_123',
    });

    assert.equal(res.httpStatus, 429);
    assert.equal(res.headers['Retry-After'], '15');
    assert.equal(res.body.data, null);
    assert.equal(res.body.error?.code, 'RATE_LIMITED');
    assert.equal(res.body.requestId, 'req_123');
  });

  it('redacts raw Error exceptions into 500 INTERNAL_ERROR without leaking stack or db details', () => {
    const rawDbCrash = new Error('FATAL: password authentication failed for user "kartik_billing" at 10.0.1.9');
    const res = mapErrorToHttpResponse(rawDbCrash, {
      traceId: '01JB7Z3K5S8F2Q0M3N6P9R1T4V',
    });

    assert.equal(res.httpStatus, 500);
    assert.equal(res.body.error?.code, 'INTERNAL_ERROR');
    assert.equal(res.body.error?.message.includes('kartik_billing'), false);
    assert.equal(res.body.error?.message.includes('10.0.1.9'), false);
  });
});
