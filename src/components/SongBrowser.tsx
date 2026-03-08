import { useState, useMemo } from 'react';
import type { Song, Filters, SongPreference } from '../types';
import { getCamelotCode } from '../camelot';

interface SongBrowserProps {
  songs: Song[];
  onAddToMedley: (song: Song) => void;
  onRemoveFromMedley?: (songId: string) => void;
  onBulkAdd?: (songs: Song[]) => void;
  medleySongIds: Set<string>;
  starredIds?: Set<string>;
  deletedIds?: Set<string>;
  onPreferenceChange?: (songId: string, pref: SongPreference) => void;
  showPreferences?: boolean;
}

const DECADES = ['All', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
const ENERGIES = ['All', 'Low', 'Medium', 'High'];
const GENDERS = ['All', 'Male', 'Female', 'Mixed', 'Instrumental'];

function getDecadeColor(decade: string): string {
  const map: Record<string, string> = {
    '1920s': 'var(--decade-sprint)',
    '1930s': 'var(--decade-sprint)',
    '1940s': 'var(--decade-sprint)',
    '1950s': 'var(--decade-50s)',
    '1960s': 'var(--decade-60s)',
    '1970s': 'var(--decade-70s)',
    '1980s': 'var(--decade-80s)',
    '1990s': 'var(--decade-90s)',
    '2000s': 'var(--decade-00s)',
    '2010s': 'var(--decade-10s)',
    '2020s': 'var(--decade-20s)',
  };
  return map[decade] || 'var(--text-muted)';
}

type SortField = 'year' | 'title' | 'artist' | 'bpm' | 'key' | 'energy';
type SortDir = 'asc' | 'desc';

export default function SongBrowser({ songs, onAddToMedley, onRemoveFromMedley, onBulkAdd, medleySongIds, starredIds, deletedIds, onPreferenceChange, showPreferences }: SongBrowserProps) {
  const [filters, setFilters] = useState<Filters>({
    decade: 'All',
    bpmMin: 0,
    bpmMax: 300,
    key: 'All',
    genre: 'All',
    vocal_gender: 'All',
    energy: 'All',
    horn_friendly: 'All',
    keyboard_driven: 'All',
    search: '',
  });
  const [sortField, setSortField] = useState<SortField>('year');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const genres = useMemo(() => {
    const g = new Set(songs.map((s) => s.genre));
    return ['All', ...Array.from(g).sort()];
  }, [songs]);

  const keys = useMemo(() => {
    const k = new Set(songs.map((s) => s.key));
    return ['All', ...Array.from(k).sort()];
  }, [songs]);

  const [showDeleted, setShowDeleted] = useState(false);

  const filtered = useMemo(() => {
    let result = songs;
    // Hide deleted songs by default when preferences are enabled
    if (showPreferences && deletedIds && !showDeleted) {
      result = result.filter((s) => !deletedIds.has(s.id));
    }
    if (filters.decade !== 'All') {
      result = result.filter((s) => s.decade === filters.decade);
    }
    if (filters.bpmMin > 0) result = result.filter((s) => s.bpm >= filters.bpmMin);
    if (filters.bpmMax < 300) result = result.filter((s) => s.bpm <= filters.bpmMax);
    if (filters.key !== 'All') result = result.filter((s) => s.key === filters.key);
    if (filters.genre !== 'All') result = result.filter((s) => s.genre === filters.genre);
    if (filters.vocal_gender !== 'All') result = result.filter((s) => s.vocal_gender === filters.vocal_gender);
    if (filters.energy !== 'All') result = result.filter((s) => s.energy === filters.energy);
    if (filters.horn_friendly !== 'All') result = result.filter((s) => s.horn_friendly === (filters.horn_friendly === 'Yes'));
    if (filters.keyboard_driven !== 'All') result = result.filter((s) => s.keyboard_driven === (filters.keyboard_driven === 'Yes'));
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.artist.toLowerCase().includes(q)
      );
    }
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'year') cmp = a.year - b.year;
      else if (sortField === 'bpm') cmp = a.bpm - b.bpm;
      else if (sortField === 'title') cmp = a.title.localeCompare(b.title);
      else if (sortField === 'artist') cmp = a.artist.localeCompare(b.artist);
      else if (sortField === 'key') cmp = a.key.localeCompare(b.key);
      else if (sortField === 'energy') {
        const order = { Low: 0, Medium: 1, High: 2 };
        cmp = order[a.energy] - order[b.energy];
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [songs, filters, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Song Browser</h2>
        <span style={styles.count}>{filtered.length} / {songs.length} songs</span>
      </div>

      {onBulkAdd && (() => {
        const notYetAdded = filtered.filter((s) => !medleySongIds.has(s.id));
        return notYetAdded.length > 0 ? (
          <div style={styles.bulkAddBar}>
            <button
              onClick={() => onBulkAdd(notYetAdded)}
              style={styles.bulkAddBtn}
            >
              + Add {notYetAdded.length} Song{notYetAdded.length !== 1 ? 's' : ''} to Medley
            </button>
          </div>
        ) : null;
      })()}

      <div style={styles.filters}>
        <input
          type="text"
          placeholder="Search title or artist..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          style={styles.searchInput}
        />
        <div style={styles.filterRow}>
          <select value={filters.decade} onChange={(e) => setFilters({ ...filters, decade: e.target.value })}>
            {DECADES.map((d) => <option key={d} value={d}>{d === 'All' ? 'All Decades' : d}</option>)}
          </select>
          <select value={filters.genre} onChange={(e) => setFilters({ ...filters, genre: e.target.value })}>
            {genres.map((g) => <option key={g} value={g}>{g === 'All' ? 'All Genres' : g}</option>)}
          </select>
          <select value={filters.energy} onChange={(e) => setFilters({ ...filters, energy: e.target.value })}>
            {ENERGIES.map((e) => <option key={e} value={e}>{e === 'All' ? 'All Energy' : e}</option>)}
          </select>
          <select value={filters.vocal_gender} onChange={(e) => setFilters({ ...filters, vocal_gender: e.target.value })}>
            {GENDERS.map((g) => <option key={g} value={g}>{g === 'All' ? 'All Vocals' : g}</option>)}
          </select>
        </div>
        <div style={styles.filterRow}>
          <select value={filters.key} onChange={(e) => setFilters({ ...filters, key: e.target.value })}>
            {keys.map((k) => <option key={k} value={k}>{k === 'All' ? 'All Keys' : k}</option>)}
          </select>
          <select value={filters.horn_friendly} onChange={(e) => setFilters({ ...filters, horn_friendly: e.target.value })}>
            <option value="All">Horn Friendly?</option>
            <option value="Yes">Horn Friendly</option>
            <option value="No">Not Horn</option>
          </select>
          <select value={filters.keyboard_driven} onChange={(e) => setFilters({ ...filters, keyboard_driven: e.target.value })}>
            <option value="All">Keys Driven?</option>
            <option value="Yes">Keys Driven</option>
            <option value="No">Not Keys</option>
          </select>
          <div style={styles.bpmRange}>
            <span>BPM:</span>
            <input
              type="number"
              value={filters.bpmMin || ''}
              placeholder="Min"
              onChange={(e) => setFilters({ ...filters, bpmMin: Number(e.target.value) || 0 })}
              style={{ width: 55 }}
            />
            <span>–</span>
            <input
              type="number"
              value={filters.bpmMax < 300 ? filters.bpmMax : ''}
              placeholder="Max"
              onChange={(e) => setFilters({ ...filters, bpmMax: Number(e.target.value) || 300 })}
              style={{ width: 55 }}
            />
          </div>
        </div>
      </div>

      {showPreferences && deletedIds && deletedIds.size > 0 && (
        <div style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
            Show {deletedIds.size} deleted
          </label>
        </div>
      )}

      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr>
              {showPreferences && <th style={styles.th}>Pref</th>}
              <th style={styles.th}></th>
              <th style={styles.th} onClick={() => handleSort('year')}>Year{sortIcon('year')}</th>
              <th style={{ ...styles.th, textAlign: 'left' as const }} onClick={() => handleSort('title')}>Title{sortIcon('title')}</th>
              <th style={{ ...styles.th, textAlign: 'left' as const }} onClick={() => handleSort('artist')}>Artist{sortIcon('artist')}</th>
              <th style={styles.th} onClick={() => handleSort('bpm')}>BPM{sortIcon('bpm')}</th>
              <th style={styles.th} onClick={() => handleSort('key')}>Key{sortIcon('key')}</th>
              <th style={styles.th} onClick={() => handleSort('energy')}>Energy{sortIcon('energy')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((song) => {
              const inMedley = medleySongIds.has(song.id);
              const isStarred = starredIds?.has(song.id) || false;
              const isDeleted = deletedIds?.has(song.id) || false;
              return (
                <tr
                  key={song.id}
                  style={{
                    ...styles.tr,
                    ...(isDeleted ? { opacity: 0.4 } : {}),
                    ...(isStarred ? { background: 'rgba(255, 215, 0, 0.08)' } : {}),
                  }}
                >
                  {showPreferences && onPreferenceChange && (
                    <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => onPreferenceChange(song.id, isStarred ? 'open' : 'starred')}
                        style={{
                          ...styles.prefBtn,
                          color: isStarred ? '#ffd700' : 'var(--text-muted)',
                        }}
                        title={isStarred ? 'Unstar' : 'Star (must include)'}
                      >
                        {isStarred ? '\u2605' : '\u2606'}
                      </button>
                      <button
                        onClick={() => onPreferenceChange(song.id, isDeleted ? 'open' : 'deleted')}
                        style={{
                          ...styles.prefBtn,
                          color: isDeleted ? 'var(--red)' : 'var(--text-muted)',
                        }}
                        title={isDeleted ? 'Restore' : 'Delete (exclude)'}
                      >
                        {isDeleted ? '\u21A9' : '\u2715'}
                      </button>
                    </td>
                  )}
                  <td style={styles.td}>
                    <button
                      onClick={() => inMedley ? onRemoveFromMedley?.(song.id) : onAddToMedley(song)}
                      style={{
                        ...styles.addBtn,
                        ...(inMedley ? styles.removeBtn : {}),
                      }}
                      title={inMedley ? 'Remove from medley' : 'Add to medley'}
                    >
                      {inMedley ? '\u00d7' : '+'}
                    </button>
                  </td>
                  <td style={styles.td}>
                    <span style={{ ...styles.yearBadge, borderColor: getDecadeColor(song.decade) }}>
                      {song.year}
                    </span>
                  </td>
                  <td style={{ ...styles.td, textAlign: 'left', fontWeight: 500 }}>{song.title}</td>
                  <td style={{ ...styles.td, textAlign: 'left', color: 'var(--text-secondary)' }}>{song.artist}</td>
                  <td style={styles.td}>{song.bpm}</td>
                  <td style={styles.td}>
                    <span style={styles.keyBadge} title={`Camelot: ${getCamelotCode(song.key)}`}>
                      {song.key}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <span style={{
                      ...styles.energyBadge,
                      background: song.energy === 'High' ? 'var(--red)' : song.energy === 'Medium' ? 'var(--amber)' : 'var(--green)',
                    }}>
                      {song.energy}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    borderRight: '1px solid var(--border)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px 8px',
  },
  bulkAddBar: {
    padding: '0 16px 8px',
  },
  bulkAddBtn: {
    width: '100%',
    fontSize: 13,
    fontWeight: 700,
    padding: '8px 12px',
    borderRadius: 6,
    border: 'none',
    background: 'var(--green)',
    color: '#000',
    cursor: 'pointer',
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
  },
  count: {
    color: 'var(--text-secondary)',
    fontSize: 12,
  },
  filters: {
    padding: '0 16px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  searchInput: {
    width: '100%',
    padding: '6px 10px',
  },
  filterRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap' as const,
  },
  bpmRange: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    color: 'var(--text-secondary)',
  },
  tableContainer: {
    flex: 1,
    overflow: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    position: 'sticky' as const,
    top: 0,
    background: 'var(--bg-secondary)',
    padding: '6px 8px',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border)',
    cursor: 'pointer',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
    textAlign: 'center' as const,
  },
  tr: {
    borderBottom: '1px solid var(--bg-tertiary)',
    transition: 'background 0.1s',
  },
  td: {
    padding: '5px 8px',
    textAlign: 'center' as const,
    whiteSpace: 'nowrap' as const,
  },
  yearBadge: {
    borderLeft: '3px solid',
    paddingLeft: 6,
    fontSize: 12,
  },
  keyBadge: {
    fontSize: 11,
    padding: '1px 4px',
    borderRadius: 3,
    background: 'var(--bg-tertiary)',
  },
  energyBadge: {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 8,
    color: '#000',
    fontWeight: 600,
  },
  addBtn: {
    padding: '2px 8px',
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1,
    borderRadius: '50%',
    minWidth: 24,
    minHeight: 24,
  },
  removeBtn: {
    background: 'var(--red)',
    color: '#fff',
    borderColor: 'var(--red)',
  },
  prefBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    padding: '0 2px',
    lineHeight: 1,
  },
};
