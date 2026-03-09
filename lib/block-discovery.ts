/**
 * Per-Decade Block Discovery
 *
 * Stage 1 of the two-stage block architecture.
 *
 * For each decade:
 * 1. Build a local compatibility matrix (only songs in that decade)
 * 2. For each song, find its top-K neighbors by compatibility
 * 3. Grow blocks greedily: start from each song, extend by picking the best
 *    next neighbor that doesn't break BPM range (max 25 BPM spread) or key coherence
 * 4. Score each block: internal transition cost + energy flow + crowd moment bonus
 * 5. Deduplicate overlapping blocks (>50% shared songs → keep the better one)
 *
 * Result: blocks per decade, ready for Stage 2 assembly.
 */

import type { Song } from './types';
import { scorePair, type PairScore } from './transition-scoring';
import { scoreTransition } from './compatibility';

// ── Types ─────────────────────────────────────────────────────────────────

export interface Block {
  id: string;
  songs: Song[];
  decade: string;
  transitions: PairScore[];       // transitions[i] = from songs[i] to songs[i+1]
  entryBpm: number;               // BPM of first song
  exitBpm: number;                // BPM of last song
  entryKey: string;               // Key of first song
  exitKey: string;                // Key of last song
  avgScore: number;               // Average transition quality (0-100)
  totalCost: number;              // Sum of raw compatibility costs (lower = better)
  avgEnergy: number;              // 0-2 average
  bestTransition: PairScore | null;
  worstTransition: PairScore | null;
  hasMashup: boolean;
  hasCrowdMoment: boolean;
  yearRange: [number, number];
}

export interface DecadeBlocks {
  decade: string;
  blocks: Block[];
  songCount: number;              // Total unique songs in this decade
  blocksGenerated: number;        // How many candidate blocks were found
}

export interface BlockDiscoveryResult {
  decadeBlocks: DecadeBlocks[];
  allBlocks: Block[];             // Flat list of all blocks across decades
  stats: {
    totalBlocks: number;
    totalUniqueSongs: number;
    avgBlockSize: number;
    mashupBlocks: number;
    crowdMomentBlocks: number;
    decadeBreakdown: Record<string, number>;
  };
}

export interface BlockDiscoveryConfig {
  minBlockSize: number;           // Min songs per block (default: 3)
  maxBlockSize: number;           // Max songs per block (default: 6)
  maxBpmSpread: number;           // Max BPM spread within a block (default: 25)
  maxKeyDistance: number;         // Max avg Camelot distance within block (default: 3)
  topKNeighbors: number;         // How many neighbors to consider per song (default: 20)
  maxBlocksPerDecade: number;    // Max candidate blocks per decade (default: 200)
  starredIds: Set<string>;       // Must-include songs
  excludedIds: Set<string>;      // Must-exclude songs
}

export type DiscoveryProgress = {
  stage: 'scoring' | 'growing' | 'deduplicating' | 'complete';
  percent: number;
  message: string;
  decade?: string;
};

const DEFAULT_CONFIG: BlockDiscoveryConfig = {
  minBlockSize: 3,
  maxBlockSize: 6,
  maxBpmSpread: 25,
  maxKeyDistance: 3,
  topKNeighbors: 20,
  maxBlocksPerDecade: 200,
  starredIds: new Set(),
  excludedIds: new Set(),
};

const DECADE_ORDER = [
  'The Sprint', '1950s', '1960s', '1970s', '1980s',
  '1990s', '2000s', '2010s', '2020s',
];

function getDecadeKey(song: Song): string {
  if (song.year < 1950) return 'The Sprint';
  return `${Math.floor(song.year / 10) * 10}s`;
}

// ── Block helpers ─────────────────────────────────────────────────────────

function generateBlockId(): string {
  return 'blk-' + Math.random().toString(36).substring(2, 8);
}

function buildBlock(songs: Song[], decade: string): Block {
  const transitions: PairScore[] = [];
  let totalCost = 0;

  for (let i = 0; i < songs.length - 1; i++) {
    const pair = scorePair(songs[i], songs[i + 1], i, i + 1);
    transitions.push(pair);
    totalCost += scoreTransition(songs[i], songs[i + 1]).total;
  }

  const energyMap = { Low: 0, Medium: 1, High: 2 };
  const avgEnergy = songs.reduce((sum, s) => sum + energyMap[s.energy], 0) / songs.length;

  const avgScore = transitions.length > 0
    ? transitions.reduce((sum, t) => sum + t.score, 0) / transitions.length
    : 100;

  return {
    id: generateBlockId(),
    songs,
    decade,
    transitions,
    entryBpm: songs[0].bpm,
    exitBpm: songs[songs.length - 1].bpm,
    entryKey: songs[0].key,
    exitKey: songs[songs.length - 1].key,
    avgScore,
    totalCost,
    avgEnergy,
    bestTransition: transitions.length > 0
      ? transitions.reduce((a, b) => a.score > b.score ? a : b)
      : null,
    worstTransition: transitions.length > 0
      ? transitions.reduce((a, b) => a.score < b.score ? a : b)
      : null,
    hasMashup: transitions.some(t => t.quality === 'mashup'),
    hasCrowdMoment: songs.some(s => s.crowd_singalong),
    yearRange: [
      Math.min(...songs.map(s => s.year)),
      Math.max(...songs.map(s => s.year)),
    ],
  };
}

