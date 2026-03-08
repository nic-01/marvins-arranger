/**
 * Block Discovery Algorithm
 *
 * Two-stage process:
 * 1. Find optimal chronological path through selected songs using DP on a DAG
 * 2. Segment the path into blocks based on transition quality
 *
 * The chronological constraint (songs must be in year order, reorderable within
 * a year) makes this a DAG shortest-path problem, which is solvable in O(V+E).
 */

import type { Song } from './types';
import {
  buildPairMatrix,
  scorePair,
  type PairScore,
  type PairMatrix,
} from './transition-scoring';

// ── Types ─────────────────────────────────────────────────────────────────

export interface Block {
  id: string;
  songs: Song[];
  transitions: PairScore[];  // transitions[i] = transition from songs[i] to songs[i+1]
  avgScore: number;          // Average transition quality score (0-100)
  bestTransition: PairScore | null;
  worstTransition: PairScore | null;
  hasMashup: boolean;
  yearRange: [number, number];
}

export interface BlockDiscoveryResult {
  blocks: Block[];
  path: Song[];              // Full ordered song list
  transitions: PairScore[];  // All transitions in order
  totalScore: number;        // Sum of all transition scores
  avgScore: number;          // Average transition score
  skippedSongs: Song[];      // Songs that couldn't fit well
  stats: {
    mashupCount: number;
    smoothCount: number;
    workableCount: number;
    hardCount: number;
    blockCount: number;
    avgBlockSize: number;
  };
}

export interface BlockDiscoveryConfig {
  maxYearGap: number;         // Max years between consecutive songs (default: 3)
  beamWidth: number;          // Beam search width (default: 30)
  minBlockScore: number;      // Min avg score to keep a transition smooth (default: 55)
  maxBlockSize: number;       // Max songs per block (default: 8)
  starredIds: Set<string>;    // Must-include songs
  excludedIds: Set<string>;   // Must-exclude songs
}

export type DiscoveryProgress = {
  stage: 'scoring' | 'pathfinding' | 'segmenting' | 'complete';
  percent: number;
  message: string;
};

const DEFAULT_CONFIG: BlockDiscoveryConfig = {
  maxYearGap: 3,
  beamWidth: 30,
  minBlockScore: 55,
  maxBlockSize: 8,
  starredIds: new Set(),
  excludedIds: new Set(),
};

// ── Path finding (DP on chronological DAG) ────────────────────────────────

interface DPState {
  songIdx: number;
  totalScore: number;
  path: number[];        // Indices into sorted song array
  starredHit: number;    // Count of starred songs included
}

/**
 * Find the optimal chronological path through the songs.
 *
 * Uses beam search on the chronological DAG:
 * - Nodes = songs sorted by year
 * - Edges = valid transitions (same year or +1-3 years forward)
 * - Must include all starred songs
 * - Maximizes total transition score
 */
