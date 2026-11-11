import { createPublicKey } from 'node:crypto';
import {
  loadConfig,
  ConfigValidationError,
  type ConfigSchema,
} from '@kartik/shared';

export const CHAT_CONFIG_SCHEMA: ConfigSchema = {
  NODE_ENV: {
    type: 'enum',
    enumValues: ['development', 'test', 'production'] as const,
    default: 'development',
  },
  PORT: {
    type: 'port',
    default: 4002,
  },
  DATABASE_URL: {
    type: 'url',
    required: true,
    secret: true,
  },
  REDIS_URL: {
    type: 'url',
    required: true,
    secret: true,
  },
  USER_CONTEXT_PUBLIC_KEY: {
    type: 'string',
    required: true,
    min: 32,
  },
  AGENT_SERVICE_URL: {
    type: 'url',
    default: 'http://localhost:4003',
  },
  BILLING_SERVICE_URL: {
    type: 'url',
    default: 'http://localhost:4004',
  },
  CHAT_TO_AGENT_TOKEN: {
    type: 'string',
    required: true,
    secret: true,
    min: 16,
  },
  CHAT_TO_BILLING_TOKEN: {
    type: 'string',
    required: true,
    secret: true,
    min: 16,
  },
  CURSOR_SIGNING_SECRET: {
    type: 'string',
    default: 'kartik-default-cursor-integrity-key',
    secret: true,
    min: 16,
  },
  DEMO_READ_ONLY: {
    type: 'boolean',
    default: false,
  },
  MAX_MESSAGE_CHARS: {
    type: 'int',
    default: 16_000,
    min: 1,
    max: 100_000,
  },
};

export interface ChatConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly userContextPublicKey: string;
  readonly agentServiceUrl: string;
  readonly billingServiceUrl: string;
  readonly chatToAgentToken: string;
  readonly chatToBillingToken: string;
  readonly cursorSigningSecret: string;
  readonly demoReadOnly: boolean;
  readonly maxMessageChars: number;
}

function normalizeEd25519PublicKeyPem(rawKey: string): string {
  const trimmed = rawKey.trim().replace(/\\n/g, '\n');
  if (trimmed.includes('-----BEGIN PUBLIC KEY-----')) {
    return trimmed;
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
    if (decoded.includes('-----BEGIN PUBLIC KEY-----')) {
      return decoded;
    }
  } catch {
    // Validated below via createPublicKey
  }
  return trimmed;
}

/**
 * Fail-fast environment loader for the Chat Service (@kartik/chat).
 *
 * Validates:
 * - Ed25519 `USER_CONTEXT_PUBLIC_KEY` (`aud === "chat"`).
 * - Internal caller credentials (`CHAT_TO_AGENT_TOKEN`, `CHAT_TO_BILLING_TOKEN`) so Chat can
 *   coordinate Billing credit reservations around Agent specialist execution (Invariant #6).
 */
export function loadChatConfig(
  env: Record<string, string | undefined> = process.env,
): ChatConfig {
  const raw = loadConfig(CHAT_CONFIG_SCHEMA, env) as {
    NODE_ENV: 'development' | 'test' | 'production';
    PORT: number;
    DATABASE_URL: string;
    REDIS_URL: string;
    USER_CONTEXT_PUBLIC_KEY: string;
    AGENT_SERVICE_URL: string;
    BILLING_SERVICE_URL: string;
    CHAT_TO_AGENT_TOKEN: string;
    CHAT_TO_BILLING_TOKEN: string;
    CURSOR_SIGNING_SECRET: string;
    DEMO_READ_ONLY: boolean;
    MAX_MESSAGE_CHARS: number;
  };

  const crossFieldErrors: Record<string, string> = {};
  const normalizedPublicKey = normalizeEd25519PublicKeyPem(raw.USER_CONTEXT_PUBLIC_KEY);

  try {
    const keyObj = createPublicKey(normalizedPublicKey);
    if (keyObj.type !== 'public' || keyObj.asymmetricKeyType !== 'ed25519') {
      crossFieldErrors.USER_CONTEXT_PUBLIC_KEY =
        'must be an Ed25519 public key in SPKI PEM format';
    }
  } catch {
    crossFieldErrors.USER_CONTEXT_PUBLIC_KEY =
      'invalid Ed25519 SPKI PEM public key format';
  }

  if (Object.keys(crossFieldErrors).length > 0) {
    throw new ConfigValidationError(crossFieldErrors);
  }

  return Object.freeze({
    nodeEnv: raw.NODE_ENV,
    port: raw.PORT,
    databaseUrl: raw.DATABASE_URL,
    redisUrl: raw.REDIS_URL,
    userContextPublicKey: normalizedPublicKey,
    agentServiceUrl: raw.AGENT_SERVICE_URL.replace(/\/+$/, ''),
    billingServiceUrl: raw.BILLING_SERVICE_URL.replace(/\/+$/, ''),
    chatToAgentToken: raw.CHAT_TO_AGENT_TOKEN,
    chatToBillingToken: raw.CHAT_TO_BILLING_TOKEN,
    cursorSigningSecret: raw.CURSOR_SIGNING_SECRET,
    demoReadOnly: raw.DEMO_READ_ONLY,
    maxMessageChars: raw.MAX_MESSAGE_CHARS,
  });
}
