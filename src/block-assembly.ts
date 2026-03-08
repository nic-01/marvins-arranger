/**
 * Block Assembly — Stage 2
 *
 * Takes discovered blocks (per-decade) and assembles them into a full medley:
 * 1. Select the best N blocks per decade (coverage, variety, starred songs)
 * 2. Order blocks within each decade (beam search over block orderings)
 * 3. Optimize block boundaries (simulated annealing on edge songs)
 * 4. Cross-decade transitions (pick/order edge blocks to minimize boundary cost)
 */

import type { Song } from './types';
import { scorePair, type PairScore } from './transition-scoring';
import { scoreTransition } from './compatibility';
import {
  type Block,
  type BlockDiscoveryResult,
  type DecadeBlocks,
  scoreBlockTransition,
} from './block-discovery';

// ── Types ─────────────────────────────────────────────────────────────────

export interface AssemblyConfig {
  /** How many blocks to use per decade */
  blocksPerDecade: Record<string, number>;
  /** Target total medley duration in seconds (default: 48 * 60) */
  targetDuration: number;
  /** Must-include song IDs */
  starredIds: Set<string>;
  /** Simulated annealing iterations for edge optimization */
  annealingIterations: number;
}

export interface AssembledMedley {
  blocks: Block[];                    // Ordered blocks for the full medley
  transitions: PairScore[];           // Block-to-block transitions
  path: Song[];                       // Flat ordered song list
  totalSongs: number;
  estimatedDuration: number;          // seconds
  avgBlockScore: number;              // Avg internal block quality
  avgTransitionScore: number;         // Avg block-to-block transition quality
  stats: {
    blocksUsed: number;
    songsUsed: number;
    mashupBlocks: number;
    crowdMoments: number;
    starredIncluded: number;
    decadeBreakdown: Record<string, { blocks: number; songs: number }>;
  };
}

export type AssemblyProgress = {
  stage: 'selecting' | 'ordering' | 'optimizing' | 'cross_decade' | 'complete';
  percent: number;
  message: string;
};

const DEFAULT_BLOCKS_PER_DECADE: Record<string, number> = {
  'The Sprint': 2,
  '1950s': 2,
  '1960s': 3,
  '1970s': 3,
  '1980s': 4,
  '1990s': 4,
  '2000s': 3,
  '2010s': 4,
  '2020s': 2,
};

const DEFAULT_CONFIG: AssemblyConfig = {
  blocksPerDecade: { ...DEFAULT_BLOCKS_PER_DECADE },
  targetDuration: 48 * 60,
  starredIds: new Set(),
  annealingIterations: 1500,
};

const DECADE_ORDER = [
  'The Sprint', '1950s', '1960s', '1970s', '1980s',
  '1990s', '2000s', '2010s', '2020s',
];

// ── Block selection per decade ────────────────────────────────────────────

interface ScoredBlock {
  block: Block;
  selectionScore: number;
}

/**
 * Select the best N blocks for a decade, ensuring:
 * - At least one block with a crowd moment
 * - Variety of tempos (BPM range coverage)
 * - Starred songs are prioritized
 * - No song appears in more than one selected block
 */
function selectBlocksForDecade(
  decadeBlocks: DecadeBlocks,
  targetCount: number,
  starredIds: Set<string>
): Block[] {
  const { blocks } = decadeBlocks;
  if (blocks.length === 0) return [];
  if (blocks.length <= targetCount) return [...blocks];

  // Score each block for selection priority
  const scored: ScoredBlock[] = blocks.map(block => {
    let selectionScore = block.avgScore;

    // Bonus for crowd moments
    if (block.hasCrowdMoment) selectionScore += 15;

    // Bonus for mashup potential
    if (block.hasMashup) selectionScore += 10;

    // Bonus for starring — big bonus if block contains a starred song
    const starredInBlock = block.songs.filter(s => starredIds.has(s.id)).length;
    selectionScore += starredInBlock * 25;

    // Slight bonus for higher energy blocks (crowd-pleasers)
    selectionScore += block.avgEnergy * 3;

    return { block, selectionScore };
  });

  scored.sort((a, b) => b.selectionScore - a.selectionScore);

  // Greedy selection: take best, remove overlapping, repeat
  const selected: Block[] = [];
  const usedSongIds = new Set<string>();
  let hasCrowdMoment = false;

  for (const { block } of scored) {
    if (selected.length >= targetCount) break;

    // Check for song overlap
    const overlap = block.songs.some(s => usedSongIds.has(s.id));
    if (overlap) continue;

    selected.push(block);
    for (const s of block.songs) usedSongIds.add(s.id);
    if (block.hasCrowdMoment) hasCrowdMoment = true;
  }

  // If we don't have a crowd moment yet and there's room, swap the weakest
  // block for the best crowd-moment block that doesn't overlap
  if (!hasCrowdMoment && selected.length >= targetCount) {
    const crowdBlocks = scored.filter(({ block }) =>
      block.hasCrowdMoment &&
      !selected.some(sel => sel.id === block.id)
    );

    if (crowdBlocks.length > 0) {
      // Find weakest selected block that isn't starred
      const weakestIdx = selected
        .map((b, i) => ({ i, score: b.avgScore, hasStarred: b.songs.some(s => starredIds.has(s.id)) }))
        .filter(x => !x.hasStarred)
        .sort((a, b) => a.score - b.score)[0]?.i;

      if (weakestIdx !== undefined) {
        // Remove weakest's songs from used
        for (const s of selected[weakestIdx].songs) usedSongIds.delete(s.id);

        // Find first crowd block that doesn't overlap with remaining selected
        for (const { block: crowdBlock } of crowdBlocks) {
          const overlapsRemaining = crowdBlock.songs.some(s => usedSongIds.has(s.id));
          if (!overlapsRemaining) {
            selected[weakestIdx] = crowdBlock;
            break;
          }
        }
      }
    }
  }

  return selected;
}

