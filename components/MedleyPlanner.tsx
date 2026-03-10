'use client';

import { useState } from 'react';
import type { Song, MedleySong, TransitionType } from '@/lib/types';
import { getBpmCompatibility, areKeysCompatible, getCamelotCode, getCamelotColor } from '@/lib/camelot';
import { autoArrange, type ArrangementResult } from '@/lib/arranger';
import { generateMedley, type GenerationProgress } from '@/lib/generator';
import { hasApiKey } from '@/lib/llm';

interface MedleyPlannerProps {
  songs: MedleySong[];
  catalog?: Song[];
  onRemoveSong: (medleyId: string) => void;
  onUpdateSong: (medleyId: string, updates: Partial<MedleySong>) => void;
  onReorderSong: (medleyId: string, direction: 'up' | 'down') => void;
  onReplaceSongs?: (songs: MedleySong[]) => void;
}

const TRANSITIONS: TransitionType[] = ['hard_cut', 'tempo_ramp', 'key_ramp', 'drum_fill', 'bass_bridge', 'vamp_fade'];
const TRANSITION_LABELS: Record<TransitionType, string> = {
  hard_cut: 'HARD CUT',
  tempo_ramp: 'TEMPO RAMP',
  key_ramp: 'KEY RAMP',
  drum_fill: 'DRUM FILL',
  bass_bridge: 'BASS BRIDGE',
  vamp_fade: 'VAMP FADE',
};
const TRANSITION_COLORS: Record<TransitionType, string> = {
  hard_cut: '#ef5350',
  tempo_ramp: '#ffa726',
  key_ramp: '#ab47bc',
  drum_fill: '#42a5f5',
  bass_bridge: '#66bb6a',
  vamp_fade: '#78909c',
};

function getDecadeLabel(year: number): string {
  if (year < 1950) return 'The Sprint (1926–1949)';
  return `${Math.floor(year / 10) * 10}s`;
}

