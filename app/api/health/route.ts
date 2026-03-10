import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { medleySongs } from '@/db/schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, string> = {
    env_turso_url: process.env.TURSO_DATABASE_URL ? 'set' : 'MISSING',
    env_turso_token: process.env.TURSO_AUTH_TOKEN ? 'set' : 'MISSING',
  };

  const db = getDb();
  if (!db) {
    return NextResponse.json({ status: 'error', checks, db: 'unavailable' }, { status: 503 });
  }

  try {
    // Simple query to verify tables exist and connection works
    const rows = await db.select().from(medleySongs).limit(1);
    checks.db_query = `ok (${rows.length} rows)`;
  } catch (e) {
    checks.db_query = `error: ${e instanceof Error ? e.message : String(e)}`;
    return NextResponse.json({ status: 'error', checks }, { status: 503 });
  }

  return NextResponse.json({ status: 'ok', checks });
}
