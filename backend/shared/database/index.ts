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

/**
 * Builds and validates a PostgreSQL pool configuration that enforces schema search_path
 * isolation and Neon scale-to-zero idle timeout rules (ADR 0004).
 */
export function buildDatabasePoolConfig(input: DatabasePoolConfigInput): ResolvedDatabasePoolConfig {
  if (typeof input.connectionString !== 'string' || !/^postgres(ql)?:\/\/.+/i.test(input.connectionString.trim())) {
    throw new AppError('VALIDATION_FAILED', 'DATABASE_URL must be a valid postgres:// or postgresql:// URI');
  }

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
    connectionString: input.connectionString.trim(),
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

/**
 * Lazily initializes a `DatabasePool` using the `pg` driver and the Object Method (`host`, `user`, `password`, `database`).
 * Does NOT perform eager startup probes or reconnect loops.
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
}): DatabasePool {
  const validSchema = assertDatabaseSchema(options.schema);
  let resolvedPoolPromise: Promise<DatabasePool> | null = null;

  const getPool = async (): Promise<DatabasePool> => {
    if (!resolvedPoolPromise) {
      resolvedPoolPromise = (async () => {
        const pgModule = (await import('pg')) as {
          default?: { Pool: new (cfg: Record<string, unknown>) => UnderlyingPgPoolLike };
          Pool?: new (cfg: Record<string, unknown>) => UnderlyingPgPoolLike;
        };
        const PoolCtor = pgModule.Pool ?? pgModule.default?.Pool;
        if (!PoolCtor) {
          throw new AppError('INTERNAL_ERROR', 'pg.Pool constructor is unavailable');
        }

        let host = options.host ?? process.env.SQL_HOST ?? '127.0.0.1';
        let user = options.user ?? process.env.SQL_USER ?? 'postgres';
        let password = options.password ?? process.env.SQL_PASSWORD ?? '';
        let database = options.database ?? process.env.SQL_DB_NAME ?? 'kartik';
        let port = options.port ?? 5432;

        let requiresSsl = false;
        let isPoolerEndpoint = false;

        if (!options.host && !process.env.SQL_HOST && options.connectionString) {
          try {
            const parsed = new URL(options.connectionString);
            host = parsed.hostname || host;
            user = decodeURIComponent(parsed.username || user);
            password = decodeURIComponent(parsed.password || password);
            database = parsed.pathname.replace(/^\/+/, '') || database;
            port = parsed.port ? Number(parsed.port) : port;
            requiresSsl =
              parsed.searchParams.get('sslmode') === 'require' ||
              host.includes('neon.tech');
            isPoolerEndpoint = host.includes('-pooler');
          } catch {
            // Keep defaults if URL parse fails
          }
        }

        const rawPool = new PoolCtor({
          host,
          user,
          password,
          database,
          port,
          ...(requiresSsl ? { ssl: { rejectUnauthorized: false } } : {}),
          max: options.max ?? DEFAULT_PGPOOL_MAX_CONNECTIONS,
          idleTimeoutMillis: options.idleTimeoutMillis ?? DEFAULT_PGPOOL_IDLE_TIMEOUT_MS,
          connectionTimeoutMillis: options.connectionTimeoutMillis ?? 15_000,
          ...(isPoolerEndpoint ? {} : { options: `-c search_path=${validSchema},public` }),
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
    query: async <TRow = QueryResultRow>(sql: string, params?: readonly unknown[]) => {
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

