/**
 * Kartik.ai — Shared Environment Config Validator & Redactor (`@kartik/shared/config`)
 * Blueprint §6.1, §6.2, §7.2 (Phase 1 Exit Gate), and §13 (Sprint Step 6).
 *
 * Pure TypeScript, zero external dependencies (ADR 0005).
 * Rules enforced:
 * 1. Fail fast at boot if any required variable is missing or malformed.
 * 2. Error messages name the offending variable(s) and constraint, NEVER printing raw values.
 * 3. `redactConfig()` masks secret keys (`[REDACTED]`) for safe startup diagnostics.
 */

export type ConfigFieldType =
  | 'string'
  | 'port'
  | 'int'
  | 'boolean'
  | 'url'
  | 'enum'
  | 'secret32';

export interface ConfigFieldRule<T = unknown> {
  type: ConfigFieldType;
  required?: boolean;
  default?: T;
  enumValues?: readonly string[];
  min?: number;
  max?: number;
  secret?: boolean;
  description?: string;
}

export type ConfigSchema = Record<string, ConfigFieldRule>;

const SECRET_KEY_PATTERN = /(SECRET|CREDENTIAL|PRIVATE_KEY|API_KEY|PASSWORD|TOKEN)/i;

export class ConfigValidationError extends Error {
  public readonly invalidVariables: readonly string[];
  public readonly reasons: Readonly<Record<string, string>>;

  constructor(reasons: Record<string, string>) {
    const keys = Object.keys(reasons);
    const summary = keys.map((k) => `${k} (${reasons[k]})`).join('; ');
    super(`Environment configuration validation failed for [${keys.join(', ')}]: ${summary}`);
    this.name = 'ConfigValidationError';
    this.invalidVariables = Object.freeze(keys);
    this.reasons = Object.freeze({ ...reasons });
  }
}

export function isSecretKeyName(key: string, rule?: ConfigFieldRule): boolean {
  if (rule?.secret !== undefined) {
    return rule.secret;
  }
  return SECRET_KEY_PATTERN.test(key);
}

/**
 * Validates an environment object (`process.env` by default) against a service's `ConfigSchema`.
 * Fails fast with `ConfigValidationError` naming every offending variable without ever printing its value.
 */
export function loadConfig<T extends Record<string, unknown> = Record<string, unknown>>(
  schema: ConfigSchema,
  envSource: Record<string, string | undefined> = process.env
): Readonly<T> {
  const result: Record<string, unknown> = {};
  const reasons: Record<string, string> = {};

  for (const [key, rule] of Object.entries(schema)) {
    const raw = envSource[key];
    const isRequired = rule.required !== false && rule.default === undefined;

    if (raw === undefined || raw.trim() === '') {
      if (rule.default !== undefined) {
        result[key] = rule.default;
        continue;
      }
      if (isRequired) {
        reasons[key] = 'missing required variable';
      } else {
        result[key] = undefined;
      }
      continue;
    }

    const trimmed = raw.trim();

    switch (rule.type) {
      case 'string': {
        if (rule.min !== undefined && trimmed.length < rule.min) {
          reasons[key] = `must be at least ${rule.min} characters`;
          break;
        }
        if (rule.max !== undefined && trimmed.length > rule.max) {
          reasons[key] = `must be at most ${rule.max} characters`;
          break;
        }
        result[key] = raw.includes('\\n') && key.endsWith('PRIVATE_KEY') ? raw.replace(/\\n/g, '\n') : trimmed;
        break;
      }

      case 'secret32': {
        const minLen = rule.min ?? 32;
        if (Buffer.byteLength(trimmed, 'utf8') < minLen) {
          reasons[key] = `must be at least ${minLen} bytes`;
          break;
        }
        result[key] = trimmed;
        break;
      }

      case 'port': {
        const num = Number(trimmed);
        if (!Number.isInteger(num) || num < 1 || num > 65535) {
          reasons[key] = 'must be a valid TCP port (integer between 1 and 65535)';
          break;
        }
        result[key] = num;
        break;
      }

      case 'int': {
        const num = Number(trimmed);
        if (!Number.isInteger(num)) {
          reasons[key] = 'must be an integer';
          break;
        }
        if (rule.min !== undefined && num < rule.min) {
          reasons[key] = `must be an integer >= ${rule.min}`;
          break;
        }
        if (rule.max !== undefined && num > rule.max) {
          reasons[key] = `must be an integer <= ${rule.max}`;
          break;
        }
        result[key] = num;
        break;
      }

      case 'boolean': {
        if (trimmed !== 'true' && trimmed !== 'false') {
          reasons[key] = 'must be "true" or "false"';
          break;
        }
        result[key] = trimmed === 'true';
        break;
      }

      case 'url': {
        try {
          const parsed = new URL(trimmed);
          if (!parsed.protocol || !parsed.host) {
            reasons[key] = 'must be a valid URL with protocol and host';
            break;
          }
          result[key] = trimmed;
        } catch {
          reasons[key] = 'must be a valid URL';
        }
        break;
      }

      case 'enum': {
        const allowed = rule.enumValues ?? [];
        if (!allowed.includes(trimmed)) {
          reasons[key] = `must be one of [${allowed.join(', ')}]`;
          break;
        }
        result[key] = trimmed;
        break;
      }
    }
  }

  if (Object.keys(reasons).length > 0) {
    throw new ConfigValidationError(reasons);
  }

  return Object.freeze(result) as Readonly<T>;
}

/**
 * Produces a redacted copy of a loaded config object suitable for diagnostic logging.
 * Any field marked `secret: true` or matching `SECRET|CREDENTIAL|PRIVATE_KEY|API_KEY|PASSWORD|TOKEN`
 * (plus embedded credentials inside `DATABASE_URL` / `REDIS_URL`) is masked.
 */
export function redactConfig(
  config: Record<string, unknown>,
  schema?: ConfigSchema
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    const rule = schema?.[key];
    if (value === undefined || value === null) {
      safe[key] = value;
      continue;
    }

    if (isSecretKeyName(key, rule)) {
      safe[key] = '[REDACTED]';
      continue;
    }

    if (typeof value === 'string' && (key.endsWith('DATABASE_URL') || key === 'REDIS_URL')) {
      try {
        const u = new URL(value);
        if (u.password) {
          u.password = 'REDACTED';
        }
        safe[key] = u.toString();
      } catch {
        safe[key] = '[REDACTED_URL]';
      }
      continue;
    }

    safe[key] = value;
  }

  return safe;
}

/**
 * Shared infrastructure config schema required by every backend service (Blueprint §6.2).
 */
export const SHARED_INFRA_CONFIG_SCHEMA: ConfigSchema = {
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
  TZ: {
    type: 'string',
    default: 'UTC',
  },
  DATABASE_URL: {
    type: 'url',
    required: true,
  },
  DATABASE_SCHEMA: {
    type: 'enum',
    enumValues: ['auth', 'chat', 'agent', 'billing'] as const,
    required: true,
  },
  REDIS_URL: {
    type: 'url',
    required: true,
  },
};
