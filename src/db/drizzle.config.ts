import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL?.trim();
const sqlHost = process.env.SQL_HOST;
const sqlDbName = process.env.SQL_DB_NAME;
const user = process.env.SQL_ADMIN_USER ?? process.env.SQL_USER;
const password = process.env.SQL_ADMIN_PASSWORD ?? process.env.SQL_PASSWORD;

if (!databaseUrl && (!sqlHost || !sqlDbName || !user || !password)) {
  throw new Error(
    'Either DATABASE_URL (Neon/Postgres) or SQL_HOST + SQL_DB_NAME + SQL_ADMIN_USER + SQL_ADMIN_PASSWORD (Cloud SQL) must be set.',
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials:
    sqlHost && sqlDbName && user && password
      ? {
          host: sqlHost,
          user,
          password,
          database: sqlDbName,
          ssl: false,
        }
      : {
          url: databaseUrl!,
        },
  verbose: true,
});