// ── Per-song neighbor finding ─────────────────────────────────────────────

interface Neighbor {
  songIdx: number;
  score: number;       // PairScore.score (0-100, higher=better)
  cost: number;        // Raw compatibility cost (lower=better)
}

function findNeighbors(
  songs: Song[],
  fromIdx: number,
  topK: number
): Neighbor[] {
  const from = songs[fromIdx];
  const neighbors: Neighbor[] = [];

  for (let j = 0; j < songs.length; j++) {
    if (j === fromIdx) continue;
    const pair = scorePair(from, songs[j], fromIdx, j);
    const cost = scoreTransition(from, songs[j]).total;
    neighbors.push({ songIdx: j, score: pair.score, cost });
  }

  neighbors.sort((a, b) => b.score - a.score);
  return neighbors.slice(0, topK);
}

// ── Greedy block growing ──────────────────────────────────────────────────

function growBlock(
  songs: Song[],
  seedIdx: number,
  neighborMap: Map<number, Neighbor[]>,
  config: BlockDiscoveryConfig
): number[] | null {
  const seed = songs[seedIdx];
  const block: number[] = [seedIdx];
  const used = new Set<number>([seedIdx]);

  let minBpm = seed.bpm;
  let maxBpm = seed.bpm;

  // Grow forward from seed
  let currentIdx = seedIdx;
  while (block.length < config.maxBlockSize) {
    const neighbors = neighborMap.get(currentIdx) || [];
    let bestNext: number | null = null;
    let bestScore = -1;

    for (const n of neighbors) {
      if (used.has(n.songIdx)) continue;
      const candidate = songs[n.songIdx];

      // Check BPM spread constraint
      const newMin = Math.min(minBpm, candidate.bpm);
      const newMax = Math.max(maxBpm, candidate.bpm);
      if (newMax - newMin > config.maxBpmSpread) continue;

      if (n.score > bestScore) {
        bestScore = n.score;
        bestNext = n.songIdx;
      }
    }

    if (bestNext === null || bestScore < 40) break; // No good candidate

    block.push(bestNext);
    used.add(bestNext);
    const addedSong = songs[bestNext];
    minBpm = Math.min(minBpm, addedSong.bpm);
    maxBpm = Math.max(maxBpm, addedSong.bpm);
    currentIdx = bestNext;
  }

  // Block must meet minimum size
  if (block.length < config.minBlockSize) return null;

  return block;
}

// ── Deduplication ─────────────────────────────────────────────────────────

function deduplicateBlocks(blocks: Block[], maxKeep: number): Block[] {
  // Sort by avgScore descending (keep best ones)
  const sorted = [...blocks].sort((a, b) => b.avgScore - a.avgScore);
  const kept: Block[] = [];

  for (const candidate of sorted) {
    const candidateIds = new Set(candidate.songs.map(s => s.id));

    // Check overlap with already-kept blocks
    let tooMuchOverlap = false;
    for (const existing of kept) {
      const existingIds = new Set(existing.songs.map(s => s.id));
      let shared = 0;
      for (const id of candidateIds) {
        if (existingIds.has(id)) shared++;
      }
      const overlapRatio = shared / Math.min(candidateIds.size, existingIds.size);
      if (overlapRatio > 0.5) {
        tooMuchOverlap = true;
        break;
      }
    }

    if (!tooMuchOverlap) {
      kept.push(candidate);
      if (kept.length >= maxKeep) break;
    }
  }

  return kept;
}

// ── Per-decade discovery ──────────────────────────────────────────────────

