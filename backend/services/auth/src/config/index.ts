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
import { createPrivateKey, createPublicKey } from 'node:crypto';
import {
  ConfigValidationError,
  isPlaceholderEd25519KeyMaterial,
  loadConfig,
  resolveSecretOrFileEnv,
  validatePostgresConnectionUrl,
  type ConfigSchema,
} from '@kartik/shared';

export const PLACEHOLDER_FIREBASE_PROJECT_IDS = Object.freeze([
  'kartik-mock-project',
  'your-firebase-project',
  'replace_me',
  'placeholder',
]);

export const PLACEHOLDER_FIREBASE_CLIENT_EMAILS = Object.freeze([
  'firebase-adminsdk@kartik-mock-project.iam.gserviceaccount.com',
  'firebase-adminsdk@your-project.iam.gserviceaccount.com',
]);

export const PLACEHOLDER_FIREBASE_PRIVATE_KEY_MARKERS = Object.freeze([
  'MOCK_KEY',
  'REPLACE_ME',
  'REPLACE_WITH_FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY',
  'YOUR_PRIVATE_KEY',
]);

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
  readonly USER_CONTEXT_PUBLIC_KEY?: string;
}

export interface FirebaseCredentialsValidationResult {
  readonly valid: boolean;
  readonly normalizedPrivateKey?: string;
  readonly reasons: Readonly<Record<string, string>>;
}

export function normalizeFirebasePrivateKeyPem(rawKey: string): string {
  const trimmed = rawKey.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
  if (trimmed.includes('BEGIN PRIVATE KEY') || trimmed.includes('BEGIN RSA PRIVATE KEY')) {
    return trimmed;
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8').replace(/\\n/g, '\n').trim();
    if (decoded.includes('BEGIN PRIVATE KEY') || decoded.includes('BEGIN RSA PRIVATE KEY')) {
      return decoded;
    }
  } catch {
    // Validated below
  }
  return trimmed;
}

/**
 * Validates Firebase Admin credentials (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
 * `FIREBASE_PRIVATE_KEY`) and rejects missing, placeholder, or cryptographically invalid keys.
 */
export function validateFirebaseCredentials(input: {
  readonly projectId?: string | undefined;
  readonly clientEmail?: string | undefined;
  readonly privateKey?: string | undefined;
}): FirebaseCredentialsValidationResult {
  const reasons: Record<string, string> = {};

  const projectId = input.projectId?.trim() ?? '';
  if (
    !projectId ||
    PLACEHOLDER_FIREBASE_PROJECT_IDS.includes(projectId.toLowerCase()) ||
    !/^[a-z][a-z0-9-]{3,61}$/i.test(projectId)
  ) {
    reasons.FIREBASE_PROJECT_ID =
      'required non-placeholder Firebase project ID when AUTH_PROVIDER_MODE=firebase';
  }

  const clientEmail = input.clientEmail?.trim() ?? '';
  if (
    !clientEmail ||
    !clientEmail.includes('@') ||
    PLACEHOLDER_FIREBASE_CLIENT_EMAILS.includes(clientEmail.toLowerCase())
  ) {
    reasons.FIREBASE_CLIENT_EMAIL =
      'valid non-placeholder Firebase service account email required when AUTH_PROVIDER_MODE=firebase';
  }

  const rawPrivateKey = input.privateKey?.trim() ?? '';
  const hasPlaceholderMarker = PLACEHOLDER_FIREBASE_PRIVATE_KEY_MARKERS.some((marker) =>
    rawPrivateKey.includes(marker),
  );
  if (!rawPrivateKey || hasPlaceholderMarker) {
    reasons.FIREBASE_PRIVATE_KEY =
      'valid PEM private key required when AUTH_PROVIDER_MODE=firebase (placeholder keys are forbidden)';
  } else {
    const normalizedPem = normalizeFirebasePrivateKeyPem(rawPrivateKey);
    if (
      !normalizedPem.includes('BEGIN PRIVATE KEY') &&
      !normalizedPem.includes('BEGIN RSA PRIVATE KEY')
    ) {
      reasons.FIREBASE_PRIVATE_KEY =
        'PEM private key required when AUTH_PROVIDER_MODE=firebase';
    } else {
      try {
        const keyObj = createPrivateKey(normalizedPem);
        if (keyObj.type !== 'private') {
          reasons.FIREBASE_PRIVATE_KEY =
            'must be a valid asymmetric private key in PEM format';
        }
      } catch {
        reasons.FIREBASE_PRIVATE_KEY =
          'invalid or corrupted PEM private key material for FIREBASE_PRIVATE_KEY';
      }
    }
  }

  return Object.freeze({
    valid: Object.keys(reasons).length === 0,
    ...(rawPrivateKey && !reasons.FIREBASE_PRIVATE_KEY
      ? { normalizedPrivateKey: normalizeFirebasePrivateKeyPem(rawPrivateKey) }
      : {}),
    reasons: Object.freeze(reasons),
  });
}

