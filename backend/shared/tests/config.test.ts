import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadConfig,
  redactConfig,
  ConfigValidationError,
  SHARED_INFRA_CONFIG_SCHEMA,
  type ConfigSchema,
} from '../config/index.js';

describe('@kartik/shared/config fail-fast validator & redactor (1.2.a)', () => {
  it('parses valid environment variables and applies defaults', () => {
    const schema: ConfigSchema = {
      ...SHARED_INFRA_CONFIG_SCHEMA,
      PORT: { type: 'port', default: 8002 },
      WORKER_ENABLED: { type: 'boolean', default: true },
      CHAT_TO_BILLING_CREDENTIAL: { type: 'secret32', required: true },
    };

    const parsed = loadConfig<{
      NODE_ENV: string;
      LOG_LEVEL: string;
      TZ: string;
      DATABASE_URL: string;
      DATABASE_SCHEMA: string;
      REDIS_URL: string;
      PORT: number;
      WORKER_ENABLED: boolean;
      CHAT_TO_BILLING_CREDENTIAL: string;
    }>(schema, {
      DATABASE_URL: 'postgresql://kartik_chat:super_secret_pw@localhost:5432/kartik',
      DATABASE_SCHEMA: 'chat',
      REDIS_URL: 'redis://:redis_secret_pw@localhost:6379',
      PORT: '8002',
      WORKER_ENABLED: 'false',
      CHAT_TO_BILLING_CREDENTIAL: 'chat_to_billing_secret_32_bytes_minimum_ok',
    });

    assert.equal(parsed.NODE_ENV, 'development');
    assert.equal(parsed.PORT, 8002);
    assert.equal(parsed.WORKER_ENABLED, false);
    assert.equal(parsed.DATABASE_SCHEMA, 'chat');
  });

  it('fails startup naming offending variables and never leaks secret values in error messages (Phase 1 Exit Gate)', () => {
    const leakedSecretValue = 'short_secret_that_must_never_appear_in_error_999';
    const invalidDbUrl = 'not-a-valid-url-with-password-xyz987';

    const schema: ConfigSchema = {
      ...SHARED_INFRA_CONFIG_SCHEMA,
      GATEWAY_CALLER_CREDENTIAL: { type: 'secret32', min: 64, required: true },
    };

    assert.throws(
      () =>
        loadConfig(schema, {
          DATABASE_URL: invalidDbUrl,
          DATABASE_SCHEMA: 'invalid_schema_name',
          // REDIS_URL intentionally omitted
          GATEWAY_CALLER_CREDENTIAL: leakedSecretValue,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigValidationError);
        // Must name all offending variables
        assert.deepEqual(err.invalidVariables, [
          'DATABASE_URL',
          'DATABASE_SCHEMA',
          'REDIS_URL',
          'GATEWAY_CALLER_CREDENTIAL',
        ]);
        // Phase 1 Exit Gate: Error message must NEVER print the offending raw values
        assert.equal(err.message.includes(leakedSecretValue), false);
        assert.equal(err.message.includes(invalidDbUrl), false);
        assert.equal(err.message.includes('invalid_schema_name'), false);
        return true;
      }
    );
  });

  it('redacts secret keys and masks embedded URL passwords in redactConfig()', () => {
    const rawConfig = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://kartik_auth:my_db_pass_123@ep-pooler.neon.tech/kartik',
      REDIS_URL: 'rediss://default:upstash_tok_456@upstash.io:6379',
      GATEWAY_CALLER_CREDENTIAL: '32_byte_caller_credential_secret_value_abc',
      GROQ_API_KEY: 'gsk_live_secret_key_value',
    };

    const dumped = redactConfig(rawConfig, SHARED_INFRA_CONFIG_SCHEMA);
    assert.equal(dumped.NODE_ENV, 'production');
    assert.equal(dumped.GATEWAY_CALLER_CREDENTIAL, '[REDACTED]');
    assert.equal(dumped.GROQ_API_KEY, '[REDACTED]');
    assert.equal(String(dumped.DATABASE_URL).includes('my_db_pass_123'), false);
    assert.equal(String(dumped.REDIS_URL).includes('upstash_tok_456'), false);
  });
});
