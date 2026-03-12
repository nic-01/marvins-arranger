import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { Song, MedleySong, EasterEgg, SongPreference, SongPreferenceLog, BlockPreferenceLog, BlockRating } from './types';
import SongBrowser from './components/SongBrowser';
import MedleyPlanner from './components/MedleyPlanner';
import BlockGenerator from './components/BlockGenerator';
import EasterEggTracker, { DEFAULT_EGGS } from './components/EasterEggTracker';
import ArrangementView from './components/ArrangementView';
import ExportPanel from './components/ExportPanel';
import { allSongs } from './data';

// Full-screen staged workflow
type Stage = 'songs' | 'blocks' | 'arrange' | 'export';

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return fallback;
}

function App() {
  const [stage, setStage] = useState<Stage>('songs');

  const [medleySongs, setMedleySongs] = useState<MedleySong[]>(() =>
    loadFromStorage('medley-songs', [])
  );

  const [easterEggs, setEasterEggs] = useState<EasterEgg[]>(() =>
    loadFromStorage('medley-eggs', DEFAULT_EGGS.map((egg) => ({ ...egg, id: generateId() })))
  );

  // Song preferences (star/delete)
  const [starredIds, setStarredIds] = useState<Set<string>>(() => {
    const stored = loadFromStorage<string[]>('song-starred', []);
    return new Set(stored);
  });
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => {
    const stored = loadFromStorage<string[]>('song-deleted', []);
    return new Set(stored);
  });
  const [prefLog, setPrefLog] = useState<SongPreferenceLog[]>(() =>
    loadFromStorage('song-pref-log', [])
  );

  // Block preferences (Netflix-style ratings)
  const [blockPrefLog, setBlockPrefLog] = useState<BlockPreferenceLog[]>(() =>
    loadFromStorage('block-pref-log', [])
  );

  const blockRatings = useMemo(() => {
    const map = new Map<string, BlockRating>();
    // Latest rating wins (log is append-only)
    for (const entry of blockPrefLog) {
      map.set(entry.blockFingerprint, entry.rating);
    }
    return map;
  }, [blockPrefLog]);

  const handleRateBlock = useCallback((log: BlockPreferenceLog) => {
    setBlockPrefLog(prev => [...prev, log]);
  }, []);

  const handlePreferenceChange = useCallback((songId: string, pref: SongPreference) => {
    const logEntry: SongPreferenceLog = { songId, action: pref, timestamp: Date.now() };
    setPrefLog(prev => [...prev, logEntry]);

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
  }, []);

  // Persist to localStorage
  useEffect(() => { localStorage.setItem('medley-songs', JSON.stringify(medleySongs)); }, [medleySongs]);
  useEffect(() => { localStorage.setItem('medley-eggs', JSON.stringify(easterEggs)); }, [easterEggs]);
  useEffect(() => { localStorage.setItem('song-starred', JSON.stringify(Array.from(starredIds))); }, [starredIds]);
  useEffect(() => { localStorage.setItem('song-deleted', JSON.stringify(Array.from(deletedIds))); }, [deletedIds]);
  useEffect(() => { localStorage.setItem('song-pref-log', JSON.stringify(prefLog)); }, [prefLog]);
  useEffect(() => { localStorage.setItem('block-pref-log', JSON.stringify(blockPrefLog)); }, [blockPrefLog]);

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

  // Export/import preferences
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportPrefs = useCallback(() => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      starred: Array.from(starredIds),
      deleted: Array.from(deletedIds),
      prefLog,
      blockPrefLog,
      blockRatings: Array.from(blockRatings.entries()),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marvins-prefs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [starredIds, deletedIds, prefLog, blockPrefLog, blockRatings]);

  const handleImportPrefs = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (data.starred) setStarredIds(new Set(data.starred));
        if (data.deleted) setDeletedIds(new Set(data.deleted));
        if (data.prefLog) setPrefLog(data.prefLog);
        if (data.blockPrefLog) setBlockPrefLog(data.blockPrefLog);
        // blockRatings is derived from blockPrefLog via useMemo, no need to import separately
      } catch { /* ignore bad files */ }
    };
    reader.readAsText(file);
    // Reset so same file can be re-imported
    e.target.value = '';
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
          <h1 style={styles.logo}>The Hundred Years' Medley</h1>
          <span style={styles.subtitle}>Marvin's Arranger</span>
          <span style={styles.buildVersion}>v1.05</span>
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
          <button onClick={handleExportPrefs} style={styles.headerBtn} title="Export preferences (stars, deletions, ratings)">
            Export
          </button>
          <button onClick={() => fileInputRef.current?.click()} style={styles.headerBtn} title="Import preferences from file">
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportPrefs}
            style={{ display: 'none' }}
          />
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
  headerBtn: {
    fontSize: 11,
    padding: '3px 8px',
    borderRadius: 4,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
  stageContent: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  // Arrange stage: medley planner (2/3) + arrangement view (1/3)
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
  // Export stage: export (1/2) + easter eggs (1/2)
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

export default App;
