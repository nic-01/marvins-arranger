'use client';

import { useState } from 'react';
import type { EasterEgg } from '@/lib/types';

interface EasterEggTrackerProps {
  eggs: EasterEgg[];
  onAddEgg: (egg: Omit<EasterEgg, 'id'>) => void;
  onRemoveEgg: (id: string) => void;
  onUpdateEgg: (id: string, updates: Partial<EasterEgg>) => void;
}

const DECADES = ['1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
const DIFFICULTIES: EasterEgg['difficulty'][] = ['Easy', 'Medium', 'Hard', 'Very Hard'];

function getDecadeIndex(decade: string): number {
  return DECADES.indexOf(decade);
}

function isValidGap(source: string, host: string): boolean {
  const gap = Math.abs(getDecadeIndex(source) - getDecadeIndex(host));
  return gap >= 2;
}

const DIFFICULTY_COLORS: Record<EasterEgg['difficulty'], string> = {
  'Easy': 'var(--green)',
  'Medium': 'var(--amber)',
  'Hard': '#ff7043',
  'Very Hard': 'var(--red)',
};

// Default Easter eggs from the brief
const DEFAULT_EGGS: Omit<EasterEgg, 'id'>[] = [
  { source_song: 'Johnny B. Goode (Chuck Berry)', source_decade: '1950s', host_decade: '2000s', difficulty: 'Hard', notes: 'White Stripes-style garage rock tone next to Seven Nation Army' },
  { source_song: 'Yesterday (The Beatles)', source_decade: '1960s', host_decade: '1930s', difficulty: 'Very Hard', notes: 'Piano, brushed drums, muted trumpet — essentially a 1930s music hall song' },
  { source_song: 'Dancing Queen (ABBA)', source_decade: '1970s', host_decade: '1990s', difficulty: 'Medium', notes: 'Piano next to Bitter Sweet Symphony — ABBA harmonic language close to Britpop' },
  { source_song: 'Every Breath You Take (The Police)', source_decade: '1980s', host_decade: '2010s', difficulty: 'Hard', notes: 'Minimalist guitar next to Shallow — sounds like a lost The xx track' },
  { source_song: 'Come As You Are (Nirvana)', source_decade: '1990s', host_decade: '1950s', difficulty: 'Very Hard', notes: 'Full stop. Tempo halves. Four singers in close doo-wop harmony' },
  { source_song: 'Rehab (Amy Winehouse)', source_decade: '2000s', host_decade: '1960s', difficulty: 'Easy', notes: 'Flows directly out of Respect — same key. Soul DNA hiding in plain sight' },
  { source_song: 'Get Lucky (Daft Punk)', source_decade: '2010s', host_decade: '1970s', difficulty: 'Medium', notes: 'Keyboard and bass in Chic-style groove. Takes ~16 bars for the penny to drop' },
  { source_song: 'As It Was (Harry Styles)', source_decade: '2020s', host_decade: '1980s', difficulty: 'Very Hard', notes: 'After Take On Me — same falsetto register, same bright synth arpeggio world' },
];

export { DEFAULT_EGGS };

export default function EasterEggTracker({ eggs, onAddEgg, onRemoveEgg, onUpdateEgg }: EasterEggTrackerProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [newEgg, setNewEgg] = useState<Omit<EasterEgg, 'id'>>({
    source_song: '',
    source_decade: '1950s',
    host_decade: '2000s',
    difficulty: 'Medium',
    notes: '',
  });

  const handleAdd = () => {
    if (!newEgg.source_song) return;
    onAddEgg(newEgg);
    setNewEgg({ source_song: '', source_decade: '1950s', host_decade: '2000s', difficulty: 'Medium', notes: '' });
    setShowAdd(false);
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Easter Eggs</h3>
        <span style={styles.count}>{eggs.length} eggs</span>
      </div>

      <div style={styles.eggList}>
        {eggs.map((egg) => {
          const valid = isValidGap(egg.source_decade, egg.host_decade);
          return (
            <div key={egg.id} style={{ ...styles.eggCard, borderLeftColor: valid ? 'var(--green)' : 'var(--red)' }}>
              <div style={styles.eggHeader}>
                <span style={styles.eggSong}>{egg.source_song}</span>
                <button onClick={() => onRemoveEgg(egg.id)} style={styles.removeBtn}>×</button>
              </div>
              <div style={styles.eggMeta}>
                <span style={styles.eggDecade}>{egg.source_decade} → {egg.host_decade}</span>
                <span style={{ ...styles.difficultyBadge, background: DIFFICULTY_COLORS[egg.difficulty] }}>
                  {egg.difficulty}
                </span>
                {valid ? (
                  <span style={{ ...styles.gapBadge, background: 'var(--green)' }}>
                    {Math.abs(getDecadeIndex(egg.source_decade) - getDecadeIndex(egg.host_decade))} decades apart
                  </span>
                ) : (
                  <span style={{ ...styles.gapBadge, background: 'var(--red)' }}>
                    Too close!
                  </span>
                )}
              </div>
              {egg.notes && <div style={styles.eggNotes}>{egg.notes}</div>}
              <div style={styles.eggEdit}>
                <select
                  value={egg.difficulty}
                  onChange={(e) => onUpdateEgg(egg.id, { difficulty: e.target.value as EasterEgg['difficulty'] })}
                  style={{ fontSize: 10 }}
                >
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select
                  value={egg.source_decade}
                  onChange={(e) => onUpdateEgg(egg.id, { source_decade: e.target.value })}
                  style={{ fontSize: 10 }}
                >
                  {DECADES.map((d) => <option key={d} value={d}>From: {d}</option>)}
                </select>
                <select
                  value={egg.host_decade}
                  onChange={(e) => onUpdateEgg(egg.id, { host_decade: e.target.value })}
                  style={{ fontSize: 10 }}
                >
                  {DECADES.map((d) => <option key={d} value={d}>In: {d}</option>)}
                </select>
              </div>
            </div>
          );
        })}
      </div>

      {showAdd ? (
        <div style={styles.addForm}>
          <input
            type="text"
            placeholder="Source song name..."
            value={newEgg.source_song}
            onChange={(e) => setNewEgg({ ...newEgg, source_song: e.target.value })}
            style={{ width: '100%' }}
          />
          <div style={styles.addRow}>
            <select value={newEgg.source_decade} onChange={(e) => setNewEgg({ ...newEgg, source_decade: e.target.value })}>
              {DECADES.map((d) => <option key={d} value={d}>From: {d}</option>)}
            </select>
            <select value={newEgg.host_decade} onChange={(e) => setNewEgg({ ...newEgg, host_decade: e.target.value })}>
              {DECADES.map((d) => <option key={d} value={d}>In: {d}</option>)}
            </select>
            <select value={newEgg.difficulty} onChange={(e) => setNewEgg({ ...newEgg, difficulty: e.target.value as EasterEgg['difficulty'] })}>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <input
            type="text"
            placeholder="Notes on disguise..."
            value={newEgg.notes}
            onChange={(e) => setNewEgg({ ...newEgg, notes: e.target.value })}
            style={{ width: '100%' }}
          />
          <div style={styles.addRow}>
            <button className="primary" onClick={handleAdd}>Add Egg</button>
            <button onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} style={styles.addButton}>+ Add Easter Egg</button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    padding: 12,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: 700,
  },
  count: {
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  eggList: {
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  eggCard: {
    background: 'var(--bg-secondary)',
    borderRadius: 4,
    borderLeft: '3px solid',
    padding: '6px 10px',
  },
  eggHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eggSong: {
    fontWeight: 600,
    fontSize: 12,
  },
  removeBtn: {
    padding: '0 4px',
    fontSize: 14,
    color: 'var(--red)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  eggMeta: {
    display: 'flex',
    gap: 6,
    marginTop: 4,
    alignItems: 'center',
  },
  eggDecade: {
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  difficultyBadge: {
    fontSize: 9,
    padding: '1px 6px',
    borderRadius: 8,
    color: '#000',
    fontWeight: 700,
  },
  gapBadge: {
    fontSize: 9,
    padding: '1px 6px',
    borderRadius: 8,
    color: '#000',
    fontWeight: 600,
  },
  eggNotes: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    marginTop: 4,
    fontStyle: 'italic',
  },
  eggEdit: {
    display: 'flex',
    gap: 4,
    marginTop: 6,
  },
  addForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '8px 0',
    borderTop: '1px solid var(--border)',
    marginTop: 8,
  },
  addRow: {
    display: 'flex',
    gap: 6,
  },
  addButton: {
    marginTop: 8,
    width: '100%',
  },
};
