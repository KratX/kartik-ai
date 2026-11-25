import * as dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { resolvePostgresTlsConfig } from '../../backend/shared/database/index.js';
import * as schema from './schema.ts';

dotenv.config({ quiet: true });

declare global {
  // eslint-disable-next-line no-var
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (databaseUrl && !process.env.SQL_HOST) {
      const parsed = new URL(databaseUrl);
      const tlsConfig = resolvePostgresTlsConfig(parsed, process.env);
      global._postgresPool = new Pool({
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 5432,
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.replace(/^\/+/, '') || 'neondb',
        ...(tlsConfig.ssl ? { ssl: tlsConfig.ssl } : {}),
        max: 10,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 15000,
        keepAlive: true,
      });
    } else {
      const sqlHost = process.env.SQL_HOST ?? '127.0.0.1';
      const sqlDbName = process.env.SQL_DB_NAME ?? 'kartik';
      const syntheticUrl = new URL(
        `postgresql://${encodeURIComponent(sqlHost)}:5432/${encodeURIComponent(sqlDbName)}`,
      );
      const tlsConfig = resolvePostgresTlsConfig(syntheticUrl, process.env);
      global._postgresPool = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        ...(tlsConfig.ssl ? { ssl: tlsConfig.ssl } : {}),
        max: 10,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 15000,
        keepAlive: true,
      });
    }

    global._postgresPool.on('error', () => {
      // Absorb routine idle client disconnections when serverless Postgres (Neon / Cloud SQL) scales to zero;
      // pg.Pool automatically evicts the closed client and opens a fresh connection on the next query.
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
export { pool };
