import { db, migrate } from '@/db';
import { medleySongs, songPreferences, blockPreferenceLog, easterEggs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { allSongs } from '@/lib/data';
import type { MedleySong, EasterEgg, BlockPreferenceLog as BPL } from '@/lib/types';
import { DEFAULT_EGGS } from '@/components/EasterEggTracker';
import AppShell from './app-shell';

// Force dynamic rendering — DB may not exist at build time
export const dynamic = 'force-dynamic';

const SHARED_USER_ID = 'shared';

export default async function Page() {
  await migrate; // ensure tables exist before querying
  const songMap = new Map(allSongs.map(s => [s.id, s]));

  const [medleyRows, prefRows, blockLogRows, eggRows] = await Promise.all([
    db.select().from(medleySongs).where(eq(medleySongs.userId, SHARED_USER_ID)).orderBy(medleySongs.sortOrder),
    db.select().from(songPreferences).where(eq(songPreferences.userId, SHARED_USER_ID)),
    db.select().from(blockPreferenceLog).where(eq(blockPreferenceLog.userId, SHARED_USER_ID)),
    db.select().from(easterEggs).where(eq(easterEggs.userId, SHARED_USER_ID)),
  ]);

  // Reconstruct MedleySong objects by joining with catalog
  const initialMedleySongs: MedleySong[] = [];
  for (const row of medleyRows) {
    const catalogSong = songMap.get(row.songId);
    if (!catalogSong) continue;
    initialMedleySongs.push({
      ...catalogSong,
      medleyId: row.medleyId,
      snippet_duration: row.snippetDuration,
      section: (row.section || 'chorus') as MedleySong['section'],
      bar_count: row.barCount ?? 16,
      tempo_treatment: row.tempoTreatment ?? undefined,
      transition_in: (row.transitionIn || 'hard_cut') as MedleySong['transition_in'],
      featured_instruments: JSON.parse(row.featuredInstruments || '[]'),
      crowd_moment: row.crowdMoment ?? false,
      easter_egg: row.easterEgg ?? false,
      arrangement_notes: row.arrangementNotes ?? undefined,
    });
  }

  // Reconstruct preferences
  const initialStarred = prefRows.filter(r => r.preference === 'starred').map(r => r.songId);
  const initialDeleted = prefRows.filter(r => r.preference === 'deleted').map(r => r.songId);

  // Reconstruct block pref log
  const initialBlockPrefLog: BPL[] = blockLogRows.map(row => ({
    blockFingerprint: row.blockFingerprint,
    songIds: JSON.parse(row.songIds),
    decade: row.decade,
    rating: row.rating as 1 | 2 | 3 | 4 | 5,
    timestamp: row.timestamp,
    meta: JSON.parse(row.meta),
  }));

  // Reconstruct easter eggs
  const initialEggs: EasterEgg[] = eggRows.length > 0
    ? eggRows.map(row => ({
        id: row.eggId,
        source_song: row.sourceSong,
        source_decade: row.sourceDecade,
        host_decade: row.hostDecade,
        difficulty: row.difficulty as EasterEgg['difficulty'],
        notes: row.notes,
      }))
    : DEFAULT_EGGS.map((egg) => ({ ...egg, id: Math.random().toString(36).substring(2, 10) }));

  return (
    <AppShell
      initialMedleySongs={initialMedleySongs}
      initialStarred={initialStarred}
      initialDeleted={initialDeleted}
      initialBlockPrefLog={initialBlockPrefLog}
      initialEggs={initialEggs}
    />
  );
}
