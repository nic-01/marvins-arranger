import type { MedleySong, TransitionType } from '../types';
import { getBpmCompatibility, areKeysCompatible, getCamelotCode, getCamelotColor } from '../camelot';

interface ArrangementViewProps {
  songs: MedleySong[];
  onUpdateSong: (medleyId: string, updates: Partial<MedleySong>) => void;
}

const TRANSITION_LABELS: Record<TransitionType, string> = {
  hard_cut: 'HARD CUT',
  tempo_ramp: 'TEMPO ▲',
  key_ramp: 'KEY ▲',
  drum_fill: 'DRUMS',
  bass_bridge: 'BASS',
  vamp_fade: 'VAMP',
};

function getDecadeLabel(year: number): string {
  if (year < 1950) return 'The Sprint';
  return `${Math.floor(year / 10) * 10}s`;
}

function getDecadeColor(decade: string): string {
  const map: Record<string, string> = {
    'The Sprint': '#ff6b6b',
    '1950s': '#ff8e72',
    '1960s': '#ffa94d',
    '1970s': '#ffd43b',
    '1980s': '#a9e34b',
    '1990s': '#69db7c',
    '2000s': '#3bc9db',
    '2010s': '#748ffc',
    '2020s': '#da77f2',
  };
  return map[decade] || '#888';
}

