import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, type LogEntry } from '../logger/index.js';

describe('@kartik/shared/logger structured JSON & redaction (1.4.a)', () => {
  it('emits structured JSON carrying service, traceId, and requestId via child logger', () => {
    const captured: LogEntry[] = [];
    const rootLogger = createLogger({
      service: 'chat',
      level: 'info',
      sink: (_line, entry) => captured.push(entry),
    });

    const reqLogger = rootLogger.child({
      traceId: '01JB7Z3K5S8F2Q0M3N6P9R1T4V',
      requestId: '9f0c1c1e-6b1f-4d2a-9a25-1c1d5f8d5a11',
      userId: 'usr_kartik_01',
    });

    reqLogger.debug('debug message filtered out at info level');
    reqLogger.info('persisted user message before agent run', { conversationId: 'conv_99' });

    assert.equal(captured.length, 1);
    const first = captured[0];
    assert.ok(first);
    assert.equal(first.service, 'chat');
    assert.equal(first.level, 'info');
    assert.equal(first.traceId, '01JB7Z3K5S8F2Q0M3N6P9R1T4V');
    assert.equal(first.requestId, '9f0c1c1e-6b1f-4d2a-9a25-1c1d5f8d5a11');
    assert.equal(first.userId, 'usr_kartik_01');
    assert.equal(first.conversationId, 'conv_99');
  });

  it('redacts cookies, authorization headers, API keys, signed URLs, and Razorpay secrets (Gate G9)', () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: 'gateway',
      level: 'debug',
      sink: (line) => lines.push(line),
    });

    logger.info('incoming request with sensitive headers and inline bearer', {
      traceId: '01JB7Z3K5S8F2Q0M3N6P9R1T4V',
      headers: {
        cookie: 'kartik_session=super_secret_session_id_12345',
        authorization: 'Bearer eyJhbGciOiJFZERTQSJ9.secret_payload.sig',
        'x-razorpay-signature': 'hmac_sha256_webhook_sig_xyz',
      },
      providerConfig: {
        RAZORPAY_KEY_SECRET: 'rzp_secret_live_99999',
        GROQ_API_KEY: 'gsk_secret_token_value_abc',
        signedUrl: 'https://r2.cloudflarestorage.com/kartik-artifacts/obj?X-Amz-Signature=secret',
      },
      rawHeaderEcho: 'Authorization: Bearer token_inline_987654 and kartik_session=raw_cookie_val',
    });

    assert.equal(lines.length, 1);
    const rawJson = lines[0] ?? '';

    assert.equal(rawJson.includes('super_secret_session_id_12345'), false);
    assert.equal(rawJson.includes('eyJhbGciOiJFZERTQSJ9'), false);
    assert.equal(rawJson.includes('hmac_sha256_webhook_sig_xyz'), false);
    assert.equal(rawJson.includes('rzp_secret_live_99999'), false);
    assert.equal(rawJson.includes('gsk_secret_token_value_abc'), false);
    assert.equal(rawJson.includes('X-Amz-Signature=secret'), false);
    assert.equal(rawJson.includes('token_inline_987654'), false);
    assert.equal(rawJson.includes('raw_cookie_val'), false);
    assert.equal(rawJson.includes('[REDACTED]'), true);
  });
});
