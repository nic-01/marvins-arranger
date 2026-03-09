import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// ── Medley Songs ────────────────────────────────────────────────────────────
// Songs that the user has added to their medley arrangement

export const medleySongs = sqliteTable('medley_songs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  medleyId: text('medley_id').notNull(), // unique ID within the medley
  songId: text('song_id').notNull(), // references the static catalog song ID
  snippetDuration: integer('snippet_duration').notNull().default(45),
  section: text('section').default('chorus'), // chorus | verse | bridge | instrumental
  barCount: integer('bar_count').default(16),
  tempoTreatment: text('tempo_treatment'),
  transitionIn: text('transition_in').default('hard_cut'),
  featuredInstruments: text('featured_instruments').default('[]'), // JSON array
  crowdMoment: integer('crowd_moment', { mode: 'boolean' }).default(false),
  easterEgg: integer('easter_egg', { mode: 'boolean' }).default(false),
  arrangementNotes: text('arrangement_notes'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// ── Song Preferences ────────────────────────────────────────────────────────
// Stars and deletions (soft-delete/hide)

export const songPreferences = sqliteTable('song_preferences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  songId: text('song_id').notNull(),
  preference: text('preference').notNull(), // 'starred' | 'deleted' | 'open'
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// ── Song Preference Log ─────────────────────────────────────────────────────
// Append-only log of preference changes

export const songPreferenceLog = sqliteTable('song_preference_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  songId: text('song_id').notNull(),
  action: text('action').notNull(), // 'starred' | 'deleted' | 'open'
  timestamp: integer('timestamp').notNull(),
});

// ── Block Preference Log ────────────────────────────────────────────────────
// Netflix-style block ratings (append-only, latest wins)

export const blockPreferenceLog = sqliteTable('block_preference_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  blockFingerprint: text('block_fingerprint').notNull(),
  songIds: text('song_ids').notNull(), // JSON array
  decade: text('decade').notNull(),
  rating: integer('rating').notNull(), // 1-5
  timestamp: integer('timestamp').notNull(),
  meta: text('meta').notNull(), // JSON object with avgScore, avgEnergy, etc.
});

// ── Easter Eggs ─────────────────────────────────────────────────────────────

export const easterEggs = sqliteTable('easter_eggs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  eggId: text('egg_id').notNull(), // client-generated unique ID
  sourceSong: text('source_song').notNull(),
  sourceDecade: text('source_decade').notNull(),
  hostDecade: text('host_decade').notNull(),
  difficulty: text('difficulty').notNull(), // Easy | Medium | Hard | Very Hard
  notes: text('notes').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
