/**
 * @kartik/billing — Fail-fast environment configuration validator (Micro-step 4.1.a).
 *
 * Enforces Blueprint §6, §9 (Invariants #5, #6, #17, #19) and §11 (Credits & payments):
 * - BILLING_MODE defaults to 'mock' so local development and automated tests never trigger
 *   live Razorpay orders or consume paid quotas unless explicitly opted in.
 * - Validates the Ed25519 USER_CONTEXT_PUBLIC_KEY at boot so Billing can verify audience-bound
 *   user-context assertions (`aud: "billing"`).
 * - Requires RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET when BILLING_MODE='live'.
 */

import { createPublicKey } from 'node:crypto';
import {
  loadConfig,
  ConfigValidationError,
  type ConfigSchema,
} from '@kartik/shared';

export const BILLING_CONFIG_SCHEMA: ConfigSchema = {
  NODE_ENV: {
    type: 'enum',
    enumValues: ['development', 'test', 'production'] as const,
    default: 'development',
  },
  PORT: {
    type: 'port',
    default: 3004,
  },
  BILLING_DATABASE_URL: {
    type: 'url',
    required: true,
    secret: true,
  },
  REDIS_URL: {
    type: 'url',
    required: true,
    secret: true,
  },
  BILLING_MODE: {
    type: 'enum',
    enumValues: ['mock', 'live'] as const,
    default: 'mock',
  },
  DEMO_READ_ONLY: {
    type: 'boolean',
    default: false,
  },
  FREE_TIER_INITIAL_CREDITS: {
    type: 'int',
    default: 100,
    min: 0,
    max: 100_000,
  },
  RESERVATION_TTL_SECONDS: {
    type: 'int',
    default: 900,
    min: 60,
    max: 86_400,
  },
  USER_CONTEXT_PUBLIC_KEY: {
    type: 'string',
    required: true,
    min: 32,
  },
  GATEWAY_TO_BILLING_TOKEN: {
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
  RAZORPAY_KEY_ID: {
    type: 'string',
    required: false,
    default: '',
  },
  RAZORPAY_KEY_SECRET: {
    type: 'string',
    required: false,
    secret: true,
    default: '',
  },
  RAZORPAY_WEBHOOK_SECRET: {
    type: 'string',
    required: false,
    secret: true,
    default: '',
  },
};

export interface BillingServiceConfig {
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly PORT: number;
  readonly BILLING_DATABASE_URL: string;
  readonly REDIS_URL: string;
  readonly BILLING_MODE: 'mock' | 'live';
  readonly DEMO_READ_ONLY: boolean;
  readonly FREE_TIER_INITIAL_CREDITS: number;
  readonly RESERVATION_TTL_SECONDS: number;
  readonly USER_CONTEXT_PUBLIC_KEY: string;
  readonly GATEWAY_TO_BILLING_TOKEN: string;
  readonly CHAT_TO_BILLING_TOKEN: string;
  readonly RAZORPAY_KEY_ID: string;
  readonly RAZORPAY_KEY_SECRET: string;
  readonly RAZORPAY_WEBHOOK_SECRET: string;
}

function isValidEd25519PublicKey(rawPemOrBase64: string): boolean {
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
 * Validates the Billing Service environment at startup and verifies that:
 * 1. `USER_CONTEXT_PUBLIC_KEY` is a valid Ed25519 SPKI PEM key.
 * 2. When `BILLING_MODE === 'live'`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and
 *    `RAZORPAY_WEBHOOK_SECRET` are non-empty (§11).
 */
export function loadBillingConfig(
  env: Record<string, string | undefined> = process.env,
): BillingServiceConfig {
  const config = loadConfig(BILLING_CONFIG_SCHEMA, env) as unknown as BillingServiceConfig;

  const crossFieldErrors: Record<string, string> = {};

  if (!isValidEd25519PublicKey(config.USER_CONTEXT_PUBLIC_KEY)) {
    crossFieldErrors.USER_CONTEXT_PUBLIC_KEY =
      'must be a valid Ed25519 SPKI public key in PEM or base64 format (§6.4)';
  }

  if (config.BILLING_MODE === 'live') {
    if (!config.RAZORPAY_KEY_ID || config.RAZORPAY_KEY_ID.trim().length < 8) {
      crossFieldErrors.RAZORPAY_KEY_ID = 'required when BILLING_MODE=live';
    }
    if (!config.RAZORPAY_KEY_SECRET || config.RAZORPAY_KEY_SECRET.trim().length < 16) {
      crossFieldErrors.RAZORPAY_KEY_SECRET = 'required when BILLING_MODE=live';
    }
    if (!config.RAZORPAY_WEBHOOK_SECRET || config.RAZORPAY_WEBHOOK_SECRET.trim().length < 16) {
      crossFieldErrors.RAZORPAY_WEBHOOK_SECRET = 'required when BILLING_MODE=live';
    }
  }

  if (Object.keys(crossFieldErrors).length > 0) {
    throw new ConfigValidationError(crossFieldErrors);
  }

  return Object.freeze(config);
}
