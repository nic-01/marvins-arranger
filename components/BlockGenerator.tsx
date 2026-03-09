'use client';

import { useState, useMemo } from 'react';
import type { Song, BlockRating, BlockPreferenceLog } from '@/lib/types';
import { getCamelotCode, getCamelotColor } from '@/lib/camelot';
import {
  discoverBlocks,
  type Block,
  type BlockDiscoveryResult,
  type DiscoveryProgress,
} from '@/lib/block-discovery';
import {
  assembleBlocks,
  type AssembledMedley,
  type AssemblyProgress,
} from '@/lib/block-assembly';
import type { PairScore, TransitionQuality } from '@/lib/transition-scoring';
import {
  discoverPairs,
  type PairDiscoveryResult,
  type PairDiscoveryProgress,
} from '@/lib/pair-scoring';

interface BlockGeneratorProps {
  catalog: Song[];
  medleySongIds: Set<string>;
  starredIds: Set<string>;
  deletedIds: Set<string>;
  onAcceptArrangement?: (songs: Song[]) => void;
  onRateBlock?: (log: BlockPreferenceLog) => void;
  blockRatings?: Map<string, BlockRating>;
  blockPrefLog?: BlockPreferenceLog[];
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

export default function BlockGenerator({ catalog, medleySongIds, starredIds, deletedIds, onAcceptArrangement, onRateBlock, blockRatings, blockPrefLog = [] }: BlockGeneratorProps) {
  const [discoveryResult, setDiscoveryResult] = useState<BlockDiscoveryResult | null>(null);
  const [pairResult, setPairResult] = useState<PairDiscoveryResult | null>(null);
  const [assembly, setAssembly] = useState<AssembledMedley | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [expandedBlock, setExpandedBlock] = useState<string | null>(null);
  const [expandedPair, setExpandedPair] = useState<string | null>(null);
  const [selectedTransition, setSelectedTransition] = useState<PairScore | null>(null);
  const [viewMode, setViewMode] = useState<'pairs' | 'discovery' | 'assembly'>('pairs');
  const [pairDecadeFilter, setPairDecadeFilter] = useState<string>('all');
  const [pairSortBy, setPairSortBy] = useState<'composite' | 'algo' | 'llm'>('composite');

  // When the user has added songs to the medley, only use those; otherwise use full catalog
  const effectiveCatalog = useMemo(() => {
    if (medleySongIds.size > 0) {
      return catalog.filter(s => medleySongIds.has(s.id));
    }
    return catalog;
  }, [catalog, medleySongIds]);

  const availableCount = useMemo(() =>
    effectiveCatalog.filter(s => !deletedIds.has(s.id)).length,
    [effectiveCatalog, deletedIds]
  );

  const handleDiscoverPairs = async () => {
    setRunning(true);
    setPairResult(null);
    setSelectedTransition(null);
    setViewMode('pairs');
    setProgressMsg('Generating candidate pairs...');

    try {
      const res = await discoverPairs(
        effectiveCatalog,
        {},
        { excludedIds: deletedIds },
        (p: PairDiscoveryProgress) => {
          setProgressMsg(p.message);
        }
      );
      setPairResult(res);
    } catch (err) {
      console.error('Pair discovery failed:', err);
      setProgressMsg('Pair discovery failed');
    } finally {
      setRunning(false);
      setProgressMsg('');
    }
  };

  const handleDiscover = () => {
    setRunning(true);
    setDiscoveryResult(null);
    setAssembly(null);
    setSelectedTransition(null);
    setViewMode('discovery');

    setTimeout(() => {
      const res = discoverBlocks(effectiveCatalog, {
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
        blockPreferences: blockPrefLog,
        blockRatings: blockRatings || new Map(),
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

  const displayPairs = useMemo(() => {
    if (!pairResult) return [];
    let pairs = pairDecadeFilter === 'all'
      ? [...pairResult.pairs]
      : [...(pairResult.byDecade.get(pairDecadeFilter) || [])];

    // Sort
    if (pairSortBy === 'algo') {
      pairs.sort((a, b) => b.algoScore - a.algoScore);
    } else if (pairSortBy === 'llm') {
      pairs.sort((a, b) => {
        const aLlm = a.llmScore ? (a.llmScore.narrative + a.llmScore.transition + a.llmScore.mashup) / 3 : 0;
        const bLlm = b.llmScore ? (b.llmScore.narrative + b.llmScore.transition + b.llmScore.mashup) / 3 : 0;
        return bLlm - aLlm;
      });
    } else {
      pairs.sort((a, b) => b.compositeScore - a.compositeScore);
    }

    return pairs;
  }, [pairResult, pairDecadeFilter, pairSortBy]);

  const pairDecades = useMemo(() => {
    if (!pairResult) return [];
    return [...pairResult.byDecade.keys()];
  }, [pairResult]);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.title}>Block Generator</h2>
          <span style={styles.subtitle}>
            {availableCount} songs available{medleySongIds.size > 0 ? ` (from ${medleySongIds.size} in medley)` : ''} &middot; {starredIds.size} starred &middot; {deletedIds.size} excluded
          </span>
        </div>
        <div style={styles.actions}>
          <button
            onClick={handleDiscoverPairs}
            disabled={running || availableCount === 0}
            style={styles.primaryBtn}
          >
            {running && viewMode === 'pairs' ? 'Finding Pairs...' : '1. Discover Pairs'}
          </button>
          <button
            onClick={handleDiscover}
            disabled={running || availableCount === 0}
            style={{ ...styles.primaryBtn, opacity: pairResult ? 1 : 0.5 }}
          >
            {running && viewMode === 'discovery' ? 'Discovering...' : '2. Discover Blocks'}
          </button>
          {discoveryResult && (
            <button
              onClick={handleAssemble}
              disabled={running}
              style={styles.primaryBtn}
            >
              {running && viewMode === 'assembly' ? 'Assembling...' : '3. Assemble Medley'}
            </button>
          )}
          {assembly && onAcceptArrangement && (
            <button onClick={handleAccept} style={styles.acceptBtn}>
              Accept ({assembly.totalSongs} songs)
            </button>
          )}
        </div>
      </div>

      {/* Preference learning indicator */}
      {blockPrefLog.length >= 3 && !running && (
        <div style={styles.prefBanner}>
          Preference learning active: {blockPrefLog.length} block ratings informing selection
        </div>
      )}

      {/* Progress */}
      {running && progressMsg && (
        <div style={styles.progressBanner}>
          <div style={styles.progressBarOuter}>
            <div style={{ ...styles.progressBarInner, width: running ? '60%' : '0%' }} />
          </div>
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

      {/* Pairs stats */}
      {pairResult && !running && viewMode === 'pairs' && (
        <div style={styles.statsBanner}>
          <span style={styles.stat}><strong>{pairResult.stats.totalPairs}</strong> pairs found</span>
          <span style={styles.stat}>avg algo: <strong>{pairResult.stats.avgAlgoScore}</strong></span>
          {pairResult.stats.llmScored > 0 && (
            <span style={{ ...styles.stat, color: '#42a5f5' }}>
              <strong>{pairResult.stats.llmScored}</strong> LLM scored
            </span>
          )}
          {Object.entries(pairResult.stats.pairsPerDecade).map(([d, n]) => (
            <span key={d} style={styles.stat}>{d}: <strong>{n}</strong></span>
          ))}
        </div>
      )}

      {/* View toggle */}
      {(pairResult || discoveryResult || assembly) && !running && (
        <div style={styles.viewToggle}>
          {pairResult && (
            <button
              style={viewMode === 'pairs' ? styles.toggleActive : styles.toggleBtn}
              onClick={() => setViewMode('pairs')}
            >
              Pairs ({pairResult.stats.totalPairs})
            </button>
          )}
          {discoveryResult && (
            <button
              style={viewMode === 'discovery' ? styles.toggleActive : styles.toggleBtn}
              onClick={() => setViewMode('discovery')}
            >
              Blocks ({discoveryResult.stats.totalBlocks})
            </button>
          )}
          {assembly && (
            <button
              style={viewMode === 'assembly' ? styles.toggleActive : styles.toggleBtn}
              onClick={() => setViewMode('assembly')}
            >
              Assembled ({assembly.stats.blocksUsed})
            </button>
          )}
        </div>
      )}

      {/* Pairs view */}
      {viewMode === 'pairs' && pairResult && (
        <div style={styles.blockList}>
          {/* Pair filters */}
          <div style={styles.pairFilters}>
            <select
              value={pairDecadeFilter}
              onChange={e => setPairDecadeFilter(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All decades ({pairResult.stats.totalPairs})</option>
              {pairDecades.map(d => (
                <option key={d} value={d}>
                  {d} ({pairResult.stats.pairsPerDecade[d] || 0})
                </option>
              ))}
            </select>
            <select
              value={pairSortBy}
              onChange={e => setPairSortBy(e.target.value as 'composite' | 'algo' | 'llm')}
              style={styles.filterSelect}
            >
              <option value="composite">Sort: Composite</option>
              <option value="algo">Sort: Algo only</option>
              <option value="llm">Sort: LLM only</option>
            </select>
            <span style={styles.stat}>
              Showing <strong>{displayPairs.length}</strong> pairs
            </span>
          </div>

          {/* Pair cards */}
          {displayPairs.map((pair) => (
            <div key={pair.id}>
              <div
                style={{
                  ...styles.pairCard,
                  borderLeftColor: pair.compositeScore >= 70 ? QUALITY_COLORS.mashup
                    : pair.compositeScore >= 55 ? QUALITY_COLORS.smooth
                    : pair.compositeScore >= 40 ? QUALITY_COLORS.workable
                    : QUALITY_COLORS.hard,
                }}
                onClick={() => setExpandedPair(expandedPair === pair.id ? null : pair.id)}
              >
                <div style={styles.pairHeader}>
                  <span style={styles.pairDecade}>{pair.decade}</span>
                  <span style={styles.pairSongs}>
                    <span style={{
                      ...styles.songChip,
                      borderLeftColor: getDecadeColor(pair.songA.year),
                      background: starredIds.has(pair.songA.id) ? 'rgba(255, 215, 0, 0.15)' : 'var(--bg-tertiary)',
                    }}>
                      {starredIds.has(pair.songA.id) && <span style={{ color: '#ffd700', marginRight: 2 }}>{'\u2605'}</span>}
                      {pair.songA.title}
                      <span style={styles.chipArtist}> - {pair.songA.artist}</span>
                    </span>
                    <span style={{
                      ...styles.transitionDot,
                      background: QUALITY_COLORS[pair.pairScoreAB.quality],
                    }} />
                    <span style={{
                      ...styles.songChip,
                      borderLeftColor: getDecadeColor(pair.songB.year),
                      background: starredIds.has(pair.songB.id) ? 'rgba(255, 215, 0, 0.15)' : 'var(--bg-tertiary)',
                    }}>
                      {starredIds.has(pair.songB.id) && <span style={{ color: '#ffd700', marginRight: 2 }}>{'\u2605'}</span>}
                      {pair.songB.title}
                      <span style={styles.chipArtist}> - {pair.songB.artist}</span>
                    </span>
                  </span>
                  <span style={styles.pairScores}>
                    <span style={{
                      ...styles.qualityBadge,
                      background: pair.compositeScore >= 70 ? QUALITY_COLORS.smooth
                        : pair.compositeScore >= 55 ? QUALITY_COLORS.workable
                        : QUALITY_COLORS.hard,
                    }}>
                      {pair.compositeScore.toFixed(0)}
                    </span>
                    <span style={styles.pairScoreDetail}>
                      algo {pair.algoScore.toFixed(0)}
                    </span>
                    {pair.llmScore && (
                      <span style={{ ...styles.pairScoreDetail, color: '#42a5f5' }}>
                        llm {((pair.llmScore.narrative + pair.llmScore.transition + pair.llmScore.mashup) / 3 * 10).toFixed(0)}
                      </span>
                    )}
                  </span>
                  {(pair.pairScoreAB.quality === 'mashup' || pair.pairScoreBA.quality === 'mashup') && (
                    <span style={{ ...styles.qualityBadge, background: QUALITY_COLORS.mashup }}>MASHUP</span>
                  )}
                  {(pair.songA.crowd_singalong || pair.songB.crowd_singalong) && (
                    <span style={{ ...styles.qualityBadge, background: '#42a5f5' }}>SING</span>
                  )}
                </div>

                {/* LLM reasoning preview */}
                {pair.llmScore && (
                  <div style={styles.pairReasoning}>
                    {pair.llmScore.reasoning}
                  </div>
                )}
              </div>

              {/* Expanded pair detail */}
              {expandedPair === pair.id && (
                <div style={styles.expandedDetail}>
                  <div style={styles.pairDetailGrid}>
                    {/* Song A details */}
                    <div style={styles.pairDetailSong}>
                      <div style={styles.pairDetailSongTitle}>
                        <span style={{ borderLeft: `3px solid ${getDecadeColor(pair.songA.year)}`, paddingLeft: 6 }}>
                          <strong>{pair.songA.title}</strong> - {pair.songA.artist} ({pair.songA.year})
                        </span>
                      </div>
                      <div style={styles.pairDetailMeta}>
                        <span>{pair.songA.bpm} BPM</span>
                        <span style={{
                          padding: '1px 4px', borderRadius: 3,
                          background: getCamelotColor(pair.songA.key) + '33', fontSize: 11,
                        }}>
                          {pair.songA.key} ({getCamelotCode(pair.songA.key)})
                        </span>
                        <span style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 8, color: '#000', fontWeight: 600,
                          background: pair.songA.energy === 'High' ? 'var(--red)' : pair.songA.energy === 'Medium' ? 'var(--amber)' : 'var(--green)',
                        }}>{pair.songA.energy}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{pair.songA.genre}</span>
                      </div>
                    </div>

                    {/* Transition details */}
                    <div style={styles.pairDetailTransition}>
                      <div style={{ fontSize: 11, marginBottom: 4 }}>
                        <strong>A{'\u2192'}B:</strong> {pair.pairScoreAB.score.toFixed(0)}
                        <span style={{
                          ...styles.transitionBadge,
                          background: QUALITY_COLORS[pair.pairScoreAB.quality],
                          marginLeft: 4,
                        }}>
                          {QUALITY_LABELS[pair.pairScoreAB.quality]}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, marginBottom: 4 }}>
                        <strong>B{'\u2192'}A:</strong> {pair.pairScoreBA.score.toFixed(0)}
                        <span style={{
                          ...styles.transitionBadge,
                          background: QUALITY_COLORS[pair.pairScoreBA.quality],
                          marginLeft: 4,
                        }}>
                          {QUALITY_LABELS[pair.pairScoreBA.quality]}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                        Best direction: <strong>{pair.bestDirection === 'AB' ? `${pair.songA.title} \u2192 ${pair.songB.title}` : `${pair.songB.title} \u2192 ${pair.songA.title}`}</strong>
                      </div>
                    </div>

                    {/* Song B details */}
                    <div style={styles.pairDetailSong}>
                      <div style={styles.pairDetailSongTitle}>
                        <span style={{ borderLeft: `3px solid ${getDecadeColor(pair.songB.year)}`, paddingLeft: 6 }}>
                          <strong>{pair.songB.title}</strong> - {pair.songB.artist} ({pair.songB.year})
                        </span>
                      </div>
                      <div style={styles.pairDetailMeta}>
                        <span>{pair.songB.bpm} BPM</span>
                        <span style={{
                          padding: '1px 4px', borderRadius: 3,
                          background: getCamelotColor(pair.songB.key) + '33', fontSize: 11,
                        }}>
                          {pair.songB.key} ({getCamelotCode(pair.songB.key)})
                        </span>
                        <span style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 8, color: '#000', fontWeight: 600,
                          background: pair.songB.energy === 'High' ? 'var(--red)' : pair.songB.energy === 'Medium' ? 'var(--amber)' : 'var(--green)',
                        }}>{pair.songB.energy}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{pair.songB.genre}</span>
                      </div>
                    </div>
                  </div>

                  {/* Detailed metrics */}
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, marginTop: 8, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                    <span>Mashup potential: <strong>{Math.max(pair.pairScoreAB.mashupPotential, pair.pairScoreBA.mashupPotential)}/100</strong></span>
                    <span>Key distance: <strong>{pair.pairScoreAB.keyDistance} steps</strong></span>
                    <span>BPM diff: <strong>{Math.abs(pair.songA.bpm - pair.songB.bpm)}</strong></span>
                    <span>Tempo syncable: <strong>{pair.pairScoreAB.tempoSyncable ? 'Yes' : 'No'}</strong></span>
                    <span>Vocal contrast: <strong>{pair.pairScoreAB.vocalContrast ? 'Yes' : 'No'}</strong></span>
                    <span>Energy: <strong>{pair.pairScoreAB.energyFlow}</strong></span>
                  </div>

                  {/* LLM detail */}
                  {pair.llmScore && (
                    <div style={{ fontSize: 11, marginTop: 8, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: 16, marginBottom: 4 }}>
                        <span>Narrative: <strong style={{ color: pair.llmScore.narrative >= 7 ? QUALITY_COLORS.mashup : pair.llmScore.narrative >= 5 ? QUALITY_COLORS.smooth : 'var(--text-secondary)' }}>{pair.llmScore.narrative}/10</strong></span>
                        <span>Transition: <strong style={{ color: pair.llmScore.transition >= 7 ? QUALITY_COLORS.mashup : pair.llmScore.transition >= 5 ? QUALITY_COLORS.smooth : 'var(--text-secondary)' }}>{pair.llmScore.transition}/10</strong></span>
                        <span>Mashup: <strong style={{ color: pair.llmScore.mashup >= 7 ? QUALITY_COLORS.mashup : pair.llmScore.mashup >= 5 ? QUALITY_COLORS.smooth : 'var(--text-secondary)' }}>{pair.llmScore.mashup}/10</strong></span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                        {pair.llmScore.reasoning}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Block list */}
      <div style={{ ...styles.blockList, display: viewMode === 'pairs' ? 'none' : undefined }}>
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
  prefBanner: {
    padding: '4px 24px',
    fontSize: 11,
    color: '#ffd700',
    background: 'rgba(255, 215, 0, 0.08)',
    margin: '0 24px 4px',
    borderRadius: 4,
    fontWeight: 600,
  },
  progressBanner: {
    padding: '6px 24px',
    fontSize: 12,
    color: 'var(--accent)',
    fontWeight: 600,
  },
  progressBarOuter: {
    height: 3,
    background: 'var(--bg-tertiary)',
    borderRadius: 2,
    marginBottom: 4,
    overflow: 'hidden',
  },
  progressBarInner: {
    height: '100%',
    background: 'var(--accent)',
    borderRadius: 2,
    transition: 'width 0.3s ease',
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
  // Pair-specific styles
  pairFilters: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    marginBottom: 12,
    flexWrap: 'wrap' as const,
  },
  filterSelect: {
    padding: '4px 8px',
    fontSize: 11,
    borderRadius: 4,
    border: '1px solid var(--border)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
  },
  pairCard: {
    background: 'var(--bg-secondary)',
    borderRadius: 8,
    padding: '8px 14px',
    borderLeft: '4px solid',
    cursor: 'pointer',
    marginBottom: 2,
  },
  pairHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  pairDecade: {
    fontSize: 11,
    fontWeight: 700,
    minWidth: 50,
  },
  pairSongs: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  pairScores: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
    flexShrink: 0,
  },
  pairScoreDetail: {
    fontSize: 10,
    color: 'var(--text-secondary)',
  },
  pairReasoning: {
    fontSize: 10,
    color: 'var(--text-secondary)',
    fontStyle: 'italic',
    marginTop: 4,
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  pairDetailGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    gap: 12,
    alignItems: 'start',
  },
  pairDetailSong: {},
  pairDetailSongTitle: {
    fontSize: 12,
    marginBottom: 4,
  },
  pairDetailMeta: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    fontSize: 11,
    flexWrap: 'wrap' as const,
  },
  pairDetailTransition: {
    padding: '4px 12px',
    borderLeft: '1px solid var(--border)',
    borderRight: '1px solid var(--border)',
    textAlign: 'center' as const,
  },
};
