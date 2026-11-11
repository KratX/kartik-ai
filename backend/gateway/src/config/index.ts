/**
 * @file backend/gateway/src/config/index.ts
 * @description API Gateway Environment Configuration & Upstream Service Directory
 * (Blueprint §2.1, §6.1, §6.2, §6.3, §6.4, §11, §12 & Architecture Invariants #1, #14, #15).
 *
 * Architectural rules enforced at startup:
 * 1. The browser talks to the backend only through the API Gateway (`PORT_GATEWAY`, default 8000) (Invariant #1).
 * 2. Gateway holds the Ed25519 private key (`USER_CONTEXT_SIGNING_KEY`) used to mint short-lived
 *    `x-user-context` assertions for downstream services (`chat`, `agent`, `billing`) (§6.4).
 *    Startup validates that `USER_CONTEXT_SIGNING_KEY` is a valid Ed25519 private key and fails
 *    fast naming only `USER_CONTEXT_SIGNING_KEY` (never printing the key material).
 * 3. `CORS_ALLOWED_ORIGINS` is parsed into explicit origin strings; wildcard `*` is rejected
 *    because the Gateway uses `HttpOnly` credentialed session cookies (§11).
 */

import { createPrivateKey } from 'node:crypto';
import {
  ConfigValidationError,
  loadConfig,
  type ConfigSchema,
} from '@kartik/shared';

export type UpstreamServiceTarget = 'auth' | 'chat' | 'agent' | 'billing';

export const GATEWAY_CONFIG_SCHEMA: ConfigSchema = {
  NODE_ENV: {
    type: 'enum',
    enumValues: ['development', 'test', 'production'] as const,
    default: 'development',
  },
  LOG_LEVEL: {
    type: 'enum',
    enumValues: ['debug', 'info', 'warn', 'error'] as const,
    default: 'info',
  },
  PORT_GATEWAY: {
    type: 'port',
    default: 8000,
  },
  REDIS_URL: {
    type: 'url',
    required: true,
  },
  AUTH_SERVICE_URL: {
    type: 'url',
    default: 'http://127.0.0.1:8001',
  },
  CHAT_SERVICE_URL: {
    type: 'url',
    default: 'http://127.0.0.1:8002',
  },
  AGENT_SERVICE_URL: {
    type: 'url',
    default: 'http://127.0.0.1:8003',
  },
  BILLING_SERVICE_URL: {
    type: 'url',
    default: 'http://127.0.0.1:8004',
  },
  SERVICE_TO_SERVICE_TOKEN: {
    type: 'string',
    required: true,
    min: 16,
    secret: true,
  },
  USER_CONTEXT_SIGNING_KEY: {
    type: 'string',
    required: true,
    min: 32,
    secret: true,
  },
  SESSION_COOKIE_NAME: {
    type: 'string',
    default: 'kartik_session',
  },
  CORS_ALLOWED_ORIGINS: {
    type: 'string',
    default: 'http://localhost:5173,http://127.0.0.1:5173',
  },
  DEMO_READ_ONLY: {
    type: 'boolean',
    default: false,
  },
  UPSTREAM_TIMEOUT_MS: {
    type: 'int',
    default: 15_000,
    min: 500,
    max: 120_000,
  },
};

export interface GatewayServiceConfig {
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  readonly PORT_GATEWAY: number;
  readonly REDIS_URL: string;
  readonly AUTH_SERVICE_URL: string;
  readonly CHAT_SERVICE_URL: string;
  readonly AGENT_SERVICE_URL: string;
  readonly BILLING_SERVICE_URL: string;
  readonly SERVICE_TO_SERVICE_TOKEN: string;
  readonly USER_CONTEXT_SIGNING_KEY: string;
  readonly SESSION_COOKIE_NAME: string;
  readonly CORS_ALLOWED_ORIGINS: string;
  readonly allowedOrigins: readonly string[];
  readonly DEMO_READ_ONLY: boolean;
  readonly UPSTREAM_TIMEOUT_MS: number;
}

