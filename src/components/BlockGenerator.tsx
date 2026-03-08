import { useState, useMemo } from 'react';
import type { Song, BlockRating, BlockPreferenceLog } from '../types';
import { getCamelotCode, getCamelotColor } from '../camelot';
import {
  discoverBlocks,
  type Block,
  type BlockDiscoveryResult,
  type DiscoveryProgress,
} from '../block-discovery';
import {
  assembleBlocks,
  type AssembledMedley,
  type AssemblyProgress,
} from '../block-assembly';
import type { PairScore, TransitionQuality } from '../transition-scoring';

interface BlockGeneratorProps {
  catalog: Song[];
  starredIds: Set<string>;
  deletedIds: Set<string>;
  onAcceptArrangement?: (songs: Song[]) => void;
  onRateBlock?: (log: BlockPreferenceLog) => void;
  blockRatings?: Map<string, BlockRating>;
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

function getBlockFingerprint(block: Block): string {
  return [...block.songs.map(s => s.id)].sort().join('|');
}

function buildBlockPreferenceLog(block: Block, rating: BlockRating): BlockPreferenceLog {
  return {
    blockFingerprint: getBlockFingerprint(block),
    songIds: block.songs.map(s => s.id),
    decade: block.decade,
    rating,
    timestamp: Date.now(),
    meta: {
      avgScore: block.avgScore,
      avgEnergy: block.avgEnergy,
      hasMashup: block.hasMashup,
      hasCrowdMoment: block.hasCrowdMoment,
      bpmRange: [block.entryBpm, block.exitBpm],
      genres: [...new Set(block.songs.map(s => s.genre))],
    },
  };
}

export default function BlockGenerator({ catalog, starredIds, deletedIds, onAcceptArrangement, onRateBlock, blockRatings }: BlockGeneratorProps) {
  const [discoveryResult, setDiscoveryResult] = useState<BlockDiscoveryResult | null>(null);
  const [assembly, setAssembly] = useState<AssembledMedley | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [expandedBlock, setExpandedBlock] = useState<string | null>(null);
  const [selectedTransition, setSelectedTransition] = useState<PairScore | null>(null);
  const [viewMode, setViewMode] = useState<'discovery' | 'assembly'>('discovery');

  const availableCount = useMemo(() =>
    catalog.filter(s => !deletedIds.has(s.id)).length,
    [catalog, deletedIds]
  );

  const handleDiscover = () => {
    setRunning(true);
    setDiscoveryResult(null);
    setAssembly(null);
    setSelectedTransition(null);
    setViewMode('discovery');

    setTimeout(() => {
      const res = discoverBlocks(catalog, {
        starredIds,
        excludedIds: deletedIds,
      }, (p: DiscoveryProgress) => {
        setProgressMsg(p.message);
      });

      setDiscoveryResult(res);
      setRunning(false);
      setProgressMsg('');
    }, 50);
  };

  const handleAssemble = () => {
    if (!discoveryResult) return;
    setRunning(true);
    setViewMode('assembly');

    setTimeout(() => {
      const result = assembleBlocks(discoveryResult, {
        starredIds,
      }, (p: AssemblyProgress) => {
        setProgressMsg(p.message);
      });

      setAssembly(result);
      setRunning(false);
      setProgressMsg('');
    }, 50);
  };

  const handleAccept = () => {
    if (!onAcceptArrangement || !assembly) return;
    onAcceptArrangement(assembly.path);
  };

  const displayBlocks = viewMode === 'assembly' && assembly
    ? assembly.blocks
    : discoveryResult?.allBlocks || [];

  const displayTransitions = viewMode === 'assembly' && assembly
    ? assembly.transitions
    : [];

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.title}>Block Generator</h2>
          <span style={styles.subtitle}>
            {availableCount} songs available &middot; {starredIds.size} starred &middot; {deletedIds.size} excluded
          </span>
        </div>
        <div style={styles.actions}>
          <button
            onClick={handleDiscover}
            disabled={running || availableCount === 0}
            style={styles.primaryBtn}
          >
            {running && !discoveryResult ? 'Discovering...' : '1. Discover Blocks'}
          </button>
          {discoveryResult && (
            <button
              onClick={handleAssemble}
              disabled={running}
              style={styles.primaryBtn}
            >
              {running && viewMode === 'assembly' ? 'Assembling...' : '2. Assemble Medley'}
            </button>
          )}
          {assembly && onAcceptArrangement && (
            <button onClick={handleAccept} style={styles.acceptBtn}>
              Accept ({assembly.totalSongs} songs)
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      {running && progressMsg && (
        <div style={styles.progressBanner}>
          {progressMsg}
        </div>
      )}

      {/* Stats */}
      {discoveryResult && !running && viewMode === 'discovery' && (
        <div style={styles.statsBanner}>
          <span style={styles.stat}><strong>{discoveryResult.stats.totalBlocks}</strong> blocks found</span>
          <span style={styles.stat}><strong>{discoveryResult.stats.totalUniqueSongs}</strong> unique songs</span>
          <span style={styles.stat}>avg size: <strong>{discoveryResult.stats.avgBlockSize.toFixed(1)}</strong></span>
          <span style={{ ...styles.stat, color: QUALITY_COLORS.mashup }}>
            <strong>{discoveryResult.stats.mashupBlocks}</strong> w/ mashup
          </span>
          <span style={styles.stat}>
            <strong>{discoveryResult.stats.crowdMomentBlocks}</strong> w/ singalong
          </span>
          {Object.entries(discoveryResult.stats.decadeBreakdown).map(([d, n]) => (
            <span key={d} style={styles.stat}>{d}: <strong>{n}</strong></span>
          ))}
        </div>
      )}

      {assembly && !running && viewMode === 'assembly' && (
        <div style={styles.statsBanner}>
          <span style={styles.stat}><strong>{assembly.stats.blocksUsed}</strong> blocks</span>
          <span style={styles.stat}><strong>{assembly.stats.songsUsed}</strong> songs</span>
          <span style={styles.stat}>~<strong>{Math.round(assembly.estimatedDuration / 60)}</strong> min</span>
          <span style={styles.stat}>block quality: <strong>{assembly.avgBlockScore.toFixed(0)}</strong></span>
          <span style={styles.stat}>transitions: <strong>{assembly.avgTransitionScore.toFixed(0)}</strong></span>
          <span style={{ ...styles.stat, color: QUALITY_COLORS.mashup }}>
            <strong>{assembly.stats.mashupBlocks}</strong> mashups
          </span>
          <span style={styles.stat}>
            <strong>{assembly.stats.crowdMoments}</strong> singalongs
          </span>
          {assembly.stats.starredIncluded > 0 && (
            <span style={{ ...styles.stat, color: '#ffd700' }}>
              <strong>{assembly.stats.starredIncluded}</strong> starred
            </span>
          )}
        </div>
      )}

      {/* View toggle */}
      {discoveryResult && assembly && !running && (
        <div style={styles.viewToggle}>
          <button
            style={viewMode === 'discovery' ? styles.toggleActive : styles.toggleBtn}
            onClick={() => setViewMode('discovery')}
          >
            All Discovered ({discoveryResult.stats.totalBlocks})
          </button>
          <button
            style={viewMode === 'assembly' ? styles.toggleActive : styles.toggleBtn}
            onClick={() => setViewMode('assembly')}
          >
            Assembled Medley ({assembly.stats.blocksUsed})
          </button>
        </div>
      )}

      {/* Block list */}
      <div style={styles.blockList}>
        {displayBlocks.map((block, bi) => (
          <div key={block.id}>
            <div
              style={{
                ...styles.blockCard,
                borderLeftColor: block.hasMashup ? QUALITY_COLORS.mashup : (block.avgScore >= 65 ? QUALITY_COLORS.smooth : QUALITY_COLORS.workable),
              }}
              onClick={() => setExpandedBlock(expandedBlock === block.id ? null : block.id)}
            >
              <div style={styles.blockHeader}>
                <span style={styles.blockLabel}>
                  {viewMode === 'assembly' ? `${bi + 1}.` : ''} {block.decade}
                </span>
                <span style={styles.blockMeta}>
                  {block.songs.length} songs &middot; {block.yearRange[0]}-{block.yearRange[1]} &middot; {block.entryBpm}-{block.exitBpm} BPM
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
                  <span style={{ ...styles.qualityBadge, background: QUALITY_COLORS.mashup }}>MASHUP</span>
                )}
                {block.hasCrowdMoment && (
                  <span style={{ ...styles.qualityBadge, background: '#42a5f5' }}>SING</span>
                )}
                {/* Block rating */}
                {onRateBlock && (
                  <span style={styles.ratingRow} onClick={(e) => e.stopPropagation()}>
                    {([1, 2, 3, 4, 5] as BlockRating[]).map(r => {
                      const fp = getBlockFingerprint(block);
                      const current = blockRatings?.get(fp) || 0;
                      return (
                        <button
                          key={r}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRateBlock(buildBlockPreferenceLog(block, r));
                          }}
                          style={{
                            ...styles.ratingBtn,
                            color: r <= current ? '#ffd700' : 'var(--text-muted)',
                          }}
                          title={`Rate ${r}/5`}
                        >
                          {r <= current ? '\u2605' : '\u2606'}
                        </button>
                      );
                    })}
                  </span>
                )}
              </div>

              {/* Song chips */}
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
                    </span>
                    {si < block.songs.length - 1 && block.transitions[si] && (
                      <span
                        style={{
                          ...styles.transitionDot,
                          background: QUALITY_COLORS[block.transitions[si].quality],
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

            {/* Expanded detail */}
            {expandedBlock === block.id && (
              <div style={styles.expandedDetail}>
                <table style={styles.detailTable}>
                  <thead>
                    <tr>
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
                            <span style={{ borderLeft: `3px solid ${getDecadeColor(song.year)}`, paddingLeft: 4 }}>
                              {song.year}
                            </span>
                          </td>
                          <td style={{ ...styles.detailTd, textAlign: 'left' }}>
                            <strong>{song.title}</strong>
                            <span style={{ color: 'var(--text-secondary)' }}> - {song.artist}</span>
                            {song.crowd_singalong && <span style={{ color: '#42a5f5', marginLeft: 4 }}>SING</span>}
                          </td>
                          <td style={styles.detailTd}>{song.bpm}</td>
                          <td style={styles.detailTd}>
                            <span style={{
                              padding: '1px 4px', borderRadius: 3,
                              background: getCamelotColor(song.key) + '33', fontSize: 11,
                            }}>
                              {song.key} ({getCamelotCode(song.key)})
                            </span>
                          </td>
                          <td style={styles.detailTd}>
                            <span style={{
                              fontSize: 10, padding: '1px 6px', borderRadius: 8,
                              color: '#000', fontWeight: 600,
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

            {/* Inter-block transition (assembly view only) */}
            {viewMode === 'assembly' && bi < displayBlocks.length - 1 && displayTransitions[bi] && (
              <div style={styles.blockGap}>
                <div style={styles.blockGapLine} />
                <span
                  style={{
                    ...styles.blockGapLabel,
                    color: QUALITY_COLORS[displayTransitions[bi].quality],
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedTransition(displayTransitions[bi])}
                >
                  {QUALITY_LABELS[displayTransitions[bi].quality]} ({displayTransitions[bi].score.toFixed(0)})
                </span>
                <div style={styles.blockGapLine} />
              </div>
            )}

            {/* Decade separator (discovery view) */}
            {viewMode === 'discovery' && bi < displayBlocks.length - 1 &&
              displayBlocks[bi].decade !== displayBlocks[bi + 1].decade && (
              <div style={styles.decadeSeparator}>
                <div style={styles.blockGapLine} />
                <span style={styles.decadeLabel}>{displayBlocks[bi + 1].decade}</span>
                <div style={styles.blockGapLine} />
              </div>
            )}
          </div>
        ))}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12 }}>
            <strong>{pair.from.title}</strong> ({pair.from.bpm} BPM, {pair.from.key})
          </div>
          <span style={{ color: QUALITY_COLORS[pair.quality], fontSize: 18 }}>{'\u2192'}</span>
          <div style={{ fontSize: 12 }}>
            <strong>{pair.to.title}</strong> ({pair.to.bpm} BPM, {pair.to.key})
          </div>
          <span style={{
            ...styles.transitionBadge,
            background: QUALITY_COLORS[pair.quality],
          }}>
            {QUALITY_LABELS[pair.quality]} ({pair.score.toFixed(0)})
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11 }}>
          <span>Mashup: <strong>{pair.mashupPotential}/100</strong></span>
          <span>Key: <strong>{pair.keyDistance} steps</strong>
            {pair.suggestedKeyShift !== 0 && ` (shift ${pair.suggestedKeyShift > 0 ? '+' : ''}${pair.suggestedKeyShift})`}
          </span>
          <span>Tempo: <strong>{pair.tempoSyncable ? `sync @ ${pair.tempoSyncBpm}` : 'needs change'}</strong>
            {pair.halfDoubleTime && ' (half/double)'}
          </span>
          <span>Energy: <strong>{pair.energyFlow}</strong></span>
          <span>BPM diff: <strong>{Math.abs(pair.from.bpm - pair.to.bpm)}</strong></span>
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
    position: 'relative',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '16px 24px 12px',
    flexShrink: 0,
  },
  headerLeft: {},
  title: { fontSize: 18, fontWeight: 700, margin: 0 },
  subtitle: { fontSize: 12, color: 'var(--text-secondary)' },
  actions: { display: 'flex', gap: 8 },
  primaryBtn: {
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
  progressBanner: {
    padding: '6px 24px',
    fontSize: 12,
    color: 'var(--accent)',
    fontWeight: 600,
  },
  statsBanner: {
    display: 'flex',
    gap: 12,
    padding: '8px 24px',
    background: 'var(--bg-tertiary)',
    margin: '0 24px 8px',
    borderRadius: 6,
    flexWrap: 'wrap',
  },
  stat: { fontSize: 11, color: 'var(--text-secondary)' },
  viewToggle: {
    display: 'flex',
    gap: 4,
    padding: '0 24px 8px',
  },
  toggleBtn: {
    padding: '4px 12px',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 4,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
  toggleActive: {
    padding: '4px 12px',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 4,
    border: '1px solid var(--accent)',
    background: 'var(--accent)',
    color: '#fff',
    cursor: 'pointer',
  },
  blockList: {
    flex: 1,
    overflow: 'auto',
    padding: '0 24px 16px',
  },
  blockCard: {
    background: 'var(--bg-secondary)',
    borderRadius: 8,
    padding: '10px 14px',
    borderLeft: '4px solid',
    cursor: 'pointer',
    marginBottom: 2,
  },
  blockHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  blockLabel: { fontSize: 12, fontWeight: 700 },
  blockMeta: { fontSize: 11, color: 'var(--text-secondary)' },
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
  songChipRow: { display: 'inline-flex', alignItems: 'center', gap: 2 },
  songChip: {
    fontSize: 11,
    padding: '2px 6px',
    borderRadius: 4,
    borderLeft: '3px solid',
    whiteSpace: 'nowrap',
  },
  chipArtist: { color: 'var(--text-secondary)', fontSize: 10 },
  transitionDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0,
    cursor: 'pointer',
  },
  blockGap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 0',
  },
  blockGapLine: { flex: 1, height: 1, background: 'var(--border)' },
  blockGapLabel: { fontSize: 9, fontWeight: 700, letterSpacing: 1 },
  decadeSeparator: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 0 6px',
  },
  decadeLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  },
  expandedDetail: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: '0 0 8px 8px',
    marginTop: -2,
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
  detailRow: { borderBottom: '1px solid var(--bg-tertiary)' },
  detailTd: { padding: '4px 6px', textAlign: 'center', fontSize: 12 },
  transitionBadge: {
    fontSize: 9,
    padding: '1px 6px',
    borderRadius: 8,
    color: '#000',
    fontWeight: 700,
    display: 'inline-block',
  },
  transitionPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    background: 'var(--bg-secondary)',
    borderTop: '2px solid var(--accent)',
    zIndex: 10,
  },
  transitionPanelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 24px',
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
  transitionPanelBody: { padding: '8px 24px 16px' },
  ratingRow: {
    display: 'inline-flex',
    gap: 1,
    marginLeft: 'auto',
  },
  ratingBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    padding: '0 1px',
    lineHeight: 1,
  },
};