function findOptimalPath(
  _songs: Song[],
  matrix: PairMatrix,
  config: BlockDiscoveryConfig,
  onProgress?: (p: DiscoveryProgress) => void
): { path: number[]; score: number; skippedIndices: number[] } {
  const sorted = matrix.songs; // Already sorted by year
  const n = sorted.length;

  if (n === 0) return { path: [], score: 0, skippedIndices: [] };
  if (n === 1) return { path: [0], score: 0, skippedIndices: [] };

  // Index starred songs
  const starredIndices = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (config.starredIds.has(sorted[i].id)) {
      starredIndices.add(i);
    }
  }
  // Group songs by year for within-year ordering flexibility
  const yearGroups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const year = sorted[i].year;
    if (!yearGroups.has(year)) yearGroups.set(year, []);
    yearGroups.get(year)!.push(i);
  }
  const years = Array.from(yearGroups.keys()).sort((a, b) => a - b);

  // Beam search: maintain top-K partial paths
  // Start with each song in the earliest year as a potential starting point
  const firstYear = years[0];
  const startIndices = yearGroups.get(firstYear) || [];

  let beam: DPState[] = startIndices.map(idx => ({
    songIdx: idx,
    totalScore: 0,
    path: [idx],
    starredHit: starredIndices.has(idx) ? 1 : 0,
  }));

  // Process year by year
  for (let yi = 0; yi < years.length; yi++) {
    const year = years[yi];
    const nextYears: number[] = [];

    // Collect songs from current year (not yet in path) + next few years
    for (let yj = yi; yj < years.length && years[yj] <= year + config.maxYearGap; yj++) {
      nextYears.push(years[yj]);
    }

    // For each beam state, try extending to each candidate in valid year range
    const nextBeam: DPState[] = [];

    for (const state of beam) {
      const currentYear = sorted[state.songIdx].year;

      // Find all valid next songs
      const candidates: number[] = [];
      for (const ny of nextYears) {
        if (ny < currentYear) continue; // Can't go backwards
        const group = yearGroups.get(ny) || [];
        for (const idx of group) {
          if (state.path.includes(idx)) continue; // Already visited
          candidates.push(idx);
        }
      }

      if (candidates.length === 0) {
        // No more candidates — this path is complete
        nextBeam.push(state);
        continue;
      }

      // Score each candidate and keep the best
      const scored = candidates.map(candIdx => {
        const pair = scorePair(
          sorted[state.songIdx],
          sorted[candIdx],
          state.songIdx,
          candIdx
        );

        const isStarred = starredIndices.has(candIdx);
        // Bonus for starred songs
        const starBonus = isStarred ? 15 : 0;

        return {
          idx: candIdx,
          score: pair.score + starBonus,
          isStarred,
        };
      });

      scored.sort((a, b) => b.score - a.score);

      // Take top branchFactor candidates
      const branchFactor = Math.min(5, scored.length);
      for (let k = 0; k < branchFactor; k++) {
        const cand = scored[k];
        nextBeam.push({
          songIdx: cand.idx,
          totalScore: state.totalScore + cand.score,
          path: [...state.path, cand.idx],
          starredHit: state.starredHit + (cand.isStarred ? 1 : 0),
        });
      }

      // Also keep the current state as-is (don't extend) so we can skip songs
      nextBeam.push(state);
    }

    // Prune beam: prefer paths that hit more starred songs,
    // then by score, normalized by path length
    nextBeam.sort((a, b) => {
      // First priority: starred songs coverage
      if (a.starredHit !== b.starredHit) return b.starredHit - a.starredHit;
      // Second: score per song (normalized)
      const aAvg = a.path.length > 1 ? a.totalScore / (a.path.length - 1) : 0;
      const bAvg = b.path.length > 1 ? b.totalScore / (b.path.length - 1) : 0;
      return bAvg - aAvg;
    });

    beam = nextBeam.slice(0, config.beamWidth);

    if (onProgress) {
      onProgress({
        stage: 'pathfinding',
        percent: Math.round(((yi + 1) / years.length) * 100),
        message: `Processing year ${year} (${yi + 1}/${years.length})`,
      });
    }
  }

  // Select best complete path
  // Must include all starred songs if possible
  beam.sort((a, b) => {
    if (a.starredHit !== b.starredHit) return b.starredHit - a.starredHit;
    // Among equal starred coverage, prefer longer paths with good avg score
    const aAvg = a.path.length > 1 ? a.totalScore / (a.path.length - 1) : 0;
    const bAvg = b.path.length > 1 ? b.totalScore / (b.path.length - 1) : 0;
    if (Math.abs(aAvg - bAvg) < 5) {
      return b.path.length - a.path.length; // Prefer more songs
    }
    return bAvg - aAvg;
  });

  const best = beam[0];
  if (!best) return { path: [], score: 0, skippedIndices: [] };

  // Find skipped songs
  const pathSet = new Set(best.path);
  const skippedIndices = [];
  for (let i = 0; i < n; i++) {
    if (!pathSet.has(i)) skippedIndices.push(i);
  }

  return {
    path: best.path,
    score: best.totalScore,
    skippedIndices,
  };
}

// ── Block segmentation ────────────────────────────────────────────────────

function generateBlockId(): string {
  return 'blk-' + Math.random().toString(36).substring(2, 8);
}

/**
 * Segment an ordered path into blocks based on transition quality.
 * Cuts happen at the weakest transitions (lowest scores).
 */
