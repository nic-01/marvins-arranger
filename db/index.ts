import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:local.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });

// Auto-create tables if they don't exist (runs once on first import)
const migrate = db.run(sql`
  CREATE TABLE IF NOT EXISTS medley_songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    medley_id TEXT NOT NULL,
    song_id TEXT NOT NULL,
    snippet_duration INTEGER NOT NULL DEFAULT 45,
    section TEXT DEFAULT 'chorus',
    bar_count INTEGER DEFAULT 16,
    tempo_treatment TEXT,
    transition_in TEXT DEFAULT 'hard_cut',
    featured_instruments TEXT DEFAULT '[]',
    crowd_moment INTEGER DEFAULT 0,
    easter_egg INTEGER DEFAULT 0,
    arrangement_notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  )
`).then(() => db.run(sql`
  CREATE TABLE IF NOT EXISTS song_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    song_id TEXT NOT NULL,
    preference TEXT NOT NULL,
    updated_at INTEGER
  )
`)).then(() => db.run(sql`
  CREATE TABLE IF NOT EXISTS song_preference_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    song_id TEXT NOT NULL,
    action TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  )
`)).then(() => db.run(sql`
  CREATE TABLE IF NOT EXISTS block_preference_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    block_fingerprint TEXT NOT NULL,
    song_ids TEXT NOT NULL,
    decade TEXT NOT NULL,
    rating INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    meta TEXT NOT NULL
  )
`)).then(() => db.run(sql`
  CREATE TABLE IF NOT EXISTS easter_eggs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    egg_id TEXT NOT NULL,
    source_song TEXT NOT NULL,
    source_decade TEXT NOT NULL,
    host_decade TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER
  )
`)).catch((err) => {
  console.error('Auto-migration failed:', err);
});

export { migrate };
