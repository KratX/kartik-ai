/**
 * @file src/server/keep-alive.ts
 * @description Render Free-Tier Keep-Alive Heartbeat & Safe Target Validator (Fix #46).
 *
 * Keeps the hosted Render web service warm by issuing periodic lightweight HTTPS
 * self-pings to the public `/ping` endpoint (paired with the external GitHub Actions
 * cron workflow in `.github/workflows/render-keepalive.yml` for cold-boot recovery).
 *
 * Security invariants:
 * - Only allows `https:` public hostnames; strictly blocks loopback, link-local,
 *   metadata (`169.254.169.254`), and RFC-1918/ULA private addresses.
 * - Disables automatic redirects (`redirect: 'manual'`) and enforces strict timeouts.
 * - Clamps intervals to [60s, 14m] so a misconfigured env var can never self-DoS.
 * - Uses `.unref()` timers and cleans up cleanly on `stop()` / `SIGTERM`.
 */

export const DEFAULT_KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (< Render's 15m idle sleep)
export const MIN_KEEP_ALIVE_INTERVAL_MS = 60 * 1000; // 1 minute floor
export const MAX_KEEP_ALIVE_INTERVAL_MS = 14 * 60 * 1000; // 14 minute ceiling
export const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 10 * 1000; // 10 seconds
export const MIN_KEEP_ALIVE_TIMEOUT_MS = 2 * 1000;
export const MAX_KEEP_ALIVE_TIMEOUT_MS = 20 * 1000;

export interface KeepAliveConfig {
  readonly enabled: boolean;
  readonly targetUrl: string | null;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly reason: string;
}

export interface KeepAliveSnapshot {
  readonly enabled: boolean;
  readonly intervalMs: number;
  readonly totalPings: number;
  readonly consecutiveFailures: number;
  readonly lastPingAt: string | null;
  readonly lastStatusCode: number | null;
  readonly lastLatencyMs: number | null;
}

export interface KeepAliveController {
  readonly config: KeepAliveConfig;
  start(): void;
  stop(): void;
  pingOnce(): Promise<KeepAliveSnapshot>;
  getSnapshot(): KeepAliveSnapshot;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((octet) => Number(octet));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

/**
 * Returns true if the hostname points to loopback, link-local, metadata,
 * or private network address space.
 */
export function isPrivateOrLoopbackHost(rawHostname: string): boolean {
  const host = rawHostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return isPrivateIpv4(host);
  }
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true;
    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (host.startsWith('::ffff:')) {
      const mapped = host.slice('::ffff:'.length);
      if (/^\d+\.\d+\.\d+\.\d+$/.test(mapped)) {
        return isPrivateIpv4(mapped);
      }
      return true;
    }
    // Unique local (fc00::/7 -> fc.. or fd..) and link-local (fe80::/10 -> fe8..feb)
    if (/^(fc|fd|fe[89ab])[0-9a-f]*:/i.test(host)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves and validates a public HTTPS keep-alive URL from environment variables.
 * Priority: KEEP_ALIVE_URL > RENDER_EXTERNAL_URL > PUBLIC_APP_URL.
 * Always normalizes to `/ping` unless an explicit `/ping` or `/healthz` path is provided.
 */
export function resolveKeepAliveTargetUrl(env: NodeJS.ProcessEnv): string | null {
  const candidates = [
    env.KEEP_ALIVE_URL,
    env.RENDER_EXTERNAL_URL,
    env.PUBLIC_APP_URL,
  ];

  for (const raw of candidates) {
    const trimmed = (raw ?? '').trim().replace(/^["']|["']$/g, '');
    if (!trimmed) continue;

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      continue;
    }

    if (parsed.protocol !== 'https:') continue;
    if (parsed.username || parsed.password) continue;
    if (isPrivateOrLoopbackHost(parsed.hostname)) continue;

    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    const pingPath =
      cleanPath === '/ping' || cleanPath === '/healthz' || cleanPath === '/api/v1/healthz'
        ? cleanPath
        : '/ping';

    return `${parsed.origin}${pingPath}`;
  }

  return null;
}

function clampInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number((raw ?? '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * Computes keep-alive configuration from environment variables.
 * Auto-enables on hosted Render (`RENDER=true` or `RENDER_EXTERNAL_URL` present)
 * unless `KEEP_ALIVE_ENABLED=false` or `NODE_ENV=test`.
 */
export function resolveKeepAliveConfig(env: NodeJS.ProcessEnv): KeepAliveConfig {
  const nodeEnv = (env.NODE_ENV ?? '').trim().toLowerCase();
  const explicitFlag = (env.KEEP_ALIVE_ENABLED ?? '').trim().toLowerCase();
  const isHostedRender = Boolean(
    (env.RENDER ?? '').trim() || (env.RENDER_EXTERNAL_URL ?? '').trim(),
  );

  const intervalMs = clampInteger(
    env.KEEP_ALIVE_INTERVAL_MS,
    DEFAULT_KEEP_ALIVE_INTERVAL_MS,
    MIN_KEEP_ALIVE_INTERVAL_MS,
    MAX_KEEP_ALIVE_INTERVAL_MS,
  );
  const timeoutMs = clampInteger(
    env.KEEP_ALIVE_TIMEOUT_MS,
    DEFAULT_KEEP_ALIVE_TIMEOUT_MS,
    MIN_KEEP_ALIVE_TIMEOUT_MS,
    MAX_KEEP_ALIVE_TIMEOUT_MS,
  );

  if (nodeEnv === 'test' && explicitFlag !== 'true') {
    return {
      enabled: false,
      targetUrl: null,
      intervalMs,
      timeoutMs,
      reason: 'disabled in test environment',
    };
  }

  if (explicitFlag === 'false' || explicitFlag === '0') {
    return {
      enabled: false,
      targetUrl: null,
      intervalMs,
      timeoutMs,
      reason: 'explicitly disabled via KEEP_ALIVE_ENABLED=false',
    };
  }

  const shouldEnable = explicitFlag === 'true' || explicitFlag === '1' || isHostedRender;
  if (!shouldEnable) {
    return {
      enabled: false,
      targetUrl: null,
      intervalMs,
      timeoutMs,
      reason: 'local non-Render runtime',
    };
  }

  const targetUrl = resolveKeepAliveTargetUrl(env);
  if (!targetUrl) {
    return {
      enabled: false,
      targetUrl: null,
      intervalMs,
      timeoutMs,
      reason: 'no valid public HTTPS URL configured',
    };
  }

  return {
    enabled: true,
    targetUrl,
    intervalMs,
    timeoutMs,
    reason: isHostedRender ? 'auto-enabled on Render' : 'enabled via KEEP_ALIVE_ENABLED=true',
  };
}

export interface CreateKeepAliveOptions {
  readonly fetchImpl?: typeof fetch;
  readonly logger?: Pick<Console, 'log' | 'warn'>;
}

/**
 * Creates a self-contained Render keep-alive scheduler with strict timeouts,
 * single in-flight protection, `.unref()` timer safety, and clean shutdown.
 */
export function createRenderKeepAlive(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateKeepAliveOptions = {},
): KeepAliveController {
  const config = resolveKeepAliveConfig(env);
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const logger = options.logger ?? console;

  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let totalPings = 0;
  let consecutiveFailures = 0;
  let lastPingAt: string | null = null;
  let lastStatusCode: number | null = null;
  let lastLatencyMs: number | null = null;

  const getSnapshot = (): KeepAliveSnapshot => ({
    enabled: config.enabled,
    intervalMs: config.intervalMs,
    totalPings,
    consecutiveFailures,
    lastPingAt,
    lastStatusCode,
    lastLatencyMs,
  });

  const pingOnce = async (): Promise<KeepAliveSnapshot> => {
    if (!config.enabled || !config.targetUrl || inFlight) {
      return getSnapshot();
    }

    inFlight = true;
    const startedAt = Date.now();
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), config.timeoutMs);
    abortTimer.unref?.();

    try {
      const response = await fetchFn(config.targetUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'KartikAI-RenderKeepAlive/1.0',
          'X-Keep-Alive': '1',
          Accept: 'application/json',
        },
      });
      await response.body?.cancel?.().catch(() => undefined);

      totalPings += 1;
      lastPingAt = new Date().toISOString();
      lastStatusCode = response.status;
      lastLatencyMs = Math.max(0, Date.now() - startedAt);

      if (response.status >= 200 && response.status < 400) {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures += 1;
        logger.warn(
          `[kartik-keepalive] non-OK response status=${response.status} latency=${lastLatencyMs}ms failures=${consecutiveFailures}`,
        );
      }
    } catch (err) {
      totalPings += 1;
      consecutiveFailures += 1;
      lastPingAt = new Date().toISOString();
      lastStatusCode = null;
      lastLatencyMs = Math.max(0, Date.now() - startedAt);
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        `[kartik-keepalive] ping failed (${message}) latency=${lastLatencyMs}ms failures=${consecutiveFailures}`,
      );
    } finally {
      clearTimeout(abortTimer);
      inFlight = false;
    }

    return getSnapshot();
  };

  const start = () => {
    if (!config.enabled || !config.targetUrl || timer) {
      return;
    }
    logger.log(
      `[kartik-keepalive] active (${config.reason}) -> ${config.targetUrl} every ${Math.round(config.intervalMs / 1000)}s`,
    );
    timer = setInterval(() => {
      void pingOnce();
    }, config.intervalMs);
    timer.unref?.();
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    config,
    start,
    stop,
    pingOnce,
    getSnapshot,
  };
}