// ── Block ordering within a decade ────────────────────────────────────────

/**
 * Order blocks within a decade to minimize inter-block transition costs.
 * Uses exhaustive search for small N (<=7), greedy for larger.
 */
function orderBlocks(blocks: Block[]): Block[] {
  if (blocks.length <= 1) return blocks;

  if (blocks.length <= 7) {
    return orderBlocksExhaustive(blocks);
  }
  return orderBlocksGreedy(blocks);
}

function orderBlocksExhaustive(blocks: Block[]): Block[] {
  const n = blocks.length;
  let bestOrder: number[] = [];
  let bestCost = Infinity;

  // Generate all permutations
  function permute(arr: number[], start: number) {
    if (start === n) {
      // Score this ordering
      let cost = 0;
      for (let i = 0; i < n - 1; i++) {
        cost += scoreTransition(
          blocks[arr[i]].songs[blocks[arr[i]].songs.length - 1],
          blocks[arr[i + 1]].songs[0]
        ).total;
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestOrder = [...arr];
      }
      return;
    }
    for (let i = start; i < n; i++) {
      [arr[start], arr[i]] = [arr[i], arr[start]];
      permute(arr, start + 1);
      [arr[start], arr[i]] = [arr[i], arr[start]];
    }
  }

  permute(Array.from({ length: n }, (_, i) => i), 0);
  return bestOrder.map(i => blocks[i]);
}

function orderBlocksGreedy(blocks: Block[]): Block[] {
  const remaining = new Set(blocks.map((_, i) => i));
  const order: number[] = [];

  // Start with the block whose entry BPM is most moderate
  // (easiest to transition into from the previous decade)
  let best = 0;
  let bestBpmDist = Infinity;
  for (const i of remaining) {
    const dist = Math.abs(blocks[i].entryBpm - 120);
    if (dist < bestBpmDist) {
      bestBpmDist = dist;
      best = i;
    }
  }

  order.push(best);
  remaining.delete(best);

  while (remaining.size > 0) {
    const lastBlock = blocks[order[order.length - 1]];
    let bestNext = -1;
    let bestCost = Infinity;

    for (const j of remaining) {
      const cost = scoreTransition(
        lastBlock.songs[lastBlock.songs.length - 1],
        blocks[j].songs[0]
      ).total;
      if (cost < bestCost) {
        bestCost = cost;
        bestNext = j;
      }
    }

    order.push(bestNext);
    remaining.delete(bestNext);
  }

  return order.map(i => blocks[i]);
}

// ── Edge optimization (simulated annealing) ───────────────────────────────

/**
 * Optimize transitions between adjacent blocks by trying edge song swaps.
 * Swaps the last song of block A with the first song of block B (and vice versa)
 * using simulated annealing.
 */
