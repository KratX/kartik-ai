import {
  INTERNAL_AUTH_HEADERS,
  verifyUserContextAssertion,
  type UserContextAssertionClaims,
} from '@kartik/shared/auth';
import { AppError } from '@kartik/shared/errors';
import type { ChatConfig } from '../config/index.js';

export type HttpHeaderMap = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export function readSingleHeader(
  headers: HttpHeaderMap,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      if (typeof v === 'string') {
        return v;
      }
      if (Array.isArray(v) && typeof v[0] === 'string') {
        return v[0];
      }
    }
  }
  return undefined;
}

/**
 * Verifies the API Gateway's Ed25519-signed `x-user-context` assertion on all
 * Chat Service routes, enforcing `expectedAudience: 'chat'` (§6.4).
 */
export function requireChatUserContext(
  headers: HttpHeaderMap,
  config: Pick<ChatConfig, 'userContextPublicKey'>,
  nowSeconds?: number,
): UserContextAssertionClaims {
  const token =
    readSingleHeader(headers, INTERNAL_AUTH_HEADERS.USER_CONTEXT) ?? '';
  return verifyUserContextAssertion(token, config.userContextPublicKey, {
    expectedAudience: 'chat',
    ...(nowSeconds !== undefined ? { nowSeconds } : {}),
  });
}

/**
 * Enforces the `DEMO_READ_ONLY` kill switch on mutating HTTP methods (§12).
 * Browsing (`GET`, `HEAD`, `OPTIONS`) continues to work while `POST`/`PUT`/`PATCH`/`DELETE`
 * return `403 DEMO_READ_ONLY`.
 */
export function enforceChatDemoReadOnly(
  method: string,
  config: Pick<ChatConfig, 'demoReadOnly'>,
): void {
  if (!config.demoReadOnly) {
    return;
  }
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') {
    return;
  }
  throw new AppError(
    'DEMO_READ_ONLY',
    'Mutations are disabled while DEMO_READ_ONLY is enabled',
  );
}