function segmentIntoBlocks(
  path: number[],
  sorted: Song[],
  config: BlockDiscoveryConfig
): { blocks: Block[]; transitions: PairScore[] } {
  if (path.length === 0) return { blocks: [], transitions: [] };
  if (path.length === 1) {
    return {
      blocks: [{
        id: generateBlockId(),
        songs: [sorted[path[0]]],
        transitions: [],
        avgScore: 100,
        bestTransition: null,
        worstTransition: null,
        hasMashup: false,
        yearRange: [sorted[path[0]].year, sorted[path[0]].year],
      }],
      transitions: [],
    };
  }

  // Score all consecutive transitions
  const transitions: PairScore[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const pair = scorePair(
      sorted[path[i]],
      sorted[path[i + 1]],
      path[i],
      path[i + 1]
    );
    transitions.push(pair);
  }

  // Find natural block boundaries: transitions below minBlockScore
  // or where quality drops to 'hard'
  const cutPoints: number[] = []; // indices into transitions array where we cut

  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];

    // Cut at hard transitions
    if (t.quality === 'hard') {
      cutPoints.push(i);
      continue;
    }

    // Cut at workable transitions that are below threshold
    if (t.score < config.minBlockScore) {
      cutPoints.push(i);
      continue;
    }
  }

  // Also enforce max block size
  const refinedCuts = new Set(cutPoints);
  let lastCut = -1;
  for (let i = 0; i < transitions.length; i++) {
    const blockLen = i - lastCut;
    if (blockLen >= config.maxBlockSize && !refinedCuts.has(i)) {
      // Find the weakest transition in this oversized block to cut at
      let weakest = i;
      let weakestScore = Infinity;
      for (let j = lastCut + 1; j <= i; j++) {
        if (transitions[j].score < weakestScore) {
          weakestScore = transitions[j].score;
          weakest = j;
        }
      }
      refinedCuts.add(weakest);
      lastCut = weakest;
    }
    if (refinedCuts.has(i)) lastCut = i;
  }

  // Build blocks from cut points
  const sortedCuts = Array.from(refinedCuts).sort((a, b) => a - b);
  const blocks: Block[] = [];

  let blockStart = 0;
  for (const cutIdx of [...sortedCuts, transitions.length]) {
    // Block contains songs from blockStart to cutIdx (inclusive)
    const blockSongIndices = path.slice(blockStart, cutIdx + 1);
    const blockTransitions = transitions.slice(blockStart, cutIdx);
    const blockSongs = blockSongIndices.map(i => sorted[i]);

    const avgScore = blockTransitions.length > 0
      ? blockTransitions.reduce((sum, t) => sum + t.score, 0) / blockTransitions.length
      : 100;

    const best = blockTransitions.length > 0
      ? blockTransitions.reduce((a, b) => a.score > b.score ? a : b)
      : null;
    const worst = blockTransitions.length > 0
      ? blockTransitions.reduce((a, b) => a.score < b.score ? a : b)
      : null;

    blocks.push({
      id: generateBlockId(),
      songs: blockSongs,
      transitions: blockTransitions,
      avgScore,
      bestTransition: best,
      worstTransition: worst,
      hasMashup: blockTransitions.some(t => t.quality === 'mashup'),
      yearRange: [
        Math.min(...blockSongs.map(s => s.year)),
        Math.max(...blockSongs.map(s => s.year)),
      ],
    });

    blockStart = cutIdx + 1;
  }

  return { blocks, transitions };
}

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Discover blocks of well-transitioning songs from a catalog.
 *
 * @param catalog - All available songs (filtered by user: starred + open, no deleted)
 * @param config - Configuration options
 * @param onProgress - Progress callback
 */
export function discoverBlocks(
  catalog: Song[],
  config: Partial<BlockDiscoveryConfig> = {},
  onProgress?: (p: DiscoveryProgress) => void
): BlockDiscoveryResult {
  const cfg: BlockDiscoveryConfig = { ...DEFAULT_CONFIG, ...config };

  // Filter out excluded songs
  const available = catalog.filter(s => !cfg.excludedIds.has(s.id));

  if (available.length === 0) {
    return {
      blocks: [],
      path: [],
      transitions: [],
      totalScore: 0,
      avgScore: 0,
      skippedSongs: [],
      stats: {
        mashupCount: 0,
        smoothCount: 0,
        workableCount: 0,
        hardCount: 0,
        blockCount: 0,
        avgBlockSize: 0,
      },
    };
  }

  // Stage 1: Build pair matrix
  if (onProgress) {
    onProgress({ stage: 'scoring', percent: 0, message: 'Scoring song pairs...' });
  }
  const matrix = buildPairMatrix(available, cfg.maxYearGap);

  if (onProgress) {
    onProgress({ stage: 'scoring', percent: 100, message: `Scored ${matrix.pairs.size} pairs` });
  }

  // Stage 2: Find optimal path
  const { path, skippedIndices } = findOptimalPath(
    available,
    matrix,
    cfg,
    onProgress
  );

  // Stage 3: Segment into blocks
  if (onProgress) {
    onProgress({ stage: 'segmenting', percent: 0, message: 'Segmenting into blocks...' });
  }

  const { blocks, transitions } = segmentIntoBlocks(path, matrix.songs, cfg);

  const totalScore = transitions.reduce((sum, t) => sum + t.score, 0);
  const avgScore = transitions.length > 0 ? totalScore / transitions.length : 0;

  const stats = {
    mashupCount: transitions.filter(t => t.quality === 'mashup').length,
    smoothCount: transitions.filter(t => t.quality === 'smooth').length,
    workableCount: transitions.filter(t => t.quality === 'workable').length,
    hardCount: transitions.filter(t => t.quality === 'hard').length,
    blockCount: blocks.length,
    avgBlockSize: blocks.length > 0
      ? blocks.reduce((sum, b) => sum + b.songs.length, 0) / blocks.length
      : 0,
  };

  if (onProgress) {
    onProgress({
      stage: 'complete',
      percent: 100,
      message: `Found ${blocks.length} blocks with ${stats.mashupCount} mashup opportunities`,
    });
  }

  return {
    blocks,
    path: path.map(i => matrix.songs[i]),
    transitions,
    totalScore,
    avgScore,
    skippedSongs: skippedIndices.map(i => matrix.songs[i]),
    stats,
  };
}

