import { auth } from '@clerk/nextjs/server';
import { SignInButton, UserButton } from '@clerk/nextjs';
import { db } from '@/db';
import { medleySongs, songPreferences, blockPreferenceLog, easterEggs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { allSongs } from '@/lib/data';
import type { MedleySong, EasterEgg, BlockPreferenceLog as BPL } from '@/lib/types';
import { DEFAULT_EGGS } from '@/components/EasterEggTracker';
import AppShell from './app-shell';

export default async function Page() {
  const { userId } = await auth();

  if (!userId) {
    return (
      <div style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
      }}>
        <h1 style={{
          fontSize: 24,
          fontWeight: 800,
          background: 'linear-gradient(90deg, #ff6b6b, #ffa94d, #ffd43b, #69db7c, #3bc9db, #748ffc, #da77f2)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          The Hundred Years&apos; Medley
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>Sign in to start arranging</p>
        <SignInButton mode="modal">
          <button className="primary" style={{ padding: '10px 24px', fontSize: 14 }}>
            Sign In
          </button>
        </SignInButton>
      </div>
    );
  }

  // Load all user data from DB
  const songMap = new Map(allSongs.map(s => [s.id, s]));

  const [medleyRows, prefRows, blockLogRows, eggRows] = await Promise.all([
    db.select().from(medleySongs).where(eq(medleySongs.userId, userId)).orderBy(medleySongs.sortOrder),
    db.select().from(songPreferences).where(eq(songPreferences.userId, userId)),
    db.select().from(blockPreferenceLog).where(eq(blockPreferenceLog.userId, userId)),
    db.select().from(easterEggs).where(eq(easterEggs.userId, userId)),
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
