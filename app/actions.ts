'use server';

import { db } from '@/db';
import { medleySongs, songPreferences, songPreferenceLog, blockPreferenceLog, easterEggs } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import type { MedleySong, EasterEgg, SongPreference, SongPreferenceLog, BlockPreferenceLog } from '@/lib/types';

// Shared user — no auth needed
const SHARED_USER_ID = 'shared';

// ── Medley Songs ────────────────────────────────────────────────────────────

export async function getMedleySongs(): Promise<MedleySong[]> {
  const rows = await db.select().from(medleySongs)
    .where(eq(medleySongs.userId, SHARED_USER_ID))
    .orderBy(medleySongs.sortOrder);

  return rows.map(row => ({
    ...JSON.parse(row.arrangementNotes || '{}').catalogData,
    medleyId: row.medleyId,
    snippet_duration: row.snippetDuration,
    section: row.section as MedleySong['section'],
    bar_count: row.barCount ?? 16,
    tempo_treatment: row.tempoTreatment ?? undefined,
    transition_in: row.transitionIn as MedleySong['transition_in'],
    featured_instruments: JSON.parse(row.featuredInstruments || '[]'),
    crowd_moment: row.crowdMoment ?? false,
    easter_egg: row.easterEgg ?? false,
    arrangement_notes: row.arrangementNotes ?? undefined,
    _sortOrder: row.sortOrder,
  }));
}

export async function saveMedleySongs(songs: Array<{
  medleyId: string;
  songId: string;
  snippetDuration: number;
  section: string;
  barCount: number;
  tempoTreatment?: string;
  transitionIn: string;
  featuredInstruments: string[];
  crowdMoment: boolean;
  easterEgg: boolean;
  arrangementNotes?: string;
  sortOrder: number;
}>): Promise<void> {
  const userId = SHARED_USER_ID;

  // Delete all existing medley songs and re-insert
  await db.delete(medleySongs).where(eq(medleySongs.userId, userId));

  if (songs.length === 0) return;

  await db.insert(medleySongs).values(
    songs.map(s => ({
      userId,
      medleyId: s.medleyId,
      songId: s.songId,
      snippetDuration: s.snippetDuration,
      section: s.section,
      barCount: s.barCount,
      tempoTreatment: s.tempoTreatment ?? null,
      transitionIn: s.transitionIn,
      featuredInstruments: JSON.stringify(s.featuredInstruments),
      crowdMoment: s.crowdMoment,
      easterEgg: s.easterEgg,
      arrangementNotes: s.arrangementNotes ?? null,
      sortOrder: s.sortOrder,
    }))
  );
}

// ── Song Preferences ────────────────────────────────────────────────────────

export async function getSongPreferences(): Promise<{ starred: string[]; deleted: string[] }> {
  const userId = SHARED_USER_ID;
  const rows = await db.select().from(songPreferences)
    .where(eq(songPreferences.userId, userId));

  const starred: string[] = [];
  const deleted: string[] = [];
  for (const row of rows) {
    if (row.preference === 'starred') starred.push(row.songId);
    else if (row.preference === 'deleted') deleted.push(row.songId);
  }
  return { starred, deleted };
}

export async function setSongPreference(songId: string, pref: SongPreference): Promise<void> {
  const userId = SHARED_USER_ID;

  // Upsert the preference
  const existing = await db.select().from(songPreferences)
    .where(and(eq(songPreferences.userId, userId), eq(songPreferences.songId, songId)))
    .limit(1);

  if (existing.length > 0) {
    if (pref === 'open') {
      await db.delete(songPreferences)
        .where(and(eq(songPreferences.userId, userId), eq(songPreferences.songId, songId)));
    } else {
      await db.update(songPreferences)
        .set({ preference: pref, updatedAt: new Date() })
        .where(and(eq(songPreferences.userId, userId), eq(songPreferences.songId, songId)));
    }
  } else if (pref !== 'open') {
    await db.insert(songPreferences).values({ userId, songId, preference: pref });
  }

  // Append to log
  await db.insert(songPreferenceLog).values({
    userId,
    songId,
    action: pref,
    timestamp: Date.now(),
  });
}

// ── Block Preferences ───────────────────────────────────────────────────────

export async function getBlockPreferenceLog(): Promise<BlockPreferenceLog[]> {
  const userId = SHARED_USER_ID;
  const rows = await db.select().from(blockPreferenceLog)
    .where(eq(blockPreferenceLog.userId, userId));

  return rows.map(row => ({
    blockFingerprint: row.blockFingerprint,
    songIds: JSON.parse(row.songIds),
    decade: row.decade,
    rating: row.rating as 1 | 2 | 3 | 4 | 5,
    timestamp: row.timestamp,
    meta: JSON.parse(row.meta),
  }));
}

export async function addBlockRating(log: BlockPreferenceLog): Promise<void> {
  const userId = SHARED_USER_ID;
  await db.insert(blockPreferenceLog).values({
    userId,
    blockFingerprint: log.blockFingerprint,
    songIds: JSON.stringify(log.songIds),
    decade: log.decade,
    rating: log.rating,
    timestamp: log.timestamp,
    meta: JSON.stringify(log.meta),
  });
}

// ── Easter Eggs ─────────────────────────────────────────────────────────────

export async function getEasterEggs(): Promise<EasterEgg[]> {
  const userId = SHARED_USER_ID;
  const rows = await db.select().from(easterEggs)
    .where(eq(easterEggs.userId, userId));

  return rows.map(row => ({
    id: row.eggId,
    source_song: row.sourceSong,
    source_decade: row.sourceDecade,
    host_decade: row.hostDecade,
    difficulty: row.difficulty as EasterEgg['difficulty'],
    notes: row.notes,
  }));
}

export async function saveEasterEggs(eggs: EasterEgg[]): Promise<void> {
  const userId = SHARED_USER_ID;

  // Replace all eggs
  await db.delete(easterEggs).where(eq(easterEggs.userId, userId));

  if (eggs.length === 0) return;

  await db.insert(easterEggs).values(
    eggs.map(egg => ({
      userId,
      eggId: egg.id,
      sourceSong: egg.source_song,
      sourceDecade: egg.source_decade,
      hostDecade: egg.host_decade,
      difficulty: egg.difficulty,
      notes: egg.notes,
    }))
  );
}