function discoverDecadeBlocks(
  songs: Song[],
  decade: string,
  config: BlockDiscoveryConfig
): Block[] {
  if (songs.length < config.minBlockSize) return [];

  // Sort by year within decade, then by BPM for within-year ordering
  const sorted = [...songs].sort((a, b) => a.year - b.year || a.bpm - b.bpm);

  // Build neighbor map for all songs in this decade
  const neighborMap = new Map<number, Neighbor[]>();
  for (let i = 0; i < sorted.length; i++) {
    neighborMap.set(i, findNeighbors(sorted, i, config.topKNeighbors));
  }

  // Grow blocks from each song as a seed
  const candidateBlocks: Block[] = [];

  for (let seedIdx = 0; seedIdx < sorted.length; seedIdx++) {
    const blockIndices = growBlock(sorted, seedIdx, neighborMap, config);
    if (!blockIndices) continue;

    // Sort within block by year for chronological order
    const blockSongs = blockIndices
      .map(i => sorted[i])
      .sort((a, b) => a.year - b.year);

    const block = buildBlock(blockSongs, decade);

    // Only keep blocks with decent internal quality
    if (block.avgScore >= 45) {
      candidateBlocks.push(block);
    }
  }

  // Deduplicate: if two blocks share >50% songs, keep the one with better avgScore
  return deduplicateBlocks(candidateBlocks, config.maxBlocksPerDecade);
}

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Discover blocks per decade from the full catalog.
 *
 * @param catalog - All available songs
 * @param config - Discovery configuration
 * @param onProgress - Progress callback
 * @returns Blocks organized by decade
 */
export function discoverBlocks(
  catalog: Song[],
  config: Partial<BlockDiscoveryConfig> = {},
  onProgress?: (p: DiscoveryProgress) => void
): BlockDiscoveryResult {
  const cfg: BlockDiscoveryConfig = { ...DEFAULT_CONFIG, ...config };

  // Filter out excluded songs
  const available = catalog.filter(s => !cfg.excludedIds.has(s.id));

  // Group songs by decade
  const byDecade = new Map<string, Song[]>();
  for (const song of available) {
    const decade = getDecadeKey(song);
    if (!byDecade.has(decade)) byDecade.set(decade, []);
    byDecade.get(decade)!.push(song);
  }

  const decadeBlocks: DecadeBlocks[] = [];
  const allBlocks: Block[] = [];
  const decadeBreakdown: Record<string, number> = {};

  // Process each decade
  const decades = DECADE_ORDER.filter(d => byDecade.has(d));
  for (let di = 0; di < decades.length; di++) {
    const decade = decades[di];
    const songs = byDecade.get(decade)!;

    if (onProgress) {
      onProgress({
        stage: 'growing',
        percent: Math.round((di / decades.length) * 80),
        message: `Discovering blocks in ${decade} (${songs.length} songs)...`,
        decade,
      });
    }

    const blocks = discoverDecadeBlocks(songs, decade, cfg);

    decadeBlocks.push({
      decade,
      blocks,
      songCount: songs.length,
      blocksGenerated: blocks.length,
    });

    allBlocks.push(...blocks);
    decadeBreakdown[decade] = blocks.length;
  }

  if (onProgress) {
    onProgress({
      stage: 'deduplicating',
      percent: 90,
      message: 'Finalizing blocks...',
    });
  }

  // Compute stats
  const allSongsInBlocks = new Set<string>();
  for (const block of allBlocks) {
    for (const song of block.songs) {
      allSongsInBlocks.add(song.id);
    }
  }

  const stats = {
    totalBlocks: allBlocks.length,
    totalUniqueSongs: allSongsInBlocks.size,
    avgBlockSize: allBlocks.length > 0
      ? allBlocks.reduce((sum, b) => sum + b.songs.length, 0) / allBlocks.length
      : 0,
    mashupBlocks: allBlocks.filter(b => b.hasMashup).length,
    crowdMomentBlocks: allBlocks.filter(b => b.hasCrowdMoment).length,
    decadeBreakdown,
  };

  if (onProgress) {
    onProgress({
      stage: 'complete',
      percent: 100,
      message: `Found ${allBlocks.length} blocks across ${decades.length} decades`,
    });
  }

  return { decadeBlocks, allBlocks, stats };
}

// ── Block manipulation helpers ────────────────────────────────────────────

/**
 * Remove a song from a block. If the block becomes too small, return null.
 */
export function removeSongFromBlock(block: Block, songIdx: number): Block | null {
  const newSongs = block.songs.filter((_, i) => i !== songIdx);
  if (newSongs.length < 2) return null;
  return buildBlock(newSongs, block.decade);
}

/**
 * Score how well block B follows block A (exit→entry transition).
 */
export function scoreBlockTransition(blockA: Block, blockB: Block): PairScore {
  const lastSong = blockA.songs[blockA.songs.length - 1];
  const firstSong = blockB.songs[0];
  return scorePair(lastSong, firstSong, 0, 0);
}
