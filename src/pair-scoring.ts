/**
 * Candidate Pair Generation & LLM Scoring
 *
 * Stage 0 of the block architecture — before growing blocks, we:
 * 1. Generate all candidate pairs within each decade (undirected, max 2yr gap)
 * 2. Score them algorithmically (BPM, key, energy, mashup potential)
 * 3. Send top pairs to LLM for creative/narrative scoring
 * 4. Combine algo + LLM scores into a composite score
 *
 * These scored pairs become the building blocks for chain assembly.
 */

import type { Song } from './types';
import { scorePair, type PairScore } from './transition-scoring';
import { hasApiKey, ensureApiKeyChecked, scorePairBatchLLM, type LLMPairScore } from './llm';

// ── Types ─────────────────────────────────────────────────────────────────

export interface CandidatePair {
  id: string;
  songA: Song;
  songB: Song;
  decade: string;

  // Algorithmic scores (from existing scorePair, best direction)
  algoScore: number;         // 0-100, higher = better
  pairScoreAB: PairScore;    // A → B direction
  pairScoreBA: PairScore;    // B → A direction
  bestDirection: 'AB' | 'BA';

  // LLM scores (filled in after LLM scoring)
  llmScore: LLMPairScore | null;

  // Composite score (algo + LLM blend)
  compositeScore: number;    // 0-100
}

export interface PairDiscoveryResult {
  pairs: CandidatePair[];
  byDecade: Map<string, CandidatePair[]>;
  stats: {
    totalPairs: number;
    pairsPerDecade: Record<string, number>;
    avgAlgoScore: number;
    llmScored: number;
  };
}

export interface PairDiscoveryConfig {
  maxYearGap: number;         // Max year difference between songs (default: 2)
  algoScoreFloor: number;     // Min algo score to keep (default: 40)
  maxPairsPerDecade: number;  // Cap pairs per decade (default: 300)
  topPairsForLLM: number;     // How many top pairs to send to LLM per decade (default: 60)
  llmBatchSize: number;       // Pairs per LLM call (default: 40)
}

export type PairDiscoveryProgress = {
  stage: 'generating' | 'scoring_llm' | 'complete';
  percent: number;
  message: string;
  decade?: string;
};

const DEFAULT_CONFIG: PairDiscoveryConfig = {
  maxYearGap: 2,
  algoScoreFloor: 40,
  maxPairsPerDecade: 300,
  topPairsForLLM: 60,
  llmBatchSize: 40,
};

const DECADE_ORDER = [
  'The Sprint', '1950s', '1960s', '1970s', '1980s',
  '1990s', '2000s', '2010s', '2020s',
];

function getDecadeKey(song: Song): string {
  if (song.year < 1950) return 'The Sprint';
  return `${Math.floor(song.year / 10) * 10}s`;
}

function generatePairId(a: Song, b: Song): string {
  // Consistent ID regardless of order
  const ids = [a.id, b.id].sort();
  return `pair-${ids[0]}-${ids[1]}`;
}

// ── Candidate Pair Generation ─────────────────────────────────────────────

/**
 * Generate all candidate pairs within a decade.
 * Pairs are undirected — we score both directions and keep the best.
 * Songs must be within maxYearGap years of each other.
 */
function generateDecadePairs(
  songs: Song[],
  decade: string,
  config: PairDiscoveryConfig
): CandidatePair[] {
  const pairs: CandidatePair[] = [];
  const seen = new Set<string>();

  // Sort by year for consistent ordering
  const sorted = [...songs].sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const songA = sorted[i];
      const songB = sorted[j];

      // Enforce year gap
      if (Math.abs(songA.year - songB.year) > config.maxYearGap) continue;

      // Avoid duplicates
      const pairId = generatePairId(songA, songB);
      if (seen.has(pairId)) continue;
      seen.add(pairId);

      // Score both directions
      const pairScoreAB = scorePair(songA, songB, i, j);
      const pairScoreBA = scorePair(songB, songA, j, i);

      // Take the best direction's score as the algo score
      const bestDirection = pairScoreAB.score >= pairScoreBA.score ? 'AB' : 'BA';
      const algoScore = Math.max(pairScoreAB.score, pairScoreBA.score);

      // Filter by algo floor
      if (algoScore < config.algoScoreFloor) continue;

      pairs.push({
        id: pairId,
        songA,
        songB,
        decade,
        algoScore,
        pairScoreAB,
        pairScoreBA,
        bestDirection,
        llmScore: null,
        compositeScore: algoScore, // Initially just algo score
      });
    }
  }

  // Sort by algo score descending, cap at max
  pairs.sort((a, b) => b.algoScore - a.algoScore);
  return pairs.slice(0, config.maxPairsPerDecade);
}

// ── LLM Scoring ───────────────────────────────────────────────────────────

/**
 * Score top pairs with LLM in batches.
 * Updates pairs in-place with llmScore and compositeScore.
 */
