import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

type DB = ReturnType<typeof drizzle<typeof schema>>;

let _db: DB | null = null;

/**
 * Returns the Drizzle DB instance, or null if Turso env vars are not configured.
 * Lazily initialised on first call so module-level import never crashes.
 */
export function getDb(): DB | null {
  if (_db) return _db;

  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.warn('[db] TURSO_DATABASE_URL is not set — database is unavailable');
    return null;
  }

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  _db = drizzle(client, { schema });
  return _db;
}

/**
 * Returns the DB instance, throwing if unavailable.
 * Use in server actions where DB is required.
 */
export function requireDb(): DB {
  const db = getDb();
  if (!db) throw new Error('Database is not configured (TURSO_DATABASE_URL missing)');
  return db;
}

// Keep backward-compat default export for server actions
// that import `db` directly — but lazy now
export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const real = requireDb();
    return (real as unknown as Record<string | symbol, unknown>)[prop];
  },
});