export default function ArrangementView({ songs }: ArrangementViewProps) {
  if (songs.length === 0) {
    return (
      <div style={styles.empty}>
        Add songs to the medley to see the arrangement view
      </div>
    );
  }

  // Group by decade
  const decades: Record<string, MedleySong[]> = {};
  songs.forEach((s) => {
    const d = getDecadeLabel(s.year);
    if (!decades[d]) decades[d] = [];
    decades[d].push(s);
  });

  const decadeOrder = ['The Sprint', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];

  // BPM range for graph
  const bpms = songs.map((s) => s.bpm);
  const minBpm = Math.min(...bpms) - 10;
  const maxBpm = Math.max(...bpms) + 10;
  const bpmRange = maxBpm - minBpm;

  // Energy stats
  const energyCounts = { High: 0, Medium: 0, Low: 0 };
  songs.forEach((s) => energyCounts[s.energy]++);

  // Crowd singalong count
  const crowdCount = songs.filter((s) => s.crowd_singalong || s.crowd_moment).length;

  // Instrumentation balance
  const hornSongs = songs.filter((s) => s.horn_friendly).length;
  const keysSongs = songs.filter((s) => s.keyboard_driven).length;
  const guitarSongs = songs.filter((s) => s.guitar_driven).length;

  return (
    <div style={styles.container}>
      {/* Stats bar */}
      <div style={styles.statsBar}>
        <div style={styles.statGroup}>
          <span style={styles.statLabel}>Energy Distribution:</span>
          <span style={{ ...styles.statValue, color: '#ef5350' }}>High: {energyCounts.High}</span>
          <span style={{ ...styles.statValue, color: '#ffa726' }}>Med: {energyCounts.Medium}</span>
          <span style={{ ...styles.statValue, color: '#66bb6a' }}>Low: {energyCounts.Low}</span>
        </div>
        <div style={styles.statGroup}>
          <span style={styles.statLabel}>Crowd Moments:</span>
          <span style={styles.statValue}>{crowdCount}</span>
        </div>
        <div style={styles.statGroup}>
          <span style={styles.statLabel}>Instrumentation:</span>
          <span style={styles.statValue}>Horn: {hornSongs}</span>
          <span style={styles.statValue}>Keys: {keysSongs}</span>
          <span style={styles.statValue}>Guitar: {guitarSongs}</span>
        </div>
      </div>

      {/* BPM Graph */}
      <div style={styles.bpmGraph}>
        <div style={styles.bpmLabel}>BPM Flow</div>
        <svg width="100%" height={80} style={{ display: 'block' }}>
          {songs.map((song, i) => {
            const x = ((i + 0.5) / songs.length) * 100;
            const y = 75 - ((song.bpm - minBpm) / bpmRange) * 65;
            const nextSong = songs[i + 1];
            const bpmCompat = nextSong ? getBpmCompatibility(song.bpm, nextSong.bpm) : 'ok';

            return (
              <g key={song.medleyId}>
                {/* Line to next */}
                {nextSong && (
                  <line
                    x1={`${x}%`}
                    y1={y}
                    x2={`${((i + 1.5) / songs.length) * 100}%`}
                    y2={75 - ((nextSong.bpm - minBpm) / bpmRange) * 65}
                    stroke={bpmCompat === 'red' ? '#ef5350' : bpmCompat === 'amber' ? '#ffa726' : '#555'}
                    strokeWidth={bpmCompat === 'ok' ? 1 : 2}
                  />
                )}
                {/* Point */}
                <circle
                  cx={`${x}%`}
                  cy={y}
                  r={3}
                  fill={getDecadeColor(getDecadeLabel(song.year))}
                />
                {/* BPM label for every 3rd song */}
                {i % 3 === 0 && (
                  <text
                    x={`${x}%`}
                    y={y - 6}
                    textAnchor="middle"
                    fill="var(--text-muted)"
                    fontSize={8}
                  >
                    {song.bpm}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <div style={styles.bpmScale}>
          <span>{maxBpm}</span>
          <span>{minBpm}</span>
        </div>
      </div>

      {/* Timeline */}
      <div style={styles.timeline}>
        {decadeOrder.map((decadeLabel) => {
          const decadeSongs = decades[decadeLabel];
          if (!decadeSongs || decadeSongs.length === 0) return null;

          const decadeSeconds = decadeSongs.reduce((s, song) => s + song.snippet_duration, 0);
          const avgBpm = Math.round(decadeSongs.reduce((s, song) => s + song.bpm, 0) / decadeSongs.length);
          const color = getDecadeColor(decadeLabel);

          return (
            <div key={decadeLabel} style={styles.decadeBlock}>
              <div style={{ ...styles.decadeHeader, background: color, color: '#000' }}>
                <span style={{ fontWeight: 700 }}>{decadeLabel}</span>
                <span style={{ fontSize: 10 }}>
                  {Math.floor(decadeSeconds / 60)}:{(decadeSeconds % 60).toString().padStart(2, '0')} | {avgBpm} BPM avg
                </span>
              </div>

              <div style={styles.songBlocks}>
                {decadeSongs.map((song, idx) => {
                  const globalIdx = songs.indexOf(song);
                  const prevSong = globalIdx > 0 ? songs[globalIdx - 1] : null;
                  const bpmCompat = prevSong ? getBpmCompatibility(prevSong.bpm, song.bpm) : 'ok';
                  const keyCompat = prevSong ? areKeysCompatible(prevSong.key, song.key) : true;

                  return (
                    <div key={song.medleyId} style={styles.songBlockWrapper}>
                      {/* Transition connector */}
                      {idx > 0 && (
                        <div style={{
                          ...styles.connector,
                          background: bpmCompat === 'red' ? '#ef5350' : bpmCompat === 'amber' ? '#ffa726' : '#555',
                        }}>
                          <span style={styles.connectorLabel}>
                            {TRANSITION_LABELS[song.transition_in || 'hard_cut']}
                          </span>
                        </div>
                      )}

                      <div style={{
                        ...styles.songBlock,
                        borderTopColor: getCamelotColor(song.key),
                        minWidth: Math.max(80, (song.snippet_duration / 45) * 100),
                      }}>
                        <div style={styles.blockTitle}>{song.title}</div>
                        <div style={styles.blockArtist}>{song.artist}</div>
                        <div style={styles.blockMeta}>
                          <span>{song.bpm}bpm</span>
                          <span>{song.key}</span>
                        </div>
                        <div style={styles.blockMeta}>
                          <span>{song.bar_count || 16} bars</span>
                          <span>{song.snippet_duration}s</span>
                        </div>
                        {song.section && (
                          <div style={styles.blockSection}>{song.section}</div>
                        )}
                        <div style={styles.blockFlags}>
                          {song.crowd_moment && <span title="Crowd moment">SING</span>}
                          {song.easter_egg && <span title="Easter egg" style={{ color: 'var(--purple)' }}>EGG</span>}
                          {song.horn_friendly && <span title="Horn feature">HRN</span>}
                          {song.keyboard_driven && <span title="Keys feature">KEY</span>}
                          {song.guitar_driven && <span title="Guitar feature">GTR</span>}
                        </div>

                        {/* Warnings */}
                        {bpmCompat !== 'ok' && (
                          <div style={{
                            ...styles.blockWarning,
                            background: bpmCompat === 'red' ? 'var(--red)' : 'var(--amber)',
                          }}>
                            BPM {bpmCompat === 'red' ? '!!' : '!'}
                          </div>
                        )}
                        {!keyCompat && (
                          <div style={{ ...styles.blockWarning, background: 'var(--amber)' }}>
                            KEY !
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Key path below */}
              <div style={styles.keyPath}>
                {decadeSongs.map((song) => (
                  <div key={song.medleyId} style={styles.keyDot}>
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: getCamelotColor(song.key),
                    }} />
                    <span style={styles.keyLabel}>{getCamelotCode(song.key)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'auto',
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: 'var(--text-muted)',
    fontSize: 14,
  },
  statsBar: {
    display: 'flex',
    gap: 24,
    padding: '8px 16px',
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border)',
    flexWrap: 'wrap',
  },
  statGroup: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    color: 'var(--text-muted)',
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 11,
    fontWeight: 600,
  },
  bpmGraph: {
    position: 'relative',
    padding: '8px 16px',
    background: 'var(--bg-tertiary)',
    borderBottom: '1px solid var(--border)',
  },
  bpmLabel: {
    position: 'absolute',
    top: 4,
    left: 8,
    fontSize: 9,
    color: 'var(--text-muted)',
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  bpmScale: {
    position: 'absolute',
    right: 4,
    top: 8,
    bottom: 8,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    fontSize: 8,
    color: 'var(--text-muted)',
  },
  timeline: {
    flex: 1,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  decadeBlock: {
    borderRadius: 4,
    overflow: 'hidden',
  },
  decadeHeader: {
    padding: '4px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 12,
  },
  songBlocks: {
    display: 'flex',
    padding: 8,
    gap: 0,
    overflowX: 'auto',
    background: 'var(--bg-secondary)',
  },
  songBlockWrapper: {
    display: 'flex',
    alignItems: 'stretch',
  },
  connector: {
    width: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  connectorLabel: {
    fontSize: 7,
    fontWeight: 700,
    color: '#000',
    writingMode: 'vertical-rl',
    textOrientation: 'mixed',
    whiteSpace: 'nowrap',
  },
  songBlock: {
    background: 'var(--bg-tertiary)',
    borderRadius: 4,
    borderTop: '3px solid',
    padding: '6px 8px',
    position: 'relative',
  },
  blockTitle: {
    fontWeight: 700,
    fontSize: 11,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 120,
  },
  blockArtist: {
    fontSize: 10,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 120,
  },
  blockMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 9,
    color: 'var(--text-muted)',
    marginTop: 2,
  },
  blockSection: {
    fontSize: 8,
    color: 'var(--accent)',
    fontWeight: 600,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  blockFlags: {
    display: 'flex',
    gap: 4,
    fontSize: 8,
    fontWeight: 700,
    color: 'var(--text-muted)',
    marginTop: 3,
  },
  blockWarning: {
    position: 'absolute',
    top: -1,
    right: -1,
    fontSize: 8,
    fontWeight: 700,
    color: '#000',
    padding: '0 4px',
    borderRadius: '0 4px 0 4px',
  },
  keyPath: {
    display: 'flex',
    padding: '4px 8px',
    gap: 8,
    background: 'var(--bg-secondary)',
    borderTop: '1px solid var(--border)',
    justifyContent: 'space-around',
  },
  keyDot: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  keyLabel: {
    fontSize: 8,
    color: 'var(--text-muted)',
  },
};