function optimizeEdges(
  orderedBlocks: Block[],
  iterations: number
): Block[] {
  if (orderedBlocks.length <= 1) return orderedBlocks;

  // Work with a mutable copy
  let blocks = orderedBlocks.map(b => ({
    ...b,
    songs: [...b.songs],
  }));

  function totalEdgeCost(): number {
    let cost = 0;
    for (let i = 0; i < blocks.length - 1; i++) {
      const lastSong = blocks[i].songs[blocks[i].songs.length - 1];
      const firstSong = blocks[i + 1].songs[0];
      cost += scoreTransition(lastSong, firstSong).total;
    }
    return cost;
  }

  let currentCost = totalEdgeCost();
  let temperature = 50;
  const coolingRate = 0.995;

  for (let iter = 0; iter < iterations; iter++) {
    temperature *= coolingRate;

    // Random move: pick a block boundary
    const boundaryIdx = Math.floor(Math.random() * (blocks.length - 1));
    const blockA = blocks[boundaryIdx];
    const blockB = blocks[boundaryIdx + 1];

    if (blockA.songs.length < 2 || blockB.songs.length < 2) continue;

    // 60% chance: swap last of A with first of B
    // 40% chance: reverse the order of one of the edge blocks
    const moveType = Math.random();

    if (moveType < 0.6) {
      // Swap edge songs
      const songA = blockA.songs[blockA.songs.length - 1];
      const songB = blockB.songs[0];

      blockA.songs[blockA.songs.length - 1] = songB;
      blockB.songs[0] = songA;

      const newCost = totalEdgeCost();
      const delta = newCost - currentCost;

      if (delta < 0 || Math.random() < Math.exp(-delta / temperature)) {
        currentCost = newCost; // Accept
      } else {
        // Revert
        blockA.songs[blockA.songs.length - 1] = songA;
        blockB.songs[0] = songB;
      }
    } else {
      // Reverse order of a random edge block
      const targetIdx = Math.random() < 0.5 ? boundaryIdx : boundaryIdx + 1;
      const original = [...blocks[targetIdx].songs];
      blocks[targetIdx].songs.reverse();

      const newCost = totalEdgeCost();
      const delta = newCost - currentCost;

      if (delta < 0 || Math.random() < Math.exp(-delta / temperature)) {
        currentCost = newCost; // Accept
      } else {
        blocks[targetIdx].songs = original; // Revert
      }
    }
  }

  // Rebuild blocks with proper metadata after mutations
  return blocks.map(b => {
    const transitions: PairScore[] = [];
    for (let i = 0; i < b.songs.length - 1; i++) {
      transitions.push(scorePair(b.songs[i], b.songs[i + 1], 0, 0));
    }

    const avgScore = transitions.length > 0
      ? transitions.reduce((sum, t) => sum + t.score, 0) / transitions.length
      : 100;

    const energyMap = { Low: 0, Medium: 1, High: 2 } as const;
    const avgEnergy = b.songs.reduce((sum, s) => sum + energyMap[s.energy], 0) / b.songs.length;

    return {
      ...b,
      transitions,
      entryBpm: b.songs[0].bpm,
      exitBpm: b.songs[b.songs.length - 1].bpm,
      entryKey: b.songs[0].key,
      exitKey: b.songs[b.songs.length - 1].key,
      avgScore,
      avgEnergy,
      bestTransition: transitions.length > 0
        ? transitions.reduce((a, c) => a.score > c.score ? a : c)
        : null,
      worstTransition: transitions.length > 0
        ? transitions.reduce((a, c) => a.score < c.score ? a : c)
        : null,
      hasMashup: transitions.some(t => t.quality === 'mashup'),
      hasCrowdMoment: b.songs.some(s => s.crowd_singalong),
      yearRange: [
        Math.min(...b.songs.map(s => s.year)),
        Math.max(...b.songs.map(s => s.year)),
      ] as [number, number],
    };
  });
}

// ── Cross-decade boundary optimization ────────────────────────────────────

/**
 * For each pair of adjacent decades, choose which block starts/ends the decade
 * to minimize the cross-decade transition cost. This is done by trying all
 * combinations of last block in decade N and first block in decade N+1.
 */
function optimizeCrossDecadeOrder(
  decadeBlockMap: Map<string, Block[]>
): Block[] {
  const allBlocks: Block[] = [];

  const decadesPresent = DECADE_ORDER.filter(d => decadeBlockMap.has(d) && decadeBlockMap.get(d)!.length > 0);

  for (let di = 0; di < decadesPresent.length; di++) {
    const decade = decadesPresent[di];
    const blocks = decadeBlockMap.get(decade)!;

    if (di === 0) {
      // First decade: just add them in order
      allBlocks.push(...blocks);
      continue;
    }

    // Try to optimize the boundary between previous decade and this one
    const prevBlock = allBlocks[allBlocks.length - 1];

    // Find which block in this decade transitions best FROM the previous decade's last block
    let bestStartIdx = 0;
    let bestCost = Infinity;

    for (let i = 0; i < blocks.length; i++) {
      const cost = scoreTransition(
        prevBlock.songs[prevBlock.songs.length - 1],
        blocks[i].songs[0]
      ).total;
      if (cost < bestCost) {
        bestCost = cost;
        bestStartIdx = i;
      }
    }

    // Reorder: put the best-transitioning block first, keep rest in original order
    const reordered = [
      blocks[bestStartIdx],
      ...blocks.filter((_, i) => i !== bestStartIdx),
    ];
    allBlocks.push(...reordered);
  }

  return allBlocks;
}