function getDecadeColor(decade: string): string {
  const map: Record<string, string> = {
    'The Sprint (1926–1949)': 'var(--decade-sprint)',
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

export default function MedleyPlanner({ songs, catalog, onRemoveSong, onUpdateSong, onReorderSong, onReplaceSongs }: MedleyPlannerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [arrangeResult, setArrangeResult] = useState<ArrangementResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<GenerationProgress | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [genNarrative, setGenNarrative] = useState<string | null>(null);

  const totalSeconds = songs.reduce((sum, s) => sum + s.snippet_duration, 0);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  const handleAutoArrange = () => {
    if (songs.length === 0) return;
    const result = autoArrange(songs);
    setArrangeResult(result);
    if (onReplaceSongs) {
      onReplaceSongs(result.songs);
    }
    // Clear the result banner after 8 seconds
    setTimeout(() => setArrangeResult(null), 8000);
  };

  const handleGenerate = async () => {
    if (!catalog || !onReplaceSongs) return;
    setGenerating(true);
    setGenError(null);
    setGenNarrative(null);

    // Use currently selected songs as pinned
    const pinnedIds = new Set(songs.map(s => s.id));

    try {
      const result = await generateMedley(catalog, pinnedIds, setGenProgress);
      onReplaceSongs(result.arrangement.songs);
      setArrangeResult(result.arrangement);
      if (result.narrative) setGenNarrative(result.narrative);
      setTimeout(() => setArrangeResult(null), 12000);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
      setGenProgress(null);
    }
  };

  // Group songs by decade
  const decades = songs.reduce<Record<string, MedleySong[]>>((acc, song) => {
    const label = getDecadeLabel(song.year);
    if (!acc[label]) acc[label] = [];
    acc[label].push(song);
    return acc;
  }, {});

  const decadeOrder = [
    'The Sprint (1926–1949)',
    '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'
  ];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Medley Planner</h2>
        <div style={styles.stats}>
          {songs.length >= 2 && onReplaceSongs && (
            <button onClick={handleAutoArrange} style={styles.arrangeBtn}>
              Auto-Arrange
            </button>
          )}
          {songs.length > 0 && onReplaceSongs && (
            <button onClick={() => { if (window.confirm(`Remove all ${songs.length} songs from medley?`)) onReplaceSongs([]); }} style={styles.clearBtn}>
              Clear All
            </button>
          )}
          <span style={styles.statBadge}>{songs.length} songs</span>
          <span style={{ ...styles.statBadge, background: totalSeconds > 53 * 60 ? 'var(--red)' : totalSeconds > 45 * 60 ? 'var(--amber)' : 'var(--green)', color: '#000' }}>
            {totalMinutes}:{remainingSeconds.toString().padStart(2, '0')}
          </span>
        </div>
      </div>

      {/* Generate Medley Panel */}
      {catalog && onReplaceSongs && (
        <div style={styles.genSection}>
          <button
            onClick={handleGenerate}
            style={styles.generateToggle}
            disabled={generating}
          >
            {generating ? 'Generating...' : `Generate Medley from ${catalog.length} songs`}
          </button>
          {!generating && (
            <div style={styles.genHint}>
              {hasApiKey()
                ? 'Claude will evaluate paths, suggest mashups, and write arrangement notes.'
                : 'Set ANTHROPIC_API_KEY in .env to enable LLM-powered generation.'}
            </div>
          )}

          {generating && genProgress && (
            <div style={styles.genProgressPanel}>
              <div style={styles.genProgressBar}>
                <div style={{ ...styles.genProgressFill, width: `${genProgress.percent}%` }} />
              </div>
              <div style={styles.genProgressText}>{genProgress.message}</div>
            </div>
          )}

          {genError && (
            <div style={styles.genError}>{genError}</div>
          )}
        </div>
      )}

      {genNarrative && (
        <div style={styles.narrativeBanner}>
          {genNarrative}
        </div>
      )}

      {arrangeResult && (
        <div style={styles.arrangeBanner}>
          Arranged {arrangeResult.stats.totalSongs} songs ({arrangeResult.stats.totalDuration})
          {' · '}{arrangeResult.stats.mashupCount} mashups
          {' · '}{arrangeResult.stats.crowdMoments} crowd moments
          {' · '}avg key dist {arrangeResult.stats.avgCamelotDistance}
          {' · '}{Object.entries(arrangeResult.stats.transitionBreakdown).map(([t, n]) => `${n} ${t.replace('_', ' ')}`).join(', ')}
        </div>
      )}

      <div style={styles.timeline}>
        {decadeOrder.map((decadeLabel) => {
          const decadeSongs = decades[decadeLabel];
          if (!decadeSongs || decadeSongs.length === 0) return null;

          const decadeSeconds = decadeSongs.reduce((s, song) => s + song.snippet_duration, 0);
          const avgBpm = Math.round(decadeSongs.reduce((s, song) => s + song.bpm, 0) / decadeSongs.length);

          return (
            <div key={decadeLabel} style={styles.decadeSection}>
              <div style={{ ...styles.decadeHeader, borderLeftColor: getDecadeColor(decadeLabel) }}>
                <span style={styles.decadeName}>{decadeLabel}</span>
                <span style={styles.decadeMeta}>
                  {decadeSongs.length} songs · {Math.floor(decadeSeconds / 60)}:{(decadeSeconds % 60).toString().padStart(2, '0')} · avg {avgBpm} BPM
                </span>
              </div>

              {decadeSongs.map((song, idx) => {
                const prevSong = idx > 0 ? decadeSongs[idx - 1] : null;
                // Check global index for cross-decade transitions
                const globalIdx = songs.indexOf(song);
                const globalPrev = globalIdx > 0 ? songs[globalIdx - 1] : null;
                const actualPrev = prevSong || globalPrev;

                const bpmCompat = actualPrev ? getBpmCompatibility(actualPrev.bpm, song.bpm) : 'ok';
                const keyCompat = actualPrev ? areKeysCompatible(actualPrev.key, song.key) : true;
                const isEditing = editingId === song.medleyId;

                return (
                  <div key={song.medleyId}>
                    {/* Transition indicator */}
                    {actualPrev && (
                      <div style={styles.transitionRow}>
                        <div style={styles.transitionLine} />
                        <button
                          style={{
                            ...styles.transitionBadge,
                            background: TRANSITION_COLORS[song.transition_in || 'hard_cut'],
                          }}
                          onClick={() => {
                            const currentIdx = TRANSITIONS.indexOf(song.transition_in || 'hard_cut');
                            const nextTransition = TRANSITIONS[(currentIdx + 1) % TRANSITIONS.length];
                            onUpdateSong(song.medleyId, { transition_in: nextTransition });
                          }}
                          title="Click to cycle transition type"
                        >
                          {TRANSITION_LABELS[song.transition_in || 'hard_cut']}
                        </button>
                        {bpmCompat !== 'ok' && (
                          <span style={{
                            ...styles.warningBadge,
                            background: bpmCompat === 'red' ? 'var(--red)' : 'var(--amber)',
                          }}>
                            BPM {actualPrev.bpm}→{song.bpm} ({Math.abs(actualPrev.bpm - song.bpm)})
                          </span>
                        )}
                        {!keyCompat && (
                          <span style={{ ...styles.warningBadge, background: 'var(--amber)' }}>
                            Key: {getCamelotCode(actualPrev.key)}→{getCamelotCode(song.key)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Song card */}
                    <div
                      style={{
                        ...styles.songCard,
                        borderLeftColor: getCamelotColor(song.key),
                      }}
                      onClick={() => setEditingId(isEditing ? null : song.medleyId)}
                    >
                      <div style={styles.songMain}>
                        <div style={styles.songInfo}>
                          <span style={styles.songYear}>{song.year}</span>
                          <span style={styles.songTitle}>{song.title}</span>
                          <span style={styles.songArtist}>{song.artist}</span>
                        </div>
                        <div style={styles.songMeta}>
                          <span style={styles.metaBadge}>{song.bpm} BPM</span>
                          <span style={styles.metaBadge}>{song.key}</span>
                          <span style={styles.metaBadge}>{song.snippet_duration}s</span>
                          {song.crowd_moment && <span style={{ ...styles.metaBadge, background: 'var(--green)', color: '#000' }}>SING</span>}
                          {song.easter_egg && <span style={{ ...styles.metaBadge, background: 'var(--purple)', color: '#000' }}>EGG</span>}
                        </div>
                        <div style={styles.songActions}>
                          <button onClick={(e) => { e.stopPropagation(); onReorderSong(song.medleyId, 'up'); }} style={styles.miniBtn} title="Move up">↑</button>
                          <button onClick={(e) => { e.stopPropagation(); onReorderSong(song.medleyId, 'down'); }} style={styles.miniBtn} title="Move down">↓</button>
                          <button onClick={(e) => { e.stopPropagation(); onRemoveSong(song.medleyId); }} style={{ ...styles.miniBtn, color: 'var(--red)' }} title="Remove">×</button>
                        </div>
                      </div>

                      {isEditing && (
                        <div style={styles.editPanel} onClick={(e) => e.stopPropagation()}>
                          <div style={styles.editRow}>
                            <label>Duration (s):</label>
                            <input
                              type="number"
                              value={song.snippet_duration}
                              onChange={(e) => onUpdateSong(song.medleyId, { snippet_duration: Number(e.target.value) || 45 })}
                              style={{ width: 60 }}
                            />
                            <label>Section:</label>
                            <select
                              value={song.section || 'chorus'}
                              onChange={(e) => onUpdateSong(song.medleyId, { section: e.target.value as MedleySong['section'] })}
                            >
                              <option value="chorus">Chorus</option>
                              <option value="verse">Verse</option>
                              <option value="bridge">Bridge</option>
                              <option value="instrumental">Instrumental</option>
                            </select>
                            <label>Bars:</label>
                            <select
                              value={song.bar_count || 16}
                              onChange={(e) => onUpdateSong(song.medleyId, { bar_count: Number(e.target.value) })}
                            >
                              <option value={8}>8</option>
                              <option value={16}>16</option>
                              <option value={24}>24</option>
                              <option value={32}>32</option>
                            </select>
                          </div>
                          <div style={styles.editRow}>
                            <label>
                              <input
                                type="checkbox"
                                checked={song.crowd_moment || false}
                                onChange={(e) => onUpdateSong(song.medleyId, { crowd_moment: e.target.checked })}
                              /> Crowd Moment
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                checked={song.easter_egg || false}
                                onChange={(e) => onUpdateSong(song.medleyId, { easter_egg: e.target.checked })}
                              /> Easter Egg
                            </label>
                          </div>
                          <div style={styles.editRow}>
                            <label>Notes:</label>
                            <input
                              type="text"
                              value={song.arrangement_notes || ''}
                              onChange={(e) => onUpdateSong(song.medleyId, { arrangement_notes: e.target.value })}
                              style={{ flex: 1 }}
                              placeholder="Arrangement notes..."
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        {songs.length === 0 && (
          <div style={styles.emptyState}>
            Add songs from the browser to start building your medley
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px 8px',
  },
  arrangeBar: {},
  title: {
    fontSize: 16,
    fontWeight: 700,
  },
  stats: {
    display: 'flex',
    gap: 8,
  },
  statBadge: {
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 8,
    background: 'var(--bg-tertiary)',
    fontWeight: 600,
  },
  timeline: {
    flex: 1,
    overflow: 'auto',
    padding: '0 16px 16px',
  },
  decadeSection: {
    marginBottom: 16,
  },
  decadeHeader: {
    borderLeft: '4px solid',
    padding: '6px 12px',
    background: 'var(--bg-tertiary)',
    borderRadius: '0 4px 4px 0',
    marginBottom: 8,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  decadeName: {
    fontWeight: 700,
    fontSize: 13,
  },
  decadeMeta: {
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  songCard: {
    background: 'var(--bg-secondary)',
    borderRadius: 4,
    borderLeft: '3px solid',
    marginBottom: 2,
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  songMain: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 10px',
    gap: 8,
  },
  songInfo: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  songYear: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 600,
    flexShrink: 0,
  },
  songTitle: {
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  songArtist: {
    color: 'var(--text-secondary)',
    fontSize: 12,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  songMeta: {
    display: 'flex',
    gap: 4,
    flexShrink: 0,
  },
  metaBadge: {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 8,
    background: 'var(--bg-tertiary)',
    whiteSpace: 'nowrap',
  },
  songActions: {
    display: 'flex',
    gap: 2,
    flexShrink: 0,
  },
  miniBtn: {
    padding: '1px 6px',
    fontSize: 12,
    lineHeight: 1,
    borderRadius: 3,
    minWidth: 20,
  },
  transitionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 0 3px 16px',
  },
  transitionLine: {
    width: 2,
    height: 12,
    background: 'var(--border)',
  },
  transitionBadge: {
    fontSize: 9,
    padding: '1px 6px',
    borderRadius: 3,
    color: '#000',
    fontWeight: 700,
    border: 'none',
    cursor: 'pointer',
  },
  warningBadge: {
    fontSize: 9,
    padding: '1px 6px',
    borderRadius: 3,
    color: '#000',
    fontWeight: 600,
  },
  editPanel: {
    padding: '8px 10px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  editRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 11,
  },
  emptyState: {
    textAlign: 'center',
    color: 'var(--text-muted)',
    padding: 40,
    fontSize: 14,
  },
  arrangeBtn: {
    fontSize: 11,
    fontWeight: 700,
    padding: '5px 10px',
    borderRadius: 6,
    border: 'none',
    background: 'linear-gradient(135deg, #748ffc, #da77f2)',
    color: '#fff',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    width: '100%',
    letterSpacing: 0.5,
  },
  clearBtn: {
    fontSize: 11,
    fontWeight: 700,
    padding: '5px 10px',
    borderRadius: 6,
    border: '1px solid var(--red)',
    background: 'transparent',
    color: 'var(--red)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  genSection: {
    padding: '0 16px 8px',
  },
  generateToggle: {
    fontSize: 12,
    fontWeight: 700,
    padding: '8px 16px',
    borderRadius: 6,
    border: 'none',
    background: 'linear-gradient(135deg, #ff6b6b, #ffa94d, #ffd43b, #69db7c, #3bc9db, #748ffc, #da77f2)',
    color: '#000',
    cursor: 'pointer',
    width: '100%',
    letterSpacing: 0.5,
  },
  genHint: {
    marginTop: 4,
    fontSize: 10,
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
  genProgressPanel: {
    marginTop: 8,
    padding: 12,
    background: 'var(--bg-tertiary)',
    borderRadius: 6,
  },
  genProgressBar: {
    height: 4,
    background: 'var(--bg-primary)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 6,
  },
  genProgressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #69db7c, #3bc9db, #748ffc)',
    borderRadius: 2,
    transition: 'width 0.3s ease',
  },
  genProgressText: {
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  genError: {
    marginTop: 8,
    fontSize: 11,
    color: 'var(--red)',
    padding: '6px 12px',
    background: 'rgba(239, 83, 80, 0.1)',
    borderRadius: 4,
  },
  narrativeBanner: {
    fontSize: 11,
    padding: '8px 16px',
    background: 'rgba(105, 219, 124, 0.1)',
    color: '#69db7c',
    borderBottom: '1px solid rgba(105, 219, 124, 0.2)',
    lineHeight: 1.4,
    fontStyle: 'italic',
  },
  arrangeBanner: {
    fontSize: 10,
    padding: '6px 16px',
    background: 'rgba(116, 143, 252, 0.15)',
    color: '#748ffc',
    borderBottom: '1px solid rgba(116, 143, 252, 0.3)',
    fontWeight: 600,
  },
};