async function scorePairsLLM(
  pairs: CandidatePair[],
  config: PairDiscoveryConfig,
  onProgress?: (message: string) => void
): Promise<void> {
  if (!hasApiKey()) return;

  // Take top N pairs for LLM scoring
  const topPairs = pairs.slice(0, config.topPairsForLLM);
  if (topPairs.length === 0) return;

  // Batch into groups
  const batches: CandidatePair[][] = [];
  for (let i = 0; i < topPairs.length; i += config.llmBatchSize) {
    batches.push(topPairs.slice(i, i + config.llmBatchSize));
  }

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    onProgress?.(`Scoring batch ${bi + 1}/${batches.length} (${batch.length} pairs)...`);

    try {
      const llmScores = await scorePairBatchLLM(batch);

      // Match LLM scores back to pairs
      for (const llmScore of llmScores) {
        const pair = batch.find(p =>
          (p.songA.title === llmScore.songATitle && p.songB.title === llmScore.songBTitle) ||
          (p.songA.title === llmScore.songBTitle && p.songB.title === llmScore.songATitle)
        );
        if (pair) {
          pair.llmScore = llmScore;
          // Composite: 40% algo + 60% LLM (LLM scores are 1-10, normalize to 0-100)
          const llmNormalized = (
            (llmScore.narrative + llmScore.transition + llmScore.mashup) / 3
          ) * 10;
          pair.compositeScore = Math.round(
            pair.algoScore * 0.4 + llmNormalized * 0.6
          );
        }
      }
    } catch (err) {
      console.warn(`LLM pair scoring batch ${bi + 1} failed:`, err);
      // Pairs keep their algo-only composite scores
    }
  }
}

// ── Main Entry Point ──────────────────────────────────────────────────────

/**
 * Discover and score candidate pairs from the medley catalog.
 *
 * @param catalog - Songs selected for the medley
 * @param config - Discovery configuration
 * @param onProgress - Progress callback
 * @returns Scored candidate pairs organized by decade
 */
export async function discoverPairs(
  catalog: Song[],
  config: Partial<PairDiscoveryConfig> = {},
  options: {
    excludedIds?: Set<string>;
    skipLLM?: boolean;
  } = {},
  onProgress?: (p: PairDiscoveryProgress) => void
): Promise<PairDiscoveryResult> {
  const cfg: PairDiscoveryConfig = { ...DEFAULT_CONFIG, ...config };
  const { excludedIds = new Set(), skipLLM = false } = options;

  // Filter out excluded songs
  const available = catalog.filter(s => !excludedIds.has(s.id));

  // Group by decade
  const byDecade = new Map<string, Song[]>();
  for (const song of available) {
    const decade = getDecadeKey(song);
    if (!byDecade.has(decade)) byDecade.set(decade, []);
    byDecade.get(decade)!.push(song);
  }

  const allPairs: CandidatePair[] = [];
  const pairsByDecade = new Map<string, CandidatePair[]>();
  const pairsPerDecade: Record<string, number> = {};

  // Generate pairs per decade
  const decades = DECADE_ORDER.filter(d => byDecade.has(d));
  for (let di = 0; di < decades.length; di++) {
    const decade = decades[di];
    const songs = byDecade.get(decade)!;

    onProgress?.({
      stage: 'generating',
      percent: Math.round((di / decades.length) * 40),
      message: `Generating pairs in ${decade} (${songs.length} songs)...`,
      decade,
    });

    const pairs = generateDecadePairs(songs, decade, cfg);
    pairsByDecade.set(decade, pairs);
    allPairs.push(...pairs);
    pairsPerDecade[decade] = pairs.length;
  }

  // LLM scoring
  const apiKeyReady = !skipLLM && allPairs.length > 0 && await ensureApiKeyChecked();
  if (apiKeyReady) {
    onProgress?.({
      stage: 'scoring_llm',
      percent: 45,
      message: 'Sending top pairs to LLM for scoring...',
    });

    // Score per decade so LLM has decade context
    for (let di = 0; di < decades.length; di++) {
      const decade = decades[di];
      const decadePairs = pairsByDecade.get(decade) || [];
      if (decadePairs.length === 0) continue;

      const pct = 45 + Math.round((di / decades.length) * 50);
      onProgress?.({
        stage: 'scoring_llm',
        percent: pct,
        message: `LLM scoring ${decade} pairs...`,
        decade,
      });

      await scorePairsLLM(decadePairs, cfg, (msg) => {
        onProgress?.({
          stage: 'scoring_llm',
          percent: pct,
          message: `${decade}: ${msg}`,
          decade,
        });
      });
    }

    // Re-sort all pairs by composite score
    allPairs.sort((a, b) => b.compositeScore - a.compositeScore);
  }

  const avgAlgoScore = allPairs.length > 0
    ? Math.round(allPairs.reduce((sum, p) => sum + p.algoScore, 0) / allPairs.length)
    : 0;

  onProgress?.({
    stage: 'complete',
    percent: 100,
    message: `Found ${allPairs.length} candidate pairs across ${decades.length} decades`,
  });

  return {
    pairs: allPairs,
    byDecade: pairsByDecade,
    stats: {
      totalPairs: allPairs.length,
      pairsPerDecade,
      avgAlgoScore,
      llmScored: allPairs.filter(p => p.llmScore !== null).length,
    },
  };
}