// ── Block manipulation helpers ────────────────────────────────────────────

/**
 * Swap two songs within the same year across blocks.
 * Returns updated blocks or null if the swap isn't valid.
 */
export function swapSongsInBlocks(
  blocks: Block[],
  blockAIdx: number,
  songAIdx: number,
  blockBIdx: number,
  songBIdx: number
): Block[] | null {
  const songA = blocks[blockAIdx]?.songs[songAIdx];
  const songB = blocks[blockBIdx]?.songs[songBIdx];
  if (!songA || !songB) return null;

  // Can only swap within the same year
  if (songA.year !== songB.year) return null;

  // Create new blocks with swapped songs
  const newBlocks = blocks.map((b, bi) => {
    const newSongs = [...b.songs];
    if (bi === blockAIdx) newSongs[songAIdx] = songB;
    if (bi === blockBIdx) newSongs[songBIdx] = songA;

    // Rescore transitions
    const newTransitions: PairScore[] = [];
    for (let i = 0; i < newSongs.length - 1; i++) {
      newTransitions.push(scorePair(newSongs[i], newSongs[i + 1], 0, 0));
    }

    const avgScore = newTransitions.length > 0
      ? newTransitions.reduce((sum, t) => sum + t.score, 0) / newTransitions.length
      : 100;

    return {
      ...b,
      songs: newSongs,
      transitions: newTransitions,
      avgScore,
      bestTransition: newTransitions.length > 0
        ? newTransitions.reduce((a, c) => a.score > c.score ? a : c)
        : null,
      worstTransition: newTransitions.length > 0
        ? newTransitions.reduce((a, c) => a.score < c.score ? a : c)
        : null,
      hasMashup: newTransitions.some(t => t.quality === 'mashup'),
      yearRange: [
        Math.min(...newSongs.map(s => s.year)),
        Math.max(...newSongs.map(s => s.year)),
      ] as [number, number],
    };
  });

  return newBlocks;
}

/**
 * Remove a song from a block. If the block becomes empty, remove it.
 */
export function removeSongFromBlock(
  blocks: Block[],
  blockIdx: number,
  songIdx: number
): Block[] {
  const newBlocks = [...blocks];
  const block = { ...newBlocks[blockIdx] };
  block.songs = block.songs.filter((_, i) => i !== songIdx);

  if (block.songs.length === 0) {
    return newBlocks.filter((_, i) => i !== blockIdx);
  }

  // Rescore transitions
  const newTransitions: PairScore[] = [];
  for (let i = 0; i < block.songs.length - 1; i++) {
    newTransitions.push(scorePair(block.songs[i], block.songs[i + 1], 0, 0));
  }

  block.transitions = newTransitions;
  block.avgScore = newTransitions.length > 0
    ? newTransitions.reduce((sum, t) => sum + t.score, 0) / newTransitions.length
    : 100;
  block.bestTransition = newTransitions.length > 0
    ? newTransitions.reduce((a, b) => a.score > b.score ? a : b)
    : null;
  block.worstTransition = newTransitions.length > 0
    ? newTransitions.reduce((a, b) => a.score < b.score ? a : b)
    : null;
  block.hasMashup = newTransitions.some(t => t.quality === 'mashup');
  block.yearRange = [
    Math.min(...block.songs.map(s => s.year)),
    Math.max(...block.songs.map(s => s.year)),
  ];

  newBlocks[blockIdx] = block;
  return newBlocks;
}