function normalizePemForValidation(raw: string): string {
  const trimmed = raw.trim().replace(/\\n/g, '\n');
  if (trimmed.startsWith('-----BEGIN ')) {
    return trimmed;
  }
  return Buffer.from(trimmed, 'base64').toString('utf8').replace(/\\n/g, '\n');
}

function isValidEd25519PrivateKey(rawPemOrBase64: string): boolean {
  try {
    const pem = normalizePemForValidation(rawPemOrBase64);
    const keyObj = createPrivateKey(pem);
    return keyObj.type === 'private' && keyObj.asymmetricKeyType === 'ed25519';
  } catch {
    return false;
  }
}

/**
 * Parses and validates comma-separated `CORS_ALLOWED_ORIGINS`.
 * Rejects wildcard `*` or malformed origins because credentialed cookies are used (§11).
 */
export function parseCorsAllowedOrigins(rawOrigins: string): readonly string[] {
  const items = rawOrigins
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (items.length === 0) {
    throw new ConfigValidationError({
      CORS_ALLOWED_ORIGINS: 'must contain at least one explicit origin URL',
    });
  }

  const normalized: string[] = [];
  for (const item of items) {
    if (item === '*') {
      throw new ConfigValidationError({
        CORS_ALLOWED_ORIGINS:
          'wildcard "*" is forbidden when credentialed HttpOnly cookies are enabled (§11)',
      });
    }
    try {
      const parsed = new URL(item);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Unsupported protocol');
      }
      normalized.push(parsed.origin);
    } catch {
      throw new ConfigValidationError({
        CORS_ALLOWED_ORIGINS: 'every entry must be a valid http(s) origin URL',
      });
    }
  }

  return Object.freeze(Array.from(new Set(normalized)));
}

/**
 * Loads and validates the API Gateway configuration at startup.
 */
export function loadGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): GatewayServiceConfig {
  const parsed = loadConfig(GATEWAY_CONFIG_SCHEMA, env) as unknown as Omit<
    GatewayServiceConfig,
    'allowedOrigins'
  >;

  const crossFieldErrors: Record<string, string> = {};

  if (!isValidEd25519PrivateKey(parsed.USER_CONTEXT_SIGNING_KEY)) {
    crossFieldErrors.USER_CONTEXT_SIGNING_KEY =
      'must be a valid Ed25519 PKCS#8 private key in PEM or base64 format (§6.4)';
  }

  let allowedOrigins: readonly string[] = [];
  try {
    allowedOrigins = parseCorsAllowedOrigins(parsed.CORS_ALLOWED_ORIGINS);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      Object.assign(crossFieldErrors, err.reasons);
    } else {
      crossFieldErrors.CORS_ALLOWED_ORIGINS = 'invalid CORS origin list';
    }
  }

  if (Object.keys(crossFieldErrors).length > 0) {
    throw new ConfigValidationError(crossFieldErrors);
  }

  return Object.freeze({
    ...parsed,
    AUTH_SERVICE_URL: parsed.AUTH_SERVICE_URL.replace(/\/+$/, ''),
    CHAT_SERVICE_URL: parsed.CHAT_SERVICE_URL.replace(/\/+$/, ''),
    AGENT_SERVICE_URL: parsed.AGENT_SERVICE_URL.replace(/\/+$/, ''),
    BILLING_SERVICE_URL: parsed.BILLING_SERVICE_URL.replace(/\/+$/, ''),
    allowedOrigins,
  });
}

/**
 * Resolves the normalized base URL for an internal microservice target.
 */
export function resolveUpstreamServiceUrl(
  config: Pick<
    GatewayServiceConfig,
    'AUTH_SERVICE_URL' | 'CHAT_SERVICE_URL' | 'AGENT_SERVICE_URL' | 'BILLING_SERVICE_URL'
  >,
  target: UpstreamServiceTarget,
): string {
  switch (target) {
    case 'auth':
      return config.AUTH_SERVICE_URL;
    case 'chat':
      return config.CHAT_SERVICE_URL;
    case 'agent':
      return config.AGENT_SERVICE_URL;
    case 'billing':
      return config.BILLING_SERVICE_URL;
  }
}
