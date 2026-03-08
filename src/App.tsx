import { useState, useCallback, useMemo, useEffect } from 'react';
import type { Song, MedleySong, EasterEgg, SongPreference, SongPreferenceLog } from './types';
import SongBrowser from './components/SongBrowser';
import MedleyPlanner from './components/MedleyPlanner';
import BlockGenerator from './components/BlockGenerator';
import EasterEggTracker, { DEFAULT_EGGS } from './components/EasterEggTracker';
import ArrangementView from './components/ArrangementView';
import ExportPanel from './components/ExportPanel';
import { allSongs } from './data';

type Tab = 'planner' | 'blocks' | 'arrangement';
type RightTab = 'eggs' | 'export';
type MobilePanel = 'browse' | 'planner' | 'blocks' | 'arrangement' | 'eggs' | 'export';

function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

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
  const isMobile = useIsMobile();
  const [medleySongs, setMedleySongs] = useState<MedleySong[]>(() =>
    loadFromStorage('medley-songs', [])
  );
  const [activeTab, setActiveTab] = useState<Tab>('planner');
  const [rightTab, setRightTab] = useState<RightTab>('eggs');
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('browse');

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
      // 'open' — remove from both
      setStarredIds(prev => { const next = new Set(prev); next.delete(songId); return next; });
      setDeletedIds(prev => { const next = new Set(prev); next.delete(songId); return next; });
    }
  }, []);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem('medley-songs', JSON.stringify(medleySongs));
  }, [medleySongs]);

  useEffect(() => {
    localStorage.setItem('medley-eggs', JSON.stringify(easterEggs));
  }, [easterEggs]);

  useEffect(() => {
    localStorage.setItem('song-starred', JSON.stringify(Array.from(starredIds)));
  }, [starredIds]);

  useEffect(() => {
    localStorage.setItem('song-deleted', JSON.stringify(Array.from(deletedIds)));
  }, [deletedIds]);

  useEffect(() => {
    localStorage.setItem('song-pref-log', JSON.stringify(prefLog));
  }, [prefLog]);

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
      const newSongs = songs
        .filter((s) => !existingIds.has(s.id))
        .map(songToMedley);
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
    setActiveTab('planner');
  }, []);

  // ── Mobile layout ──
  if (isMobile) {
    const totalSeconds = medleySongs.reduce((s, song) => s + song.snippet_duration, 0);
    const totalMin = Math.floor(totalSeconds / 60);
    const totalSec = totalSeconds % 60;

    return (
      <div style={mStyles.app}>
        {/* Mobile header */}
        <div style={mStyles.header}>
          <h1 style={mStyles.logo}>100 Years' Medley</h1>
          <div style={mStyles.headerStats}>
            <span style={mStyles.headerBadge}>{medleySongs.length} in medley</span>
            {medleySongs.length > 0 && (
              <span style={mStyles.headerBadge}>{totalMin}:{totalSec.toString().padStart(2, '0')}</span>
            )}
          </div>
        </div>

        {/* Mobile content */}
        <div style={mStyles.content}>
          {mobilePanel === 'browse' && (
            <SongBrowser
              songs={allSongs}
              onAddToMedley={handleAddToMedley}
              onRemoveFromMedley={handleRemoveFromMedley}
              onBulkAdd={handleBulkAdd}
              medleySongIds={medleySongIds}
              starredIds={starredIds}
              deletedIds={deletedIds}
              onPreferenceChange={handlePreferenceChange}
              showPreferences
            />
          )}
          {mobilePanel === 'planner' && (
            <MedleyPlanner
              songs={medleySongs}
              catalog={allSongs}
              onRemoveSong={handleRemoveSong}
              onUpdateSong={handleUpdateSong}
              onReorderSong={handleReorderSong}
              onReplaceSongs={handleReplaceSongs}
            />
          )}
          {mobilePanel === 'blocks' && (
            <BlockGenerator
              catalog={allSongs}
              starredIds={starredIds}
              deletedIds={deletedIds}
              onAcceptArrangement={handleAcceptBlockArrangement}
            />
          )}
          {mobilePanel === 'arrangement' && (
            <ArrangementView
              songs={medleySongs}
              onUpdateSong={handleUpdateSong}
            />
          )}
          {mobilePanel === 'eggs' && (
            <EasterEggTracker
              eggs={easterEggs}
              onAddEgg={handleAddEgg}
              onRemoveEgg={handleRemoveEgg}
              onUpdateEgg={handleUpdateEgg}
            />
          )}
          {mobilePanel === 'export' && (
            <ExportPanel songs={medleySongs} eggs={easterEggs} />
          )}
        </div>

        {/* Bottom tab bar */}
        <div style={mStyles.tabBar}>
          {([
            ['browse', 'Browse', allSongs.length.toString()],
            ['blocks', 'Blocks', ''],
            ['planner', 'Medley', medleySongs.length.toString()],
            ['arrangement', 'Arrange', ''],
            ['eggs', 'Eggs', easterEggs.length.toString()],
            ['export', 'Export', ''],
          ] as [MobilePanel, string, string][]).map(([panel, label, badge]) => (
            <button
              key={panel}
              onClick={() => setMobilePanel(panel)}
              style={mobilePanel === panel ? mStyles.tabActive : mStyles.tabBtn}
            >
              <span style={mStyles.tabLabel}>{label}</span>
              {badge && (
                <span style={mStyles.tabBadge}>{badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Desktop layout ──
  return (
    <div style={styles.app}>
      <div style={styles.headerBar}>
        <div style={styles.headerLeft}>
          <h1 style={styles.logo}>The Hundred Years' Medley</h1>
          <span style={styles.subtitle}>Marvin's Arranger</span>
        </div>
        <div style={styles.headerTabs}>
          <button
            style={activeTab === 'planner' ? styles.activeTab : styles.tab}
            onClick={() => setActiveTab('planner')}
          >
            Planner
          </button>
          <button
            style={activeTab === 'blocks' ? styles.activeTab : styles.tab}
            onClick={() => setActiveTab('blocks')}
          >
            Blocks
          </button>
          <button
            style={activeTab === 'arrangement' ? styles.activeTab : styles.tab}
            onClick={() => setActiveTab('arrangement')}
          >
            Arrangement
          </button>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.songCount}>{allSongs.length} songs in database</span>
        </div>
      </div>

      <div style={styles.main}>
        <div style={styles.leftPanel}>
          <SongBrowser
            songs={allSongs}
            onAddToMedley={handleAddToMedley}
            onBulkAdd={handleBulkAdd}
            medleySongIds={medleySongIds}
            starredIds={starredIds}
            deletedIds={deletedIds}
            onPreferenceChange={handlePreferenceChange}
            showPreferences
          />
        </div>

        <div style={styles.centerPanel}>
          {activeTab === 'planner' ? (
            <MedleyPlanner
              songs={medleySongs}
              catalog={allSongs}
              onRemoveSong={handleRemoveSong}
              onUpdateSong={handleUpdateSong}
              onReorderSong={handleReorderSong}
              onReplaceSongs={handleReplaceSongs}
            />
          ) : activeTab === 'blocks' ? (
            <BlockGenerator
              catalog={allSongs}
              starredIds={starredIds}
              deletedIds={deletedIds}
              onAcceptArrangement={handleAcceptBlockArrangement}
            />
          ) : (
            <ArrangementView
              songs={medleySongs}
              onUpdateSong={handleUpdateSong}
            />
          )}
        </div>

        <div style={styles.rightPanel}>
          <div style={styles.rightTabs}>
            <button
              style={rightTab === 'eggs' ? styles.activeRightTab : styles.rightTabBtn}
              onClick={() => setRightTab('eggs')}
            >
              Easter Eggs
            </button>
            <button
              style={rightTab === 'export' ? styles.activeRightTab : styles.rightTabBtn}
              onClick={() => setRightTab('export')}
            >
              Export
            </button>
          </div>
          <div style={styles.rightContent}>
            {rightTab === 'eggs' ? (
              <EasterEggTracker
                eggs={easterEggs}
                onAddEgg={handleAddEgg}
                onRemoveEgg={handleRemoveEgg}
                onUpdateEgg={handleUpdateEgg}
              />
            ) : (
              <ExportPanel songs={medleySongs} eggs={easterEggs} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Mobile styles ──
const mStyles: Record<string, React.CSSProperties> = {
  app: {
    height: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 12px',
    height: 40,
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  logo: {
    fontSize: 13,
    fontWeight: 800,
    background: 'linear-gradient(90deg, #ff6b6b, #ffa94d, #ffd43b, #69db7c, #3bc9db, #748ffc, #da77f2)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    whiteSpace: 'nowrap',
  },
  headerStats: {
    display: 'flex',
    gap: 6,
  },
  headerBadge: {
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 8,
    background: 'var(--bg-tertiary)',
    color: 'var(--text-secondary)',
    fontWeight: 600,
  },
  content: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  tabBar: {
    display: 'flex',
    background: 'var(--bg-secondary)',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
    paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)',
  },
  tabBtn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 1,
    padding: '8px 4px 6px',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
  },
  tabActive: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 1,
    padding: '8px 4px 6px',
    background: 'transparent',
    border: 'none',
    borderTop: '2px solid var(--accent)',
    color: 'var(--accent)',
    cursor: 'pointer',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: 700,
  },
  tabBadge: {
    fontSize: 9,
    color: 'var(--text-muted)',
  },
};

// ── Desktop styles ──
const styles: Record<string, React.CSSProperties> = {
  app: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  headerBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    height: 44,
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
  },
  logo: {
    fontSize: 15,
    fontWeight: 800,
    background: 'linear-gradient(90deg, #ff6b6b, #ffa94d, #ffd43b, #69db7c, #3bc9db, #748ffc, #da77f2)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  headerTabs: {
    display: 'flex',
    gap: 4,
  },
  tab: {
    padding: '6px 16px',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  activeTab: {
    padding: '6px 16px',
    background: 'var(--bg-tertiary)',
    border: 'none',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 4,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  songCount: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  main: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  leftPanel: {
    width: 520,
    flexShrink: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  centerPanel: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    borderLeft: '1px solid var(--border)',
    borderRight: '1px solid var(--border)',
  },
  rightPanel: {
    width: 300,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  rightTabs: {
    display: 'flex',
    borderBottom: '1px solid var(--border)',
  },
  rightTabBtn: {
    flex: 1,
    padding: '8px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
  },
  activeRightTab: {
    flex: 1,
    padding: '8px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid var(--accent)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
  },
  rightContent: {
    flex: 1,
    overflow: 'auto',
  },
};

export default App;
