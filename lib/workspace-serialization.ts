/**
 * Serialization helpers for persisting BlockGenerator workspace state to Turso.
 *
 * The computed results reference Song objects from the static catalog,
 * so we store song IDs and rehydrate from the catalog on load.
 * Maps are serialized as [key, value][] arrays.
 */

import type { Song } from './types';
import type { PairScore } from './transition-scoring';
import type { CandidatePair, PairDiscoveryResult } from './pair-scoring';
import type { Block, BlockDiscoveryResult } from './block-discovery';
import type { AssembledMedley } from './block-assembly';

// ── Pair Discovery Result ──────────────────────────────────────────────────

export function serializePairResult(result: PairDiscoveryResult): string {
  return JSON.stringify({
    pairs: result.pairs.map(serializeCandidatePair),
    stats: result.stats,
  });
}

export function deserializePairResult(
  json: string,
  songMap: Map<string, Song>,
): PairDiscoveryResult | null {
  try {
    const data = JSON.parse(json);
    const pairs: CandidatePair[] = [];

    for (const p of data.pairs) {
      const pair = deserializeCandidatePair(p, songMap);
      if (pair) pairs.push(pair);
    }

    // Rebuild byDecade map from pairs
    const byDecade = new Map<string, CandidatePair[]>();
    for (const pair of pairs) {
      const existing = byDecade.get(pair.decade) || [];
      existing.push(pair);
      byDecade.set(pair.decade, existing);
    }

    return { pairs, byDecade, stats: data.stats };
  } catch {
    return null;
  }
}

// ── Block Discovery Result ─────────────────────────────────────────────────

export function serializeDiscoveryResult(result: BlockDiscoveryResult): string {
  return JSON.stringify({
    decadeBlocks: result.decadeBlocks.map(db => ({
      decade: db.decade,
      blocks: db.blocks.map(serializeBlock),
      songCount: db.songCount,
      blocksGenerated: db.blocksGenerated,
    })),
    allBlocks: result.allBlocks.map(serializeBlock),
    stats: result.stats,
  });
}

export function deserializeDiscoveryResult(
  json: string,
  songMap: Map<string, Song>,
): BlockDiscoveryResult | null {
  try {
    const data = JSON.parse(json);
    const allBlocks: Block[] = [];
    const decadeBlocks: BlockDiscoveryResult['decadeBlocks'] = [];

    for (const db of data.decadeBlocks) {
      const blocks: Block[] = [];
      for (const b of db.blocks) {
        const block = deserializeBlock(b, songMap);
        if (block) blocks.push(block);
      }
      decadeBlocks.push({ decade: db.decade, blocks, songCount: db.songCount, blocksGenerated: db.blocksGenerated });
    }

    for (const b of data.allBlocks) {
      const block = deserializeBlock(b, songMap);
      if (block) allBlocks.push(block);
    }

    return { decadeBlocks, allBlocks, stats: data.stats };
  } catch {
    return null;
  }
}

// ── Assembled Medley ───────────────────────────────────────────────────────

export function serializeAssembly(result: AssembledMedley): string {
  return JSON.stringify({
    blocks: result.blocks.map(serializeBlock),
    transitions: result.transitions,
    path: result.path.map(s => s.id),
    totalSongs: result.totalSongs,
    estimatedDuration: result.estimatedDuration,
    avgBlockScore: result.avgBlockScore,
    avgTransitionScore: result.avgTransitionScore,
    stats: result.stats,
  });
}

