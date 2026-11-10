/**
 * Kartik.ai — Structured JSON Logger & Recursive Secret Redactor (`@kartik/shared/logger`)
 * Blueprint §6.5, §7.2 (Phase 1), §9.4, §9.5 (G9 Log Hygiene), and §13 (Sprint Step 8).
 *
 * Pure TypeScript, zero external dependencies (ADR 0005).
 * Rules enforced:
 * 1. Structured JSON lines to stdout/custom sink with ISO UTC timestamp, `level`, `service`, `traceId`, and optional `requestId`.
 * 2. Recursive redaction list (§9.4) covering keys, tokens, cookies, authorization headers, signed URLs, and Razorpay secrets.
 * 3. Child loggers (`logger.child({ traceId, requestId })`) preserve correlation across async hops.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACTED_FIELD_PATTERN =
  /(secret|credential|private_key|api_key|password|token|cookie|set-cookie|authorization|x-internal-token|x-razorpay-signature|signedurl|signed_url)/i;

const REDACTED_VALUE_PATTERN =
  /(Bearer\s+[A-Za-z0-9\-._~+/]+=*|kartik_session=[^;\s]+|gsk_[A-Za-z0-9]+|sk-or-[A-Za-z0-9\-]+|tvly-[A-Za-z0-9\-]+|rzp_(?:test|live)_[A-Za-z0-9]+)/g;

export interface LogContext {
  service?: string;
  traceId?: string;
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  traceId?: string;
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

export type LogSink = (jsonLine: string, entry: LogEntry) => void;

/**
 * Recursively redacts sensitive keys and inline bearer/cookie/provider token patterns.
 */
export function redactLogValue(value: unknown, keyName?: string, seen = new WeakSet<object>()): unknown {
  if (keyName && REDACTED_FIELD_PATTERN.test(keyName)) {
    return '[REDACTED]';
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    if (
      (keyName && (keyName.endsWith('DATABASE_URL') || keyName === 'REDIS_URL')) ||
      /^postgres(?:ql)?:\/\/|^rediss?:\/\//i.test(value)
    ) {
      try {
        const u = new URL(value);
        if (u.password) {
          u.password = 'REDACTED';
        }
        return u.toString();
      } catch {
        return '[REDACTED_URL]';
      }
    }
    return value.replace(REDACTED_VALUE_PATTERN, '[REDACTED]');
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLogValue(value.message) as string,
      ...('code' in value && typeof (value as { code?: unknown }).code === 'string'
        ? { code: (value as { code: string }).code }
        : {}),
    };
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, undefined, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactLogValue(v, k, seen);
  }
  return out;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(bindings: LogContext): Logger;
}

export interface CreateLoggerOptions {
  service: string;
  level?: LogLevel;
  defaultContext?: LogContext;
  sink?: LogSink;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const minLevel: LogLevel = options.level ?? 'info';
  const baseService = options.service;
  const baseContext: LogContext = { ...options.defaultContext };
  const sink: LogSink =
    options.sink ??
    ((jsonLine: string) => {
      process.stdout.write(`${jsonLine}\n`);
    });

  function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minLevel]) {
      return;
    }

    const mergedMeta = redactLogValue({ ...baseContext, ...meta }) as Record<string, unknown>;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: baseService,
      message: redactLogValue(message) as string,
      ...mergedMeta,
    };

    sink(JSON.stringify(entry), entry);
  }

  return {
    debug(message: string, meta?: Record<string, unknown>) {
      emit('debug', message, meta);
    },
    info(message: string, meta?: Record<string, unknown>) {
      emit('info', message, meta);
    },
    warn(message: string, meta?: Record<string, unknown>) {
      emit('warn', message, meta);
    },
    error(message: string, meta?: Record<string, unknown>) {
      emit('error', message, meta);
    },
    child(bindings: LogContext): Logger {
      return createLogger({
        service: bindings.service ?? baseService,
        level: minLevel,
        defaultContext: { ...baseContext, ...bindings },
        sink,
      });
    },
  };
}
