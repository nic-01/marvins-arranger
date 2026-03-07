import { useState, useCallback, useMemo } from 'react';
import type { Song, MedleySong, EasterEgg } from './types';
import SongBrowser from './components/SongBrowser';
import MedleyPlanner from './components/MedleyPlanner';
import EasterEggTracker, { DEFAULT_EGGS } from './components/EasterEggTracker';
import ArrangementView from './components/ArrangementView';
import ExportPanel from './components/ExportPanel';
import { allSongs } from './data';

type Tab = 'planner' | 'arrangement';
type RightTab = 'eggs' | 'export';

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function App() {
  const [medleySongs, setMedleySongs] = useState<MedleySong[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('planner');
  const [rightTab, setRightTab] = useState<RightTab>('eggs');

  // Initialize Easter eggs from defaults
  const [easterEggs, setEasterEggs] = useState<EasterEgg[]>(() =>
    DEFAULT_EGGS.map((egg) => ({ ...egg, id: generateId() }))
  );

  const medleySongIds = useMemo(
    () => new Set(medleySongs.map((s) => s.id)),
    [medleySongs]
  );

  const handleAddToMedley = useCallback((song: Song) => {
    const medleySong: MedleySong = {
      ...song,
      medleyId: generateId(),
      snippet_duration: song.crowd_singalong ? 55 : 45,
      section: 'chorus',
      bar_count: 16,
      transition_in: 'hard_cut',
      featured_instruments: [],
      crowd_moment: song.crowd_singalong,
      easter_egg: false,
    };

    setMedleySongs((prev) => {
      const updated = [...prev, medleySong];
      // Enforce chronological order
      updated.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
      return updated;
    });
  }, []);

  const handleRemoveSong = useCallback((medleyId: string) => {
    setMedleySongs((prev) => prev.filter((s) => s.medleyId !== medleyId));
  }, []);

  const handleUpdateSong = useCallback((medleyId: string, updates: Partial<MedleySong>) => {
    setMedleySongs((prev) =>
      prev.map((s) => (s.medleyId === medleyId ? { ...s, ...updates } : s))
    );
  }, []);

  const handleReorderSong = useCallback((medleyId: string, direction: 'up' | 'down') => {
    setMedleySongs((prev) => {
      const idx = prev.findIndex((s) => s.medleyId === medleyId);
      if (idx === -1) return prev;

      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;

      // Swap but maintain chronological awareness
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

  return (
    <div style={styles.app}>
      {/* Header */}
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

      {/* Main content */}
      <div style={styles.main}>
        {/* Left panel - Song Browser */}
        <div style={styles.leftPanel}>
          <SongBrowser
            songs={allSongs}
            onAddToMedley={handleAddToMedley}
            medleySongIds={medleySongIds}
          />
        </div>

        {/* Center panel - Planner or Arrangement */}
        <div style={styles.centerPanel}>
          {activeTab === 'planner' ? (
            <MedleyPlanner
              songs={medleySongs}
              onRemoveSong={handleRemoveSong}
              onUpdateSong={handleUpdateSong}
              onReorderSong={handleReorderSong}
            />
          ) : (
            <ArrangementView
              songs={medleySongs}
              onUpdateSong={handleUpdateSong}
            />
          )}
        </div>

        {/* Right panel - Easter Eggs & Export */}
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
