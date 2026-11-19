/**
 * @kartik/shared/database — PostgreSQL Pool Policy, Schema Isolation, Transactions & Migrations
 * (Blueprint §3.4, §5.1, ADR 0004 & Architecture Invariants #7, #17).
 *
 * Architectural rules enforced here:
 * 1. Four isolated schemas (`auth`, `chat`, `agent`, `billing`) in one database (`kartik`),
 *    one login role per service (ADR 0004, Invariant #7).
 * 2. `idleTimeoutMillis` defaults to 10,000ms (10s) and is capped at 15,000ms so Neon
 *    scale-to-zero compute suspends when idle and never exhausts the 100 CU-hour/month
 *    free tier allowance (ADR 0004).
 * 3. Every credit/payment or multi-table service write executes inside `withTransaction()`,
 *    which guarantees `BEGIN` -> `COMMIT` or `ROLLBACK` on error and `client.release()` in `finally`.
 * 4. Schema migrations (`runForwardMigrations`) reject `-pooler` transaction-mode URLs, verify
 *    SHA-256 checksums of previously applied numbered `.sql` files, and apply new migrations forward-only.
 */
import { createHash } from 'node:crypto';
import { AppError } from '../errors/index.js';

export const DATABASE_SCHEMAS = ['auth', 'chat', 'agent', 'billing'] as const;
export type DatabaseSchemaName = (typeof DATABASE_SCHEMAS)[number];

export const DEFAULT_PGPOOL_IDLE_TIMEOUT_MS = 10_000 as const;
export const MAX_PGPOOL_IDLE_TIMEOUT_MS = 15_000 as const;
export const DEFAULT_PGPOOL_MAX_CONNECTIONS = 10 as const;
export const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000 as const;

