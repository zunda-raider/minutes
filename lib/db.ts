/**
 * Shared PostgreSQL pool for server routes / scripts.
 * Requires DATABASE_URL (see .env.example).
 */

import { Pool, types } from 'pg';

// DATE (OID 1082) as 'YYYY-MM-DD' string — avoid JS Date TZ shifts (e.g. Asia/Tokyo).
types.setTypeParser(types.builtins.DATE, (val: string) => val);

let pool: Pool | null = null;

export function getDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url || null;
}

export function isDbConfigured(): boolean {
  return Boolean(getDatabaseUrl());
}

/** Lazy singleton pool. Throws if DATABASE_URL is missing. */
export function getPool(): Pool {
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!pool) {
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

/** Close the pool (scripts / tests). Safe if never opened. */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}
