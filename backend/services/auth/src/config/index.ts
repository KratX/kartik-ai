/**
 * @kartik/auth/config — Auth Service Environment Configuration
 * (Blueprint §6.1, §6.2, ADR 0002, ADR 0004 & Architecture Invariants #2, #7, #19).
 *
 * Rules enforced:
 * 1. `DATABASE_SCHEMA` is locked to `'auth'` (Invariant #7).
 * 2. `AUTH_PROVIDER_MODE` defaults to `'mock'` so local development and CI run with
 *    deterministic Firebase token fixtures (Invariant #19).
 * 3. When `AUTH_PROVIDER_MODE === 'firebase'`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
 *    and `FIREBASE_PRIVATE_KEY` are strictly required at startup.
 */
import {
  ConfigValidationError,
  loadConfig,
  type ConfigSchema,
} from '@kartik/shared';

export const AUTH_CONFIG_SCHEMA: ConfigSchema = {
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
  PORT_AUTH: {
    type: 'port',
    default: 8001,
  },
  DATABASE_URL: {
    type: 'url',
    required: true,
  },
  DATABASE_SCHEMA: {
    type: 'enum',
    enumValues: ['auth'] as const,
    default: 'auth',
  },
  REDIS_URL: {
    type: 'url',
    required: true,
  },
  SERVICE_TO_SERVICE_TOKEN: {
    type: 'string',
    required: true,
    min: 16,
    secret: true,
  },
  AUTH_PROVIDER_MODE: {
    type: 'enum',
    enumValues: ['mock', 'firebase'] as const,
    default: 'mock',
  },
  FIREBASE_PROJECT_ID: {
    type: 'string',
    required: false,
    default: 'kartik-mock-project',
  },
  FIREBASE_CLIENT_EMAIL: {
    type: 'string',
    required: false,
    default: 'firebase-adminsdk@kartik-mock-project.iam.gserviceaccount.com',
  },
  FIREBASE_PRIVATE_KEY: {
    type: 'string',
    required: false,
    secret: true,
    default: '-----BEGIN PRIVATE KEY-----\nMOCK_KEY\n-----END PRIVATE KEY-----\n',
  },
  SESSION_COOKIE_NAME: {
    type: 'string',
    default: 'kartik_session',
  },
  SESSION_TTL_SECONDS: {
    type: 'int',
    default: 604_800,
    min: 60,
    max: 2_592_000,
  },
  COOKIE_SECURE: {
    type: 'boolean',
    default: false,
  },
  COOKIE_SAME_SITE: {
    type: 'enum',
    enumValues: ['lax', 'strict'] as const,
    default: 'lax',
  },
};

export interface AuthServiceConfig {
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  readonly PORT_AUTH: number;
  readonly DATABASE_URL: string;
  readonly DATABASE_SCHEMA: 'auth';
  readonly REDIS_URL: string;
  readonly SERVICE_TO_SERVICE_TOKEN: string;
  readonly AUTH_PROVIDER_MODE: 'mock' | 'firebase';
  readonly FIREBASE_PROJECT_ID: string;
  readonly FIREBASE_CLIENT_EMAIL: string;
  readonly FIREBASE_PRIVATE_KEY: string;
  readonly SESSION_COOKIE_NAME: string;
  readonly SESSION_TTL_SECONDS: number;
  readonly COOKIE_SECURE: boolean;
  readonly COOKIE_SAME_SITE: 'lax' | 'strict';
}

/**
 * Parses and validates the Auth service environment configuration at startup.
 * Enforces cross-field rules for live Firebase mode and production cookie security.
 */
export function loadAuthConfig(
  env: Record<string, string | undefined> = process.env,
): AuthServiceConfig {
  const parsed = loadConfig(AUTH_CONFIG_SCHEMA, env) as unknown as AuthServiceConfig;

  const crossFieldReasons: Record<string, string> = {};

  if (parsed.AUTH_PROVIDER_MODE === 'firebase') {
    if (!env.FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID.trim() === '') {
      crossFieldReasons.FIREBASE_PROJECT_ID = 'required when AUTH_PROVIDER_MODE=firebase';
    }
    if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_CLIENT_EMAIL.includes('@')) {
      crossFieldReasons.FIREBASE_CLIENT_EMAIL =
        'valid service account email required when AUTH_PROVIDER_MODE=firebase';
    }
    if (
      !env.FIREBASE_PRIVATE_KEY ||
      !env.FIREBASE_PRIVATE_KEY.includes('BEGIN PRIVATE KEY')
    ) {
      crossFieldReasons.FIREBASE_PRIVATE_KEY =
        'PEM private key required when AUTH_PROVIDER_MODE=firebase';
    }
  }

  if (Object.keys(crossFieldReasons).length > 0) {
    throw new ConfigValidationError(crossFieldReasons);
  }

  return Object.freeze({
    ...parsed,
    COOKIE_SECURE: parsed.NODE_ENV === 'production' ? true : parsed.COOKIE_SECURE,
  });
}