export type TransactionIsolationLevel = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export function assertDatabaseSchema(schema: unknown): DatabaseSchemaName {
  if (typeof schema !== 'string' || !(DATABASE_SCHEMAS as readonly string[]).includes(schema)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Invalid database schema "${String(schema)}": must be one of ${DATABASE_SCHEMAS.join(', ')}`,
      { details: { schema: [`Expected one of: ${DATABASE_SCHEMAS.join(', ')}`] } },
    );
  }
  return schema as DatabaseSchemaName;
}

export interface DatabasePoolConfigInput {
  readonly connectionString: string;
  readonly schema: DatabaseSchemaName;
  readonly idleTimeoutMillis?: number;
  readonly maxConnections?: number;
  readonly statementTimeoutMs?: number;
}

export interface ResolvedDatabasePoolConfig {
  readonly connectionString: string;
  readonly schema: DatabaseSchemaName;
  readonly idleTimeoutMillis: number;
  readonly max: number;
  readonly statement_timeout: number;
  readonly options: string;
}

export const POSTGRES_SSL_MODES = [
  'disable',
  'allow',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
  'no-verify',
] as const;

export type PostgresSslMode = (typeof POSTGRES_SSL_MODES)[number];

export interface ResolvedPostgresTlsConfig {
  readonly requiresSsl: boolean;
  readonly sslMode: PostgresSslMode;
  readonly rejectUnauthorized?: boolean;
  readonly ssl:
    | {
        readonly rejectUnauthorized: boolean;
        readonly ca?: string;
        readonly servername?: string;
      }
    | undefined;
}

/**
 * Resolves PostgreSQL TLS/SSL connection options from a connection URL and environment.
 *
 * Security policy (Fix #3):
 * - `sslmode=verify-full` and `sslmode=verify-ca` strictly enforce `rejectUnauthorized: true`
 *   (and `servername` hostname verification for `verify-full`).
 * - `sslmode=require`, `ssl=true`, and managed `*.neon.tech` hosts default to
 *   `rejectUnauthorized: true` unless the operator explicitly opts out via
 *   `sslmode=no-verify`, `sslaccept=accept_invalid_certs`, or `PGSSL_REJECT_UNAUTHORIZED=false`.
 * - `sslmode=no-verify` enables TLS encryption with `rejectUnauthorized: false` for self-signed certs.
 * - `sslmode=disable` or `ssl=false` disables TLS (`ssl: undefined`).
 */
export function resolvePostgresTlsConfig(
  parsedOrUrl: URL | string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedPostgresTlsConfig {
  const parsed =
    typeof parsedOrUrl === 'string' ? new URL(parsedOrUrl.trim()) : parsedOrUrl;
  const hostname = parsed.hostname.trim().toLowerCase();
  const rawSslMode = (
    parsed.searchParams.get('sslmode') ??
    env.PGSSLMODE ??
    ''
  )
    .trim()
    .toLowerCase();
  const sslParam = (parsed.searchParams.get('ssl') ?? '').trim().toLowerCase();
  const sslAccept = (parsed.searchParams.get('sslaccept') ?? '')
    .trim()
    .toLowerCase();
  const envRejectUnauthorized = (
    env.PGSSL_REJECT_UNAUTHORIZED ??
    env.PGSSLREJECTUNAUTHORIZED ??
    ''
  )
    .trim()
    .toLowerCase();
  const caCertPem =
    (env.PGSSLROOTCERT_PEM ?? env.DATABASE_CA_CERT ?? '').trim() || undefined;

  if (
    rawSslMode === 'disable' ||
    sslParam === 'false' ||
    sslParam === '0'
  ) {
    return Object.freeze({
      requiresSsl: false,
      sslMode: 'disable',
      ssl: undefined,
    });
  }

  if (rawSslMode === 'verify-full' || rawSslMode === 'verify-ca') {
    const sslObj: {
      readonly rejectUnauthorized: boolean;
      readonly ca?: string;
      readonly servername?: string;
    } = Object.freeze({
      rejectUnauthorized: true,
      ...(caCertPem ? { ca: caCertPem } : {}),
      ...(rawSslMode === 'verify-full' && hostname
        ? { servername: hostname }
        : {}),
    });
    return Object.freeze({
      requiresSsl: true,
      sslMode: rawSslMode,
      rejectUnauthorized: true,
      ssl: sslObj,
    });
  }

  if (rawSslMode === 'no-verify') {
    const sslObj = Object.freeze({
      rejectUnauthorized: false,
      ...(caCertPem ? { ca: caCertPem } : {}),
    });
    return Object.freeze({
      requiresSsl: true,
      sslMode: 'no-verify',
      rejectUnauthorized: false,
      ssl: sslObj,
    });
  }

  const implicitlyRequiresSsl =
    rawSslMode === 'require' ||
    sslParam === 'true' ||
    sslParam === '1' ||
    hostname.includes('neon.tech');

  if (implicitlyRequiresSsl) {
    const explicitInsecureOptOut =
      sslAccept === 'accept_invalid_certs' ||
      envRejectUnauthorized === 'false' ||
      envRejectUnauthorized === '0';
    const rejectUnauthorized = !explicitInsecureOptOut;
    const sslObj = Object.freeze({
      rejectUnauthorized,
      ...(caCertPem ? { ca: caCertPem } : {}),
      ...(rejectUnauthorized && hostname ? { servername: hostname } : {}),
    });
    return Object.freeze({
      requiresSsl: true,
      sslMode: 'require',
      rejectUnauthorized,
      ssl: sslObj,
    });
  }

  const fallbackMode: PostgresSslMode =
    rawSslMode === 'allow' || rawSslMode === 'prefer' ? rawSslMode : 'disable';
  return Object.freeze({
    requiresSsl: false,
    sslMode: fallbackMode,
    ssl: undefined,
  });
}

export interface PostgresUrlValidationOptions {
  readonly envName?: string;
  readonly nodeEnv?: string;
  readonly forbidComposePostgresHost?: boolean;
  readonly env?: NodeJS.ProcessEnv;
}

export interface ValidatedPostgresUrlResult {
  readonly valid: boolean;
  readonly normalizedUrl?: string;
  readonly hostname?: string;
  readonly database?: string;
  readonly requiresSsl?: boolean;
  readonly sslMode?: PostgresSslMode;
  readonly rejectUnauthorized?: boolean;
  readonly isPoolerEndpoint?: boolean;
  readonly reason?: string;
}

/**
 * Validates that a PostgreSQL connection string is a well-formed `postgres://` or `postgresql://` URI
 * with a non-empty database name, and rejects the nonexistent Docker Compose `postgres` service hostname
 * in production environments.
 */
export function validatePostgresConnectionUrl(
  rawUrl: unknown,
  options: PostgresUrlValidationOptions = {},
): ValidatedPostgresUrlResult {
  const envName = options.envName ?? 'DATABASE_URL';
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return {
      valid: false,
      reason: `${envName} is required and must be a non-empty postgres:// or postgresql:// URI`,
    };
  }

  const trimmed = rawUrl.trim();
  if (!/^postgres(ql)?:\/\/.+/i.test(trimmed)) {
    return {
      valid: false,
      reason: `${envName} must use the postgres:// or postgresql:// protocol`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      reason: `${envName} must be a valid postgres:// or postgresql:// URL`,
    };
  }

  const hostname = parsed.hostname.trim().toLowerCase();
  if (!hostname) {
    return {
      valid: false,
      reason: `${envName} must include a valid database hostname`,
    };
  }

  const database = parsed.pathname.replace(/^\/+/, '').trim();
  if (!database) {
    return {
      valid: false,
      reason: `${envName} must include a target database name in the URL path (e.g. /kartik)`,
    };
  }

  const forbidPostgresHost =
    options.forbidComposePostgresHost ?? options.nodeEnv === 'production';
  if (forbidPostgresHost && hostname === 'postgres') {
    return {
      valid: false,
      reason: `${envName} points to nonexistent Compose hostname "postgres"; production requires an explicit Neon PostgreSQL connection URI`,
    };
  }

  const rawSslMode = parsed.searchParams.get('sslmode')?.trim().toLowerCase();
  if (
    rawSslMode &&
    !(POSTGRES_SSL_MODES as readonly string[]).includes(rawSslMode)
  ) {
    return {
      valid: false,
      reason: `${envName} specifies unsupported sslmode "${rawSslMode}"; allowed values: ${POSTGRES_SSL_MODES.join(', ')}`,
    };
  }

  const tls = resolvePostgresTlsConfig(parsed, options.env ?? process.env);
  const isPoolerEndpoint = hostname.includes('-pooler');

  return {
    valid: true,
    normalizedUrl: trimmed,
    hostname,
    database,
    requiresSsl: tls.requiresSsl,
    sslMode: tls.sslMode,
    rejectUnauthorized: tls.rejectUnauthorized,
    isPoolerEndpoint,
  };
}

export function assertValidPostgresConnectionUrl(
  rawUrl: unknown,
  options: PostgresUrlValidationOptions = {},
): string {
  const result = validatePostgresConnectionUrl(rawUrl, options);
  if (!result.valid || !result.normalizedUrl) {
    throw new AppError(
      'VALIDATION_FAILED',
      result.reason ?? 'Invalid PostgreSQL connection URL',
    );
  }
  return result.normalizedUrl;
}

/**
 * Builds and validates a PostgreSQL pool configuration that enforces schema search_path
 * isolation and Neon scale-to-zero idle timeout rules (ADR 0004).
 */
export function buildDatabasePoolConfig(input: DatabasePoolConfigInput): ResolvedDatabasePoolConfig {
  const validatedUrl = assertValidPostgresConnectionUrl(input.connectionString, {
    envName: 'DATABASE_URL',
  });

  const schema = assertDatabaseSchema(input.schema);
  const idleTimeoutMillis = input.idleTimeoutMillis ?? DEFAULT_PGPOOL_IDLE_TIMEOUT_MS;

  if (
    !Number.isInteger(idleTimeoutMillis) ||
    idleTimeoutMillis < 1_000 ||
    idleTimeoutMillis > MAX_PGPOOL_IDLE_TIMEOUT_MS
  ) {
    throw new AppError(
      'VALIDATION_FAILED',
      `PGPOOL_IDLE_TIMEOUT_MS must be between 1000 and ${MAX_PGPOOL_IDLE_TIMEOUT_MS}ms (default ${DEFAULT_PGPOOL_IDLE_TIMEOUT_MS}ms) to protect Neon CU-hour budget (ADR 0004)`,
    );
  }

  const max = input.maxConnections ?? DEFAULT_PGPOOL_MAX_CONNECTIONS;
  if (!Number.isInteger(max) || max < 1 || max > 50) {
    throw new AppError('VALIDATION_FAILED', 'PGPOOL_MAX must be an integer between 1 and 50');
  }

  const statementTimeout = input.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  if (!Number.isInteger(statementTimeout) || statementTimeout < 1_000 || statementTimeout > 120_000) {
    throw new AppError('VALIDATION_FAILED', 'statementTimeoutMs must be between 1000 and 120000ms');
  }

  return Object.freeze({
    connectionString: validatedUrl,
    schema,
    idleTimeoutMillis,
    max,
    statement_timeout: statementTimeout,
    options: `-c search_path=${schema}`,
  });
}

export interface QueryResultRow {
  readonly [column: string]: unknown;
}

export interface DatabaseQueryResult<TRow = QueryResultRow> {
  readonly rows: readonly TRow[];
  readonly rowCount: number;
}

export interface DatabaseClient {
  query<TRow = QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<DatabaseQueryResult<TRow>>;
  release(): void;
}

export interface DatabasePool {
  connect(): Promise<DatabaseClient>;
  query<TRow = QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<DatabaseQueryResult<TRow>>;
  end(): Promise<void>;
}

export interface TransactionOptions {
  readonly schema?: DatabaseSchemaName;
  readonly isolationLevel?: TransactionIsolationLevel;
}

/**
 * Executes `work(client)` inside a single PostgreSQL transaction (`BEGIN` -> `COMMIT` / `ROLLBACK`),
 * optionally locking `search_path` to the owning service's schema (`SET LOCAL search_path`).
 * Always releases the client back to the pool in `finally` (Invariant #17).
 */
export async function withTransaction<TResult>(
  pool: DatabasePool,
  work: (client: DatabaseClient) => Promise<TResult>,
  options: TransactionOptions = {},
): Promise<TResult> {
  const client = await pool.connect();
  let committed = false;

  try {
    const isolation = options.isolationLevel ?? 'READ COMMITTED';
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);

    if (options.schema !== undefined) {
      const validSchema = assertDatabaseSchema(options.schema);
      await client.query(`SET LOCAL search_path TO ${validSchema}`);
    }

    const result = await work(client);
    await client.query('COMMIT');
    committed = true;
    return result;
  } catch (err) {
    if (!committed) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve original error if rollback itself fails on a broken connection
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

export interface SqlMigrationFile {
  readonly version: string;
  readonly filename: string;
  readonly sql: string;
}

export interface AppliedMigrationRecord {
  readonly version: string;
  readonly filename: string;
  readonly checksum: string;
}

/**
 * Validates that `DIRECT_DATABASE_URL` is a direct PostgreSQL session URL and not a
 * transaction-mode pooler (`-pooler.` host), which breaks session-level migration locks (ADR 0004).
 */
export function assertDirectMigrationUrl(directDatabaseUrl: string): string {
  if (typeof directDatabaseUrl !== 'string' || !/^postgres(ql)?:\/\/.+/i.test(directDatabaseUrl.trim())) {
    throw new AppError('VALIDATION_FAILED', 'DIRECT_DATABASE_URL must be a valid postgres:// or postgresql:// URI');
  }
  const parsed = new URL(directDatabaseUrl.trim());
  if (parsed.hostname.includes('-pooler.')) {
    throw new AppError(
      'VALIDATION_FAILED',
      'DIRECT_DATABASE_URL must point to the direct unpooled PostgreSQL host, not a -pooler endpoint (ADR 0004)',
    );
  }
  return directDatabaseUrl.trim();
}

export function computeMigrationChecksum(sql: string): string {
  const normalized = sql.replace(/\r\n/g, '\n').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Forward-only migration runner for a service schema (ADR 0004).
 * Verifies checksums of already-applied migrations and applies pending numbered `.sql` files in order.
 */
export async function runForwardMigrations(
  pool: DatabasePool,
  schema: DatabaseSchemaName,
  migrations: readonly SqlMigrationFile[],
): Promise<readonly string[]> {
  const validSchema = assertDatabaseSchema(schema);

  const sorted = [...migrations].sort((a, b) => a.version.localeCompare(b.version));
  for (const m of sorted) {
    if (!/^\d{4}$/.test(m.version)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Migration version "${m.version}" (${m.filename}) must be a 4-digit sequence (e.g. "0001")`,
      );
    }
  }

  return withTransaction(
    pool,
    async (client) => {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${validSchema}`);
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${validSchema}.schema_migrations (
          version TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
      );

      const existing = await client.query<AppliedMigrationRecord>(
        `SELECT version, filename, checksum FROM ${validSchema}.schema_migrations ORDER BY version ASC`,
      );
      const appliedByVersion = new Map<string, AppliedMigrationRecord>();
      for (const row of existing.rows) {
        appliedByVersion.set(row.version, row);
      }

      const newlyApplied: string[] = [];

      for (const migration of sorted) {
        const checksum = computeMigrationChecksum(migration.sql);
        const prev = appliedByVersion.get(migration.version);

        if (prev !== undefined) {
          if (prev.checksum !== checksum) {
            throw new AppError(
              'INTERNAL_ERROR',
              `Migration checksum mismatch for version ${migration.version} (${migration.filename}): applied migration files are immutable`,
            );
          }
          continue;
        }

        await client.query(migration.sql);
        await client.query(
          `INSERT INTO ${validSchema}.schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)`,
          [migration.version, migration.filename, checksum],
        );
        newlyApplied.push(migration.version);
      }

      return Object.freeze(newlyApplied);
    },
    { schema: validSchema },
  );
}

export interface ObjectDatabasePoolConfig {
  readonly host: string;
  readonly user: string;
  readonly password?: string;
  readonly database: string;
  readonly port?: number;
  readonly schema: DatabaseSchemaName;
  readonly max?: number;
  readonly idleTimeoutMillis?: number;
  readonly connectionTimeoutMillis?: number;
}

export interface UnderlyingPgClientLike {
  query(sql: string, values?: readonly unknown[]): Promise<{
    readonly rows?: readonly unknown[];
    readonly rowCount?: number | null;
  }>;
  release(): void;
}

export interface UnderlyingPgPoolLike {
  connect(): Promise<UnderlyingPgClientLike>;
  query(sql: string, values?: readonly unknown[]): Promise<{
    readonly rows?: readonly unknown[];
    readonly rowCount?: number | null;
  }>;
  end(): Promise<void>;
  on?(event: 'error', listener: (err: Error) => void): void;
}

/**
 * Concrete `DatabasePool` adapter wrapping a `pg.Pool` instance with
 * lazy on-demand query execution, schema `search_path` isolation, and sanitized error translation.
 */
export class PgDriverDatabasePool implements DatabasePool {
  private readonly pool: UnderlyingPgPoolLike;
  private readonly schema: DatabaseSchemaName;

  constructor(pool: UnderlyingPgPoolLike, schema: DatabaseSchemaName) {
    this.pool = pool;
    this.schema = assertDatabaseSchema(schema);
    if (typeof this.pool.on === 'function') {
      this.pool.on('error', () => {
        // Prevent unhandled idle client errors from crashing the process
      });
    }
  }

  public async connect(): Promise<DatabaseClient> {
    try {
      const rawClient = await this.pool.connect();
      return {
        query: async <TRow = QueryResultRow>(
          sql: string,
          params?: readonly unknown[],
        ): Promise<DatabaseQueryResult<TRow>> => {
          try {
            const res = await rawClient.query(sql, params ? [...params] : undefined);
            return {
              rows: (res.rows ?? []) as readonly TRow[],
              rowCount: typeof res.rowCount === 'number' ? res.rowCount : (res.rows?.length ?? 0),
            };
          } catch (error) {
            if (error instanceof AppError) {
              throw error;
            }
            throw new AppError('INTERNAL_ERROR', 'Database query failed. Please try again later.');
          }
        },
        release: () => {
          rawClient.release();
        },
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('INTERNAL_ERROR', 'Database connection failed. Please try again later.');
    }
  }

  public async query<TRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<DatabaseQueryResult<TRow>> {
    try {
      const res = await this.pool.query(sql, params ? [...params] : undefined);
      return {
        rows: (res.rows ?? []) as readonly TRow[],
        rowCount: typeof res.rowCount === 'number' ? res.rowCount : (res.rows?.length ?? 0),
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('INTERNAL_ERROR', 'Database query failed. Please try again later.');
    }
  }

  public async end(): Promise<void> {
    await this.pool.end();
  }

  public getSchema(): DatabaseSchemaName {
    return this.schema;
  }
}

export interface DatabaseConnectivityCheckResult {
  readonly connected: true;
  readonly schema: DatabaseSchemaName;
  readonly latencyMs: number;
}

/**
 * Performs a startup or readiness connectivity probe against the target PostgreSQL pool.
 * Verifies the connection can execute `SELECT 1` and resolves the service schema.
 */
export async function verifyDatabaseConnectivity(
  pool: DatabasePool,
  schema: DatabaseSchemaName,
): Promise<DatabaseConnectivityCheckResult> {
  const validSchema = assertDatabaseSchema(schema);
  const startedAt = Date.now();
  try {
    const res = await pool.query<{ readonly ok?: number }>(
      'SELECT 1 AS ok',
    );
    const firstRow = res.rows[0];
    if (firstRow && firstRow.ok !== undefined && Number(firstRow.ok) !== 1) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `Database connectivity check for schema "${validSchema}" returned unexpected probe response`,
      );
    }
    return Object.freeze({
      connected: true,
      schema: validSchema,
      latencyMs: Math.max(0, Date.now() - startedAt),
    });
  } catch (error) {
    if (error instanceof AppError && error.code === 'PROVIDER_UNAVAILABLE') {
      throw error;
    }
    throw new AppError(
      'PROVIDER_UNAVAILABLE',
      `Database startup connectivity check failed for schema "${validSchema}"`,
    );
  }
}

/**
 * Lazily initializes a `DatabasePool` using the `pg` driver.
 * When `connectionString` (`DATABASE_URL` / `BILLING_DATABASE_URL`) is provided, its host,
 * credentials, database, and Neon TLS/pooler parameters take precedence over fallback `SQL_*` vars.
 */
export function createLazyPostgresPool(options: {
  readonly schema: DatabaseSchemaName;
  readonly host?: string;
  readonly user?: string;
  readonly password?: string;
  readonly database?: string;
  readonly port?: number;
  readonly connectionString?: string;
  readonly max?: number;
  readonly idleTimeoutMillis?: number;
  readonly connectionTimeoutMillis?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly poolConstructor?: new (
    cfg: Record<string, unknown>,
  ) => UnderlyingPgPoolLike;
}): DatabasePool {
  const validSchema = assertDatabaseSchema(options.schema);
  let resolvedPoolPromise: Promise<DatabasePool> | null = null;

  const getPool = async (): Promise<DatabasePool> => {
    if (!resolvedPoolPromise) {
      resolvedPoolPromise = (async () => {
        let PoolCtor = options.poolConstructor;
        if (!PoolCtor) {
          const pgModule = (await import('pg')) as {
            default?: {
              Pool: new (cfg: Record<string, unknown>) => UnderlyingPgPoolLike;
            };
            Pool?: new (cfg: Record<string, unknown>) => UnderlyingPgPoolLike;
          };
          PoolCtor = pgModule.Pool ?? pgModule.default?.Pool;
        }
        if (!PoolCtor) {
          throw new AppError(
            'INTERNAL_ERROR',
            'pg.Pool constructor is unavailable',
          );
        }

        const runtimeEnv = options.env ?? process.env;
        let host = options.host ?? runtimeEnv.SQL_HOST ?? '127.0.0.1';
        let user = options.user ?? runtimeEnv.SQL_USER ?? 'postgres';
        let password = options.password ?? runtimeEnv.SQL_PASSWORD ?? '';
        let database = options.database ?? runtimeEnv.SQL_DB_NAME ?? 'kartik';
        let port = options.port ?? 5432;

        let tlsConfig: ResolvedPostgresTlsConfig = {
          requiresSsl: false,
          sslMode: 'disable',
          ssl: undefined,
        };
        let isPoolerEndpoint = false;

        if (!options.host && options.connectionString) {
          try {
            const parsed = new URL(options.connectionString);
            host = parsed.hostname || host;
            user = decodeURIComponent(parsed.username || user);
            password = decodeURIComponent(parsed.password || password);
            database = parsed.pathname.replace(/^\/+/, '') || database;
            port = parsed.port ? Number(parsed.port) : port;
            tlsConfig = resolvePostgresTlsConfig(parsed, runtimeEnv);
            isPoolerEndpoint = host.includes('-pooler');
          } catch {
            // Keep defaults if URL parse fails
          }
        } else {
          try {
            const syntheticUrl = new URL(
              `postgresql://${encodeURIComponent(host)}:${port}/${encodeURIComponent(database)}`,
            );
            tlsConfig = resolvePostgresTlsConfig(syntheticUrl, runtimeEnv);
            isPoolerEndpoint = host.includes('-pooler');
          } catch {
            // Keep defaults
          }
        }

        const rawPool = new PoolCtor({
          host,
          user,
          password,
          database,
          port,
          ...(tlsConfig.ssl ? { ssl: tlsConfig.ssl } : {}),
          max: options.max ?? DEFAULT_PGPOOL_MAX_CONNECTIONS,
          idleTimeoutMillis:
            options.idleTimeoutMillis ?? DEFAULT_PGPOOL_IDLE_TIMEOUT_MS,
          connectionTimeoutMillis: options.connectionTimeoutMillis ?? 15_000,
          ...(isPoolerEndpoint
            ? {}
            : { options: `-c search_path=${validSchema},public` }),
        });

        return new PgDriverDatabasePool(rawPool, validSchema);
      })();
    }
    return resolvedPoolPromise;
  };

  return {
    connect: async () => {
      const pool = await getPool();
      return pool.connect();
    },
    query: async <TRow = QueryResultRow>(
      sql: string,
      params?: readonly unknown[],
    ) => {
      const pool = await getPool();
      return pool.query<TRow>(sql, params);
    },
    end: async () => {
      if (resolvedPoolPromise) {
        const pool = await resolvedPoolPromise;
        await pool.end();
      }
    },
  };
}