function isValidEd25519PublicKey(rawPemOrBase64: string): boolean {
  if (isPlaceholderEd25519KeyMaterial(rawPemOrBase64)) {
    return false;
  }
  try {
    const trimmed = rawPemOrBase64.trim().replace(/\\n/g, '\n');
    const pem = trimmed.startsWith('-----BEGIN ')
      ? trimmed
      : Buffer.from(trimmed, 'base64').toString('utf8').replace(/\\n/g, '\n');
    const keyObj = createPublicKey(pem);
    return keyObj.type === 'public' && keyObj.asymmetricKeyType === 'ed25519';
  } catch {
    return false;
  }
}

/**
 * Parses and validates the Auth service environment configuration at startup.
 * Enforces cross-field rules for live Firebase mode, production database URL, and production cookie security.
 * In production (`NODE_ENV === 'production'`), `AUTH_PROVIDER_MODE` defaults to `'firebase'` and forbids `'mock'`.
 */
export function loadAuthConfig(
  env: Record<string, string | undefined> = process.env,
): AuthServiceConfig {
  const isProd = env.NODE_ENV === 'production';
  const resolvedPublicKey =
    resolveSecretOrFileEnv(
      env,
      'USER_CONTEXT_PUBLIC_KEY',
      'USER_CONTEXT_PUBLIC_KEY_FILE',
    ) ??
    resolveSecretOrFileEnv(
      env,
      'USER_CONTEXT_VERIFY_KEY',
      'USER_CONTEXT_VERIFY_KEY_FILE',
    );
  const resolvedFirebasePrivateKey = resolveSecretOrFileEnv(
    env,
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_PRIVATE_KEY_FILE',
  );
  const effectiveProviderMode =
    env.AUTH_PROVIDER_MODE ?? (isProd ? 'firebase' : 'mock');

  const normalizedEnv: Record<string, string | undefined> = {
    ...env,
    AUTH_PROVIDER_MODE: effectiveProviderMode,
    ...(resolvedFirebasePrivateKey !== undefined
      ? { FIREBASE_PRIVATE_KEY: resolvedFirebasePrivateKey }
      : {}),
    ...(env.DATABASE_URL === undefined && env.AUTH_DATABASE_URL !== undefined
      ? { DATABASE_URL: env.AUTH_DATABASE_URL }
      : {}),
    ...(env.PORT_AUTH === undefined && env.PORT !== undefined
      ? { PORT_AUTH: env.PORT }
      : {}),
  };
  const parsed = loadConfig(AUTH_CONFIG_SCHEMA, normalizedEnv) as unknown as AuthServiceConfig;

  const crossFieldReasons: Record<string, string> = {};

  const dbCheck = validatePostgresConnectionUrl(parsed.DATABASE_URL, {
    envName: 'DATABASE_URL',
    nodeEnv: parsed.NODE_ENV,
  });
  if (!dbCheck.valid) {
    crossFieldReasons.DATABASE_URL = dbCheck.reason ?? 'must be a valid PostgreSQL connection URI';
  }

  if (resolvedPublicKey !== undefined && !isValidEd25519PublicKey(resolvedPublicKey)) {
    crossFieldReasons.USER_CONTEXT_PUBLIC_KEY =
      'must be a valid Ed25519 SPKI public key in PEM or base64 format (§6.4)';
  }

  if (isProd && parsed.AUTH_PROVIDER_MODE === 'mock') {
    crossFieldReasons.AUTH_PROVIDER_MODE =
      'AUTH_PROVIDER_MODE=mock is forbidden when NODE_ENV=production; configure AUTH_PROVIDER_MODE=firebase';
  }

  let validatedFirebasePrivateKey = parsed.FIREBASE_PRIVATE_KEY;
  if (parsed.AUTH_PROVIDER_MODE === 'firebase') {
    const fbValidation = validateFirebaseCredentials({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: resolvedFirebasePrivateKey,
    });
    if (!fbValidation.valid) {
      Object.assign(crossFieldReasons, fbValidation.reasons);
    } else if (fbValidation.normalizedPrivateKey) {
      validatedFirebasePrivateKey = fbValidation.normalizedPrivateKey;
    }
  }

  if (Object.keys(crossFieldReasons).length > 0) {
    throw new ConfigValidationError(crossFieldReasons);
  }

  return Object.freeze({
    ...parsed,
    FIREBASE_PRIVATE_KEY: validatedFirebasePrivateKey,
    ...(resolvedPublicKey !== undefined
      ? { USER_CONTEXT_PUBLIC_KEY: resolvedPublicKey }
      : {}),
    COOKIE_SECURE: parsed.NODE_ENV === 'production' ? true : parsed.COOKIE_SECURE,
  });
}
