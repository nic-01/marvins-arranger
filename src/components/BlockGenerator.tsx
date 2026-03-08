import { useState, useMemo } from 'react';
import type { Song } from '../types';
import { getCamelotCode, getCamelotColor } from '../camelot';
import {
  discoverBlocks,
  removeSongFromBlock,
  type Block,
  type BlockDiscoveryResult,
  type DiscoveryProgress,
} from '../block-discovery';
import type { PairScore, TransitionQuality } from '../transition-scoring';

interface BlockGeneratorProps {
  catalog: Song[];
  starredIds: Set<string>;
  deletedIds: Set<string>;
  onAcceptArrangement?: (songs: Song[]) => void;
}

const QUALITY_COLORS: Record<TransitionQuality, string> = {
  mashup: '#4caf50',
  smooth: '#8bc34a',
  workable: '#ffc107',
  hard: '#f44336',
};

const QUALITY_LABELS: Record<TransitionQuality, string> = {
  mashup: 'MASHUP',
  smooth: 'SMOOTH',
  workable: 'OK',
  hard: 'HARD',
};

function getDecadeColor(year: number): string {
  if (year < 1950) return 'var(--decade-sprint)';
  const decade = Math.floor(year / 10) * 10;
  const map: Record<number, string> = {
    1950: 'var(--decade-50s)',
    1960: 'var(--decade-60s)',
    1970: 'var(--decade-70s)',
    1980: 'var(--decade-80s)',
    1990: 'var(--decade-90s)',
    2000: 'var(--decade-00s)',
    2010: 'var(--decade-10s)',
    2020: 'var(--decade-20s)',
  };
  return map[decade] || 'var(--text-muted)';
}

