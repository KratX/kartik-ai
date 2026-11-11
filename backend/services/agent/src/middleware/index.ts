import {
  INTERNAL_AUTH_HEADERS,
  verifyServiceCaller,
  verifyUserContextAssertion,
  type UserContextAssertionClaims,
  type VerifiedServiceCaller,
} from '@kartik/shared/auth';
import type { AgentConfig } from '../config/index.js';

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
 * Verifies the API Gateway's Ed25519-signed `x-user-context` assertion on public
 * `/files` and `/artifacts` routes, enforcing `expectedAudience: 'agent'` (§6.4).
 */
export function requireAgentUserContext(
  headers: HttpHeaderMap,
  config: Pick<AgentConfig, 'userContextPublicKey'>,
  nowSeconds?: number,
): UserContextAssertionClaims {
  const token = readSingleHeader(headers, INTERNAL_AUTH_HEADERS.USER_CONTEXT) ?? '';
  return verifyUserContextAssertion(token, config.userContextPublicKey, {
    expectedAudience: 'agent',
    ...(nowSeconds !== undefined ? { nowSeconds } : {}),
  });
}

/**
 * Verifies internal service-to-service credentials (`x-service-caller: chat` +
 * `x-service-token`) on `/internal/agent/execute` and `/internal/agent/purge`
 * in constant time (Invariant #14 & §6.3).
 */
export function requireAgentServiceAuth(
  headers: HttpHeaderMap,
  config: Pick<AgentConfig, 'internalCallerTokenChat'>,
): VerifiedServiceCaller {
  const callerHeader = readSingleHeader(headers, INTERNAL_AUTH_HEADERS.SERVICE_CALLER);
  const tokenHeader = readSingleHeader(headers, INTERNAL_AUTH_HEADERS.SERVICE_TOKEN);

  return verifyServiceCaller({
    callerHeader,
    tokenHeader,
    expectedTokenOrDirectory: {
      chat: config.internalCallerTokenChat,
    },
    allowedCallers: ['chat'],
  });
}
