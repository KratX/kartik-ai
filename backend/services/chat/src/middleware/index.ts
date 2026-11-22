import {
  INTERNAL_AUTH_HEADERS,
  verifyUserContextAssertion,
  type UserContextAssertionClaims,
} from '@kartik/shared/auth';
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