export function deserializeAssembly(
  json: string,
  songMap: Map<string, Song>,
): AssembledMedley | null {
  try {
    const data = JSON.parse(json);
    const blocks: Block[] = [];
    for (const b of data.blocks) {
      const block = deserializeBlock(b, songMap);
      if (block) blocks.push(block);
    }

    const path: Song[] = [];
    for (const id of data.path) {
      const song = songMap.get(id);
      if (song) path.push(song);
    }

    return {
      blocks,
      transitions: data.transitions,
      path,
      totalSongs: data.totalSongs,
      estimatedDuration: data.estimatedDuration,
      avgBlockScore: data.avgBlockScore,
      avgTransitionScore: data.avgTransitionScore,
      stats: data.stats,
    };
  } catch {
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function serializeCandidatePair(pair: CandidatePair) {
  return {
    id: pair.id,
    songAId: pair.songA.id,
    songBId: pair.songB.id,
    decade: pair.decade,
    algoScore: pair.algoScore,
    pairScoreAB: pair.pairScoreAB,
    pairScoreBA: pair.pairScoreBA,
    bestDirection: pair.bestDirection,
    llmScore: pair.llmScore,
    compositeScore: pair.compositeScore,
  };
}

function deserializeCandidatePair(
  data: ReturnType<typeof serializeCandidatePair>,
  songMap: Map<string, Song>,
): CandidatePair | null {
  const songA = songMap.get(data.songAId);
  const songB = songMap.get(data.songBId);
  if (!songA || !songB) return null;

  // Rehydrate song references in PairScore objects
  const pairScoreAB = rehydratePairScore(data.pairScoreAB, songMap);
  const pairScoreBA = rehydratePairScore(data.pairScoreBA, songMap);

  return {
    id: data.id,
    songA,
    songB,
    decade: data.decade,
    algoScore: data.algoScore,
    pairScoreAB,
    pairScoreBA,
    bestDirection: data.bestDirection,
    llmScore: data.llmScore,
    compositeScore: data.compositeScore,
  };
}

function serializeBlock(block: Block) {
  return {
    id: block.id,
    songIds: block.songs.map(s => s.id),
    decade: block.decade,
    transitions: block.transitions,
    entryBpm: block.entryBpm,
    exitBpm: block.exitBpm,
    entryKey: block.entryKey,
    exitKey: block.exitKey,
    avgScore: block.avgScore,
    totalCost: block.totalCost,
    avgEnergy: block.avgEnergy,
    bestTransition: block.bestTransition,
    worstTransition: block.worstTransition,
    hasMashup: block.hasMashup,
    hasCrowdMoment: block.hasCrowdMoment,
    yearRange: block.yearRange,
  };
}

function deserializeBlock(
  data: ReturnType<typeof serializeBlock>,
  songMap: Map<string, Song>,
): Block | null {
  const songs: Song[] = [];
  for (const id of data.songIds) {
    const song = songMap.get(id);
    if (!song) return null; // Can't reconstruct block with missing songs
    songs.push(song);
  }

  const fallbackYearRange: [number, number] = [
    Math.min(...songs.map(s => s.year)),
    Math.max(...songs.map(s => s.year)),
  ];

  return {
    id: data.id,
    songs,
    decade: data.decade,
    transitions: (data.transitions || []).map((t: PairScore) => rehydratePairScore(t, songMap)),
    entryBpm: data.entryBpm,
    exitBpm: data.exitBpm,
    entryKey: data.entryKey,
    exitKey: data.exitKey,
    avgScore: data.avgScore,
    totalCost: data.totalCost,
    avgEnergy: data.avgEnergy,
    bestTransition: data.bestTransition ? rehydratePairScore(data.bestTransition, songMap) : null,
    worstTransition: data.worstTransition ? rehydratePairScore(data.worstTransition, songMap) : null,
    hasMashup: data.hasMashup,
    hasCrowdMoment: data.hasCrowdMoment,
    yearRange: data.yearRange ?? fallbackYearRange,
  };
}

/** PairScore stores song references — rehydrate them from catalog */
function rehydratePairScore(ps: PairScore, songMap: Map<string, Song>): PairScore {
  if (!ps) return ps;
  const from = ps.from?.id ? songMap.get(ps.from.id) || ps.from : ps.from;
  const to = ps.to?.id ? songMap.get(ps.to.id) || ps.to : ps.to;
  return { ...ps, from, to };
}
