'use client';

import { useState, useCallback, useMemo, useEffect, useRef, useTransition } from 'react';
import type { Song, MedleySong, EasterEgg, SongPreference, SongPreferenceLog, BlockPreferenceLog, BlockRating } from '@/lib/types';
import SongBrowser from '@/components/SongBrowser';
import MedleyPlanner from '@/components/MedleyPlanner';
import BlockGenerator from '@/components/BlockGenerator';
import EasterEggTracker from '@/components/EasterEggTracker';
import { DEFAULT_EGGS } from '@/lib/default-eggs';
import ArrangementView from '@/components/ArrangementView';
import ExportPanel from '@/components/ExportPanel';
import { allSongs } from '@/lib/data';
import {
  saveMedleySongs,
  setSongPreference,
  addBlockRating,
  saveEasterEggs,
} from './actions';

type Stage = 'songs' | 'blocks' | 'arrange' | 'export';

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

interface AppShellProps {
  initialMedleySongs: MedleySong[];
  initialStarred: string[];
  initialDeleted: string[];
  initialBlockPrefLog: BlockPreferenceLog[];
  initialEggs: EasterEgg[];
}

export default function AppShell({
  initialMedleySongs,
  initialStarred,
  initialDeleted,
  initialBlockPrefLog,
  initialEggs,
}: AppShellProps) {
  const [stage, setStage] = useState<Stage>('songs');
  const [isPending, startTransition] = useTransition();

  const [medleySongs, setMedleySongs] = useState<MedleySong[]>(initialMedleySongs);
  const [easterEggs, setEasterEggs] = useState<EasterEgg[]>(initialEggs);
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(initialStarred));
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set(initialDeleted));
  const [blockPrefLog, setBlockPrefLog] = useState<BlockPreferenceLog[]>(initialBlockPrefLog);

  const blockRatings = useMemo(() => {
    const map = new Map<string, BlockRating>();
    for (const entry of blockPrefLog) {
      map.set(entry.blockFingerprint, entry.rating);
    }
    return map;
  }, [blockPrefLog]);

  // Sync medley songs to DB on change (debounced)
  const medleySongsRef = useRef(medleySongs);
  medleySongsRef.current = medleySongs;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Skip initial render
    if (medleySongs === initialMedleySongs) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      startTransition(async () => {
        await saveMedleySongs(
          medleySongsRef.current.map((s, i) => ({
            medleyId: s.medleyId,
            songId: s.id,
            snippetDuration: s.snippet_duration,
            section: s.section || 'chorus',
            barCount: s.bar_count || 16,
            tempoTreatment: s.tempo_treatment,
            transitionIn: s.transition_in || 'hard_cut',
            featuredInstruments: s.featured_instruments || [],
            crowdMoment: s.crowd_moment || false,
            easterEgg: s.easter_egg || false,
            arrangementNotes: s.arrangement_notes,
            sortOrder: i,
          }))
        );
      });
    }, 500);

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [medleySongs]);

  // Sync easter eggs to DB on change (debounced)
  const eggsRef = useRef(easterEggs);
  eggsRef.current = easterEggs;
  const eggTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (easterEggs === initialEggs) return;

    if (eggTimerRef.current) clearTimeout(eggTimerRef.current);
    eggTimerRef.current = setTimeout(() => {
      startTransition(async () => {
        await saveEasterEggs(eggsRef.current);
      });
    }, 500);

    return () => { if (eggTimerRef.current) clearTimeout(eggTimerRef.current); };
  }, [easterEggs]);

  const handleRateBlock = useCallback((log: BlockPreferenceLog) => {
    setBlockPrefLog(prev => [...prev, log]);
    startTransition(async () => {
      await addBlockRating(log);
    });
  }, []);

  const handlePreferenceChange = useCallback((songId: string, pref: SongPreference) => {
    if (pref === 'starred') {
      setStarredIds(prev => { const next = new Set(prev); next.add(songId); return next; });
      setDeletedIds(prev => { const next = new Set(prev); next.delete(songId); return next; });
    } else if (pref === 'deleted') {
      setDeletedIds(prev => { const next = new Set(prev); next.add(songId); return next; });
      setStarredIds(prev => { const next = new Set(prev); next.delete(songId); return next; });
    } else {
      setStarredIds(prev => { const next = new Set(prev); next.delete(songId); return next; });
      setDeletedIds(prev => { const next = new Set(prev); next.delete(songId); return next; });
    }

    startTransition(async () => {
      await setSongPreference(songId, pref);
    });
  }, []);

  const medleySongIds = useMemo(
    () => new Set(medleySongs.map((s) => s.id)),
    [medleySongs]
  );

  const songToMedley = (song: Song): MedleySong => ({
    ...song,
    medleyId: generateId(),
    snippet_duration: song.crowd_singalong ? 55 : 45,
    section: 'chorus',
    bar_count: 16,
    transition_in: 'hard_cut',
    featured_instruments: [],
    crowd_moment: song.crowd_singalong,
    easter_egg: false,
  });

  const handleAddToMedley = useCallback((song: Song) => {
    setMedleySongs((prev) => {
      const updated = [...prev, songToMedley(song)];
      updated.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
      return updated;
    });
  }, []);

  const handleBulkAdd = useCallback((songs: Song[]) => {
    setMedleySongs((prev) => {
      const existingIds = new Set(prev.map((s) => s.id));
      const newSongs = songs.filter((s) => !existingIds.has(s.id)).map(songToMedley);
      const updated = [...prev, ...newSongs];
      updated.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
      return updated;
    });
  }, []);

  const handleRemoveSong = useCallback((medleyId: string) => {
    setMedleySongs((prev) => prev.filter((s) => s.medleyId !== medleyId));
  }, []);

  const handleRemoveFromMedley = useCallback((songId: string) => {
    setMedleySongs((prev) => prev.filter((s) => s.id !== songId));
  }, []);

  const handleBulkRemove = useCallback((songIds: string[]) => {
    const idsToRemove = new Set(songIds);
    setMedleySongs((prev) => prev.filter((s) => !idsToRemove.has(s.id)));
  }, []);

  const handleUpdateSong = useCallback((medleyId: string, updates: Partial<MedleySong>) => {
    setMedleySongs((prev) =>
      prev.map((s) => (s.medleyId === medleyId ? { ...s, ...updates } : s))
    );
  }, []);

  const handleReplaceSongs = useCallback((newSongs: MedleySong[]) => {
    setMedleySongs(newSongs);
  }, []);

  const handleReorderSong = useCallback((medleyId: string, direction: 'up' | 'down') => {
    setMedleySongs((prev) => {
      const idx = prev.findIndex((s) => s.medleyId === medleyId);
      if (idx === -1) return prev;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const updated = [...prev];
      [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
      return updated;
    });
  }, []);

  const handleAddEgg = useCallback((egg: Omit<EasterEgg, 'id'>) => {
    setEasterEggs((prev) => [...prev, { ...egg, id: generateId() }]);
  }, []);

  const handleRemoveEgg = useCallback((id: string) => {
    setEasterEggs((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const handleUpdateEgg = useCallback((id: string, updates: Partial<EasterEgg>) => {
    setEasterEggs((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...updates } : e))
    );
  }, []);

  const handleAcceptBlockArrangement = useCallback((songs: Song[]) => {
    const medley = songs.map(s => ({
      ...s,
      medleyId: generateId(),
      snippet_duration: s.crowd_singalong ? 55 : 45,
      section: 'chorus' as const,
      bar_count: 16,
      transition_in: 'hard_cut' as const,
      featured_instruments: [],
      crowd_moment: s.crowd_singalong,
      easter_egg: false,
    }));
    setMedleySongs(medley);
    setStage('arrange');
  }, []);

  // Stage definitions
  const stages: { key: Stage; label: string; badge?: string }[] = [
    { key: 'songs', label: '1. Songs', badge: `${allSongs.length - deletedIds.size}` },
    { key: 'blocks', label: '2. Blocks' },
    { key: 'arrange', label: '3. Arrange', badge: medleySongs.length > 0 ? `${medleySongs.length}` : undefined },
    { key: 'export', label: '4. Export' },
  ];

  const totalSeconds = medleySongs.reduce((s, song) => s + song.snippet_duration, 0);
  const totalMin = Math.floor(totalSeconds / 60);
  const totalSec = totalSeconds % 60;

  return (
    <div style={styles.app}>
      {/* Header bar */}
      <div style={styles.headerBar}>
        <div style={styles.headerLeft}>
          <h1 style={styles.logo}>The Hundred Years&apos; Medley</h1>
          <span style={styles.subtitle}>A Century of Medley: A Story of Rock &amp; Roll for Generations to Come</span>
          <span style={styles.buildVersion}>v1.03</span>
        </div>

        <div style={styles.headerTabs}>
          {stages.map(({ key, label, badge }) => (
            <button
              key={key}
              style={stage === key ? styles.activeTab : styles.tab}
              onClick={() => setStage(key)}
            >
              {label}
              {badge && <span style={styles.tabBadge}>{badge}</span>}
            </button>
          ))}
        </div>

        <div style={styles.headerRight}>
          {isPending && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Saving...</span>
          )}
          {starredIds.size > 0 && (
            <span style={styles.headerStat}>
              <span style={{ color: '#ffd700' }}>{'\u2605'}</span> {starredIds.size} starred
            </span>
          )}
          {medleySongs.length > 0 && (
            <span style={styles.headerStat}>
              {medleySongs.length} songs &middot; {totalMin}:{totalSec.toString().padStart(2, '0')}
            </span>
          )}
        </div>
      </div>

      {/* Full-screen stage content */}
      <div style={styles.stageContent}>
        {stage === 'songs' && (
          <SongBrowser
            songs={allSongs}
            onAddToMedley={handleAddToMedley}
            onRemoveFromMedley={handleRemoveFromMedley}
            onBulkAdd={handleBulkAdd}
            onBulkRemove={handleBulkRemove}
            medleySongIds={medleySongIds}
            starredIds={starredIds}
            deletedIds={deletedIds}
            onPreferenceChange={handlePreferenceChange}
            showPreferences
          />
        )}

        {stage === 'blocks' && (
          <BlockGenerator
            catalog={allSongs}
            medleySongIds={medleySongIds}
            starredIds={starredIds}
            deletedIds={deletedIds}
            onAcceptArrangement={handleAcceptBlockArrangement}
            onRateBlock={handleRateBlock}
            blockRatings={blockRatings}
            blockPrefLog={blockPrefLog}
          />
        )}

        {stage === 'arrange' && (
          <div style={styles.arrangeLayout}>
            <div style={styles.arrangeMain}>
              <MedleyPlanner
                songs={medleySongs}
                catalog={allSongs}
                onRemoveSong={handleRemoveSong}
                onUpdateSong={handleUpdateSong}
                onReorderSong={handleReorderSong}
                onReplaceSongs={handleReplaceSongs}
              />
            </div>
            <div style={styles.arrangeSide}>
              <ArrangementView
                songs={medleySongs}
                onUpdateSong={handleUpdateSong}
              />
            </div>
          </div>
        )}

        {stage === 'export' && (
          <div style={styles.exportLayout}>
            <div style={styles.exportMain}>
              <ExportPanel songs={medleySongs} eggs={easterEggs} />
            </div>
            <div style={styles.exportSide}>
              <EasterEggTracker
                eggs={easterEggs}
                onAddEgg={handleAddEgg}
                onRemoveEgg={handleRemoveEgg}
                onUpdateEgg={handleUpdateEgg}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    height: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  headerBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px',
    height: 48,
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
    flexShrink: 0,
  },
  logo: {
    fontSize: 15,
    fontWeight: 800,
    background: 'linear-gradient(90deg, #ff6b6b, #ffa94d, #ffd43b, #69db7c, #3bc9db, #748ffc, #da77f2)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    margin: 0,
  },
  subtitle: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  buildVersion: {
    fontSize: 10,
    color: 'var(--text-muted)',
    opacity: 0.5,
    marginLeft: 8,
  },
  headerTabs: {
    display: 'flex',
    gap: 2,
  },
  tab: {
    padding: '6px 16px',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  activeTab: {
    padding: '6px 16px',
    background: 'var(--bg-tertiary)',
    border: 'none',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  tabBadge: {
    fontSize: 10,
    padding: '1px 5px',
    borderRadius: 8,
    background: 'var(--bg-secondary)',
    color: 'var(--text-muted)',
    fontWeight: 600,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexShrink: 0,
  },
  headerStat: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  stageContent: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  arrangeLayout: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  arrangeMain: {
    flex: 2,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid var(--border)',
  },
  arrangeSide: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  exportLayout: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  exportMain: {
    flex: 1,
    overflow: 'auto',
    borderRight: '1px solid var(--border)',
  },
  exportSide: {
    flex: 1,
    overflow: 'auto',
  },
};