// ── Main assembly pipeline ────────────────────────────────────────────────

/**
 * Assemble discovered blocks into a complete medley.
 */
export function assembleBlocks(
  discoveryResult: BlockDiscoveryResult,
  config: Partial<AssemblyConfig> = {},
  onProgress?: (p: AssemblyProgress) => void
): AssembledMedley {
  const cfg: AssemblyConfig = { ...DEFAULT_CONFIG, ...config };

  // Stage 1: Select blocks per decade
  if (onProgress) {
    onProgress({ stage: 'selecting', percent: 0, message: 'Selecting best blocks per decade...' });
  }

  const selectedByDecade = new Map<string, Block[]>();

  for (const decadeBlock of discoveryResult.decadeBlocks) {
    const targetCount = cfg.blocksPerDecade[decadeBlock.decade] || 2;
    const selected = selectBlocksForDecade(decadeBlock, targetCount, cfg.starredIds);
    selectedByDecade.set(decadeBlock.decade, selected);
  }

  if (onProgress) {
    const totalSelected = Array.from(selectedByDecade.values()).reduce((sum, b) => sum + b.length, 0);
    onProgress({
      stage: 'selecting',
      percent: 25,
      message: `Selected ${totalSelected} blocks across all decades`,
    });
  }

  // Stage 2: Order blocks within each decade
  if (onProgress) {
    onProgress({ stage: 'ordering', percent: 30, message: 'Ordering blocks within decades...' });
  }

  for (const [decade, blocks] of selectedByDecade) {
    const ordered = orderBlocks(blocks);
    selectedByDecade.set(decade, ordered);
  }

  // Stage 3: Optimize cross-decade boundaries
  if (onProgress) {
    onProgress({ stage: 'cross_decade', percent: 50, message: 'Optimizing cross-decade transitions...' });
  }

  let assembledBlocks = optimizeCrossDecadeOrder(selectedByDecade);

  // Stage 4: Edge optimization via simulated annealing
  if (onProgress) {
    onProgress({ stage: 'optimizing', percent: 60, message: 'Polishing block boundaries...' });
  }

  assembledBlocks = optimizeEdges(assembledBlocks, cfg.annealingIterations);

  // Compute block-to-block transitions
  const blockTransitions: PairScore[] = [];
  for (let i = 0; i < assembledBlocks.length - 1; i++) {
    blockTransitions.push(scoreBlockTransition(assembledBlocks[i], assembledBlocks[i + 1]));
  }

  // Flatten to song path
  const path = assembledBlocks.flatMap(b => b.songs);

  // Estimate duration (avg snippet_duration of 45s per song)
  const estimatedDuration = path.length * 45;

  // Compute stats
  const avgBlockScore = assembledBlocks.length > 0
    ? assembledBlocks.reduce((sum, b) => sum + b.avgScore, 0) / assembledBlocks.length
    : 0;
  const avgTransitionScore = blockTransitions.length > 0
    ? blockTransitions.reduce((sum, t) => sum + t.score, 0) / blockTransitions.length
    : 0;

  const decadeBreakdown: Record<string, { blocks: number; songs: number }> = {};
  for (const block of assembledBlocks) {
    if (!decadeBreakdown[block.decade]) {
      decadeBreakdown[block.decade] = { blocks: 0, songs: 0 };
    }
    decadeBreakdown[block.decade].blocks++;
    decadeBreakdown[block.decade].songs += block.songs.length;
  }

  const starredIncluded = path.filter(s => cfg.starredIds.has(s.id)).length;

  if (onProgress) {
    onProgress({
      stage: 'complete',
      percent: 100,
      message: `Assembled ${assembledBlocks.length} blocks, ${path.length} songs`,
    });
  }

  return {
    blocks: assembledBlocks,
    transitions: blockTransitions,
    path,
    totalSongs: path.length,
    estimatedDuration,
    avgBlockScore,
    avgTransitionScore,
    stats: {
      blocksUsed: assembledBlocks.length,
      songsUsed: path.length,
      mashupBlocks: assembledBlocks.filter(b => b.hasMashup).length,
      crowdMoments: assembledBlocks.filter(b => b.hasCrowdMoment).length,
      starredIncluded,
      decadeBreakdown,
    },
  };
}