export default function BlockGenerator({ catalog, starredIds, deletedIds, onAcceptArrangement }: BlockGeneratorProps) {
  const [result, setResult] = useState<BlockDiscoveryResult | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [progress, setProgress] = useState<DiscoveryProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [expandedBlock, setExpandedBlock] = useState<string | null>(null);
  const [selectedTransition, setSelectedTransition] = useState<PairScore | null>(null);

  const availableCount = useMemo(() =>
    catalog.filter(s => !deletedIds.has(s.id)).length,
    [catalog, deletedIds]
  );

  const handleGenerate = () => {
    setRunning(true);
    setResult(null);
    setSelectedTransition(null);

    // Run async to allow progress updates
    setTimeout(() => {
      const res = discoverBlocks(catalog, {
        starredIds,
        excludedIds: deletedIds,
        beamWidth: 30,
        maxYearGap: 3,
        minBlockScore: 55,
        maxBlockSize: 8,
      }, setProgress);

      setResult(res);
      setBlocks(res.blocks);
      setRunning(false);
    }, 50);
  };

  const handleRemoveSong = (blockIdx: number, songIdx: number) => {
    const newBlocks = removeSongFromBlock(blocks, blockIdx, songIdx);
    setBlocks(newBlocks);
  };

  const handleAccept = () => {
    if (!onAcceptArrangement || blocks.length === 0) return;
    const allSongs = blocks.flatMap(b => b.songs);
    onAcceptArrangement(allSongs);
  };

  const totalSongs = blocks.reduce((sum, b) => sum + b.songs.length, 0);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Block Generator</h2>
          <span style={styles.subtitle}>
            {availableCount} songs available ({starredIds.size} starred, {deletedIds.size} excluded)
          </span>
        </div>
        <div style={styles.actions}>
          <button
            onClick={handleGenerate}
            disabled={running || availableCount === 0}
            style={styles.generateBtn}
          >
            {running ? 'Generating...' : 'Generate Blocks'}
          </button>
          {blocks.length > 0 && onAcceptArrangement && (
            <button onClick={handleAccept} style={styles.acceptBtn}>
              Accept ({totalSongs} songs)
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {running && progress && (
        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, width: `${progress.percent}%` }} />
          <span style={styles.progressText}>{progress.message}</span>
        </div>
      )}

      {/* Stats banner */}
      {result && !running && (
        <div style={styles.statsBanner}>
          <span style={styles.stat}>
            <strong>{result.stats.blockCount}</strong> blocks
          </span>
          <span style={styles.stat}>
            <strong>{totalSongs}</strong> songs
          </span>
          <span style={{ ...styles.stat, color: QUALITY_COLORS.mashup }}>
            <strong>{result.stats.mashupCount}</strong> mashups
          </span>
          <span style={{ ...styles.stat, color: QUALITY_COLORS.smooth }}>
            <strong>{result.stats.smoothCount}</strong> smooth
          </span>
          <span style={{ ...styles.stat, color: QUALITY_COLORS.workable }}>
            <strong>{result.stats.workableCount}</strong> workable
          </span>
          <span style={{ ...styles.stat, color: QUALITY_COLORS.hard }}>
            <strong>{result.stats.hardCount}</strong> hard
          </span>
          <span style={styles.stat}>
            avg score: <strong>{result.avgScore.toFixed(1)}</strong>
          </span>
        </div>
      )}

      {/* Block list */}
      <div style={styles.blockList}>
        {blocks.map((block, bi) => (
          <div key={block.id}>
            {/* Block card */}
            <div
              style={{
                ...styles.blockCard,
                borderLeftColor: block.hasMashup ? QUALITY_COLORS.mashup : (block.avgScore >= 65 ? QUALITY_COLORS.smooth : QUALITY_COLORS.workable),
              }}
              onClick={() => setExpandedBlock(expandedBlock === block.id ? null : block.id)}
            >
              <div style={styles.blockHeader}>
                <span style={styles.blockLabel}>
                  Block {bi + 1}
                </span>
                <span style={styles.blockMeta}>
                  {block.songs.length} songs &middot; {block.yearRange[0]}-{block.yearRange[1]}
                </span>
                <span style={{
                  ...styles.qualityBadge,
                  background: block.avgScore >= 70 ? QUALITY_COLORS.smooth
                    : block.avgScore >= 50 ? QUALITY_COLORS.workable
                    : QUALITY_COLORS.hard,
                }}>
                  avg {block.avgScore.toFixed(0)}
                </span>
                {block.hasMashup && (
                  <span style={{ ...styles.qualityBadge, background: QUALITY_COLORS.mashup }}>
                    MASHUP
                  </span>
                )}
              </div>

              {/* Compact song list */}
              <div style={styles.songChips}>
                {block.songs.map((song, si) => (
                  <span key={song.id + si} style={styles.songChipRow}>
                    <span style={{
                      ...styles.songChip,
                      borderLeftColor: getDecadeColor(song.year),
                      background: starredIds.has(song.id) ? 'rgba(255, 215, 0, 0.15)' : 'var(--bg-tertiary)',
                    }}>
                      {starredIds.has(song.id) && <span style={{ color: '#ffd700', marginRight: 2 }}>{'\u2605'}</span>}
                      {song.title}
                      <span style={styles.chipArtist}> - {song.artist}</span>
                      <span style={styles.chipYear}> ({song.year})</span>
                    </span>
                    {si < block.songs.length - 1 && block.transitions[si] && (
                      <span
                        style={{
                          ...styles.transitionDot,
                          background: QUALITY_COLORS[block.transitions[si].quality],
                          cursor: 'pointer',
                        }}
                        title={`${QUALITY_LABELS[block.transitions[si].quality]} (${block.transitions[si].score.toFixed(0)})`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTransition(block.transitions[si]);
                        }}
                      />
                    )}
                  </span>
                ))}
              </div>
            </div>

            {/* Expanded block detail */}
            {expandedBlock === block.id && (
              <div style={styles.expandedDetail}>
                <table style={styles.detailTable}>
                  <thead>
                    <tr>
                      <th style={styles.detailTh}></th>
                      <th style={styles.detailTh}>Year</th>
                      <th style={{ ...styles.detailTh, textAlign: 'left' }}>Song</th>
                      <th style={styles.detailTh}>BPM</th>
                      <th style={styles.detailTh}>Key</th>
                      <th style={styles.detailTh}>Energy</th>
                      <th style={styles.detailTh}>Transition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {block.songs.map((song, si) => {
                      const transition = si > 0 ? block.transitions[si - 1] : null;
                      return (
                        <tr key={song.id + si} style={styles.detailRow}>
                          <td style={styles.detailTd}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRemoveSong(bi, si); }}
                              style={styles.removeBtn}
                              title="Remove from block"
                            >
                              {'\u2715'}
                            </button>
                          </td>
                          <td style={styles.detailTd}>
                            <span style={{ borderLeft: `3px solid ${getDecadeColor(song.year)}`, paddingLeft: 4 }}>
                              {song.year}
                            </span>
                          </td>
                          <td style={{ ...styles.detailTd, textAlign: 'left' }}>
                            <strong>{song.title}</strong>
                            <span style={{ color: 'var(--text-secondary)' }}> - {song.artist}</span>
                          </td>
                          <td style={styles.detailTd}>{song.bpm}</td>
                          <td style={styles.detailTd}>
                            <span style={{
                              padding: '1px 4px',
                              borderRadius: 3,
                              background: getCamelotColor(song.key) + '33',
                              fontSize: 11,
                            }}>
                              {song.key} ({getCamelotCode(song.key)})
                            </span>
                          </td>
                          <td style={styles.detailTd}>
                            <span style={{
                              fontSize: 10,
                              padding: '1px 6px',
                              borderRadius: 8,
                              color: '#000',
                              fontWeight: 600,
                              background: song.energy === 'High' ? 'var(--red)' : song.energy === 'Medium' ? 'var(--amber)' : 'var(--green)',
                            }}>
                              {song.energy}
                            </span>
                          </td>
                          <td style={styles.detailTd}>
                            {transition && (
                              <span
                                style={{
                                  ...styles.transitionBadge,
                                  background: QUALITY_COLORS[transition.quality],
                                  cursor: 'pointer',
                                }}
                                onClick={(e) => { e.stopPropagation(); setSelectedTransition(transition); }}
                              >
                                {QUALITY_LABELS[transition.quality]} ({transition.score.toFixed(0)})
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Inter-block transition indicator */}
            {bi < blocks.length - 1 && (
              <div style={styles.blockGap}>
                <div style={styles.blockGapLine} />
                <span style={styles.blockGapLabel}>HARD CUT</span>
                <div style={styles.blockGapLine} />
              </div>
            )}
          </div>
        ))}

        {/* Skipped songs */}
        {result && result.skippedSongs.length > 0 && (
          <div style={styles.skippedSection}>
            <h4 style={styles.skippedTitle}>
              {result.skippedSongs.length} songs not placed
            </h4>
            <div style={styles.skippedList}>
              {result.skippedSongs.slice(0, 20).map(s => (
                <span key={s.id} style={styles.skippedChip}>
                  {s.title} - {s.artist} ({s.year})
                </span>
              ))}
              {result.skippedSongs.length > 20 && (
                <span style={styles.skippedChip}>
                  ...and {result.skippedSongs.length - 20} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Transition detail panel */}
      {selectedTransition && (
        <TransitionDetail
          pair={selectedTransition}
          onClose={() => setSelectedTransition(null)}
        />
      )}
    </div>
  );
}

function TransitionDetail({ pair, onClose }: { pair: PairScore; onClose: () => void }) {
  return (
    <div style={styles.transitionPanel}>
      <div style={styles.transitionPanelHeader}>
        <strong>Transition Detail</strong>
        <button onClick={onClose} style={styles.closeBtn}>{'\u2715'}</button>
      </div>
      <div style={styles.transitionPanelBody}>
        <div style={styles.transitionSongs}>
          <div style={styles.transitionSong}>
            <strong>{pair.from.title}</strong>
            <span style={{ color: 'var(--text-secondary)' }}> - {pair.from.artist} ({pair.from.year})</span>
            <div style={{ fontSize: 11, marginTop: 2 }}>
              {pair.from.bpm} BPM &middot; {pair.from.key} ({getCamelotCode(pair.from.key)}) &middot; {pair.from.energy}
            </div>
          </div>
          <div style={{
            textAlign: 'center',
            padding: '4px 0',
            fontSize: 20,
            color: QUALITY_COLORS[pair.quality],
          }}>
            {'\u2193'}
          </div>
          <div style={styles.transitionSong}>
            <strong>{pair.to.title}</strong>
            <span style={{ color: 'var(--text-secondary)' }}> - {pair.to.artist} ({pair.to.year})</span>
            <div style={{ fontSize: 11, marginTop: 2 }}>
              {pair.to.bpm} BPM &middot; {pair.to.key} ({getCamelotCode(pair.to.key)}) &middot; {pair.to.energy}
            </div>
          </div>
        </div>

        <div style={styles.transitionMetrics}>
          <div style={styles.metric}>
            <span style={styles.metricLabel}>Quality</span>
            <span style={{
              ...styles.transitionBadge,
              background: QUALITY_COLORS[pair.quality],
            }}>
              {QUALITY_LABELS[pair.quality]} ({pair.score.toFixed(0)})
            </span>
          </div>
          <div style={styles.metric}>
            <span style={styles.metricLabel}>Mashup Potential</span>
            <span>{pair.mashupPotential}/100</span>
          </div>
          <div style={styles.metric}>
            <span style={styles.metricLabel}>Key Distance</span>
            <span>{pair.keyDistance} steps{pair.suggestedKeyShift !== 0 ? ` (shift ${pair.suggestedKeyShift > 0 ? '+' : ''}${pair.suggestedKeyShift} = ${pair.keyShiftDifficulty})` : ''}</span>
          </div>
          <div style={styles.metric}>
            <span style={styles.metricLabel}>Tempo</span>
            <span>
              {pair.tempoSyncable ? 'Syncable' : 'Needs change'}
              {pair.halfDoubleTime ? ' (half/double time)' : ''}
              {pair.tempoSyncable ? ` @ ${pair.tempoSyncBpm} BPM` : ''}
            </span>
          </div>
          <div style={styles.metric}>
            <span style={styles.metricLabel}>Energy Flow</span>
            <span>{pair.energyFlow}</span>
          </div>
          <div style={styles.metric}>
            <span style={styles.metricLabel}>BPM Diff</span>
            <span>{Math.abs(pair.from.bpm - pair.to.bpm)} BPM ({(pair.bpmRatio * 100 - 100).toFixed(1)}%)</span>
          </div>
          <div style={styles.metric}>
            <span style={styles.metricLabel}>Compatibility</span>
            <span>
              BPM:{pair.compatibility.bpm.toFixed(0)}
              Key:{pair.compatibility.key.toFixed(0)}
              Energy:{pair.compatibility.energy.toFixed(0)}
              Genre:{pair.compatibility.genre.toFixed(0)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '12px 16px 8px',
    flexShrink: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    margin: 0,
  },
  subtitle: {
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  actions: {
    display: 'flex',
    gap: 8,
  },
  generateBtn: {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 700,
    borderRadius: 6,
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    cursor: 'pointer',
  },
  acceptBtn: {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 700,
    borderRadius: 6,
    border: 'none',
    background: 'var(--green)',
    color: '#000',
    cursor: 'pointer',
  },
  progressBar: {
    height: 24,
    margin: '0 16px 8px',
    background: 'var(--bg-tertiary)',
    borderRadius: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: 'var(--accent)',
    transition: 'width 0.3s',
    borderRadius: 4,
  },
  progressText: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  statsBanner: {
    display: 'flex',
    gap: 12,
    padding: '8px 16px',
    background: 'var(--bg-tertiary)',
    margin: '0 16px 8px',
    borderRadius: 6,
    flexWrap: 'wrap',
  },
  stat: {
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  blockList: {
    flex: 1,
    overflow: 'auto',
    padding: '0 16px 16px',
  },
  blockCard: {
    background: 'var(--bg-secondary)',
    borderRadius: 8,
    padding: '10px 12px',
    borderLeft: '4px solid',
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  blockHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  blockLabel: {
    fontSize: 12,
    fontWeight: 700,
  },
  blockMeta: {
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  qualityBadge: {
    fontSize: 9,
    padding: '1px 6px',
    borderRadius: 8,
    color: '#000',
    fontWeight: 700,
  },
  songChips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 2,
    alignItems: 'center',
  },
  songChipRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
  },
  songChip: {
    fontSize: 11,
    padding: '2px 6px',
    borderRadius: 4,
    borderLeft: '3px solid',
    whiteSpace: 'nowrap',
  },
  chipArtist: {
    color: 'var(--text-secondary)',
    fontSize: 10,
  },
  chipYear: {
    color: 'var(--text-muted)',
    fontSize: 10,
  },
  transitionDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0,
  },
  blockGap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 0',
  },
  blockGapLine: {
    flex: 1,
    height: 1,
    background: 'var(--border)',
  },
  blockGapLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: '#f44336',
    letterSpacing: 1,
  },
  expandedDetail: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: '0 0 8px 8px',
    marginTop: -4,
    padding: 8,
    marginBottom: 4,
  },
  detailTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 12,
  },
  detailTh: {
    padding: '4px 6px',
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border)',
    textAlign: 'center',
  },
  detailRow: {
    borderBottom: '1px solid var(--bg-tertiary)',
  },
  detailTd: {
    padding: '4px 6px',
    textAlign: 'center',
    fontSize: 12,
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: 11,
    padding: '0 4px',
  },
  transitionBadge: {
    fontSize: 9,
    padding: '1px 6px',
    borderRadius: 8,
    color: '#000',
    fontWeight: 700,
    display: 'inline-block',
  },
  skippedSection: {
    marginTop: 16,
    padding: 12,
    background: 'var(--bg-secondary)',
    borderRadius: 8,
  },
  skippedTitle: {
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 8,
    color: 'var(--text-secondary)',
  },
  skippedList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  skippedChip: {
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 4,
    background: 'var(--bg-tertiary)',
    color: 'var(--text-secondary)',
  },
  transitionPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    background: 'var(--bg-secondary)',
    borderTop: '2px solid var(--accent)',
    maxHeight: '40%',
    overflow: 'auto',
    zIndex: 10,
  },
  transitionPanelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 16px',
    borderBottom: '1px solid var(--border)',
    fontSize: 13,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: 14,
  },
  transitionPanelBody: {
    padding: '8px 16px 16px',
  },
  transitionSongs: {
    marginBottom: 12,
  },
  transitionSong: {
    fontSize: 12,
  },
  transitionMetrics: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  metric: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
  },
  metricLabel: {
    color: 'var(--text-secondary)',
    fontWeight: 600,
  },
};
