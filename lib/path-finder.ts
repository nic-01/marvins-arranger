/**
 * Beam Search Path Finder
 *
 * Finds optimal paths through the song catalog respecting:
 * - Chronological order (by year, flexible within year)
 * - Duration budgets per decade
 * - Energy arc shaping
 * - Pinned (must-include) songs
 * - Transition quality (compatibility scores)
 */

import type { Song } from './types';
import { buildCompatibilityMatrix, getScore, type CompatibilityMatrix } from './compatibility';

// ── Configuration ───────────────────────────────────────────────────────────

export interface GenerationConfig {
  /** Songs that MUST appear in the medley */
  pinnedSongIds: Set<string>;

  /** Target total duration in seconds (default: 48 * 60 = 2880) */
  targetDuration: number;

  /** Target songs per decade (guides density) */
  songsPerDecade: Record<string, number>;

  /** Energy arc: target energy at each percentage through the medley */
  energyArc: EnergyArcPoint[];

  /** Beam width: how many candidate paths to maintain (default: 50) */
  beamWidth: number;

  /** Max songs to consider as successors at each step (default: 15) */
  branchFactor: number;
}

export interface EnergyArcPoint {
  /** Position in medley (0-1) */
  position: number;
  /** Target energy (0=Low, 1=Medium, 2=High) */
  energy: number;
}

// Default energy arc: build → dip → peak → cool → finale
const DEFAULT_ENERGY_ARC: EnergyArcPoint[] = [
  { position: 0.00, energy: 2.0 },  // Start high (The Sprint)
  { position: 0.10, energy: 1.5 },  // Settle into 50s
  { position: 0.25, energy: 1.0 },  // Dip for contrast
  { position: 0.40, energy: 1.5 },  // Build through 70s
  { position: 0.55, energy: 2.0 },  // Peak 80s energy
  { position: 0.65, energy: 1.5 },  // 90s groove
  { position: 0.75, energy: 1.8 },  // 2000s build
  { position: 0.85, energy: 2.0 },  // 2010s peak
  { position: 0.95, energy: 2.0 },  // Grand finale
  { position: 1.00, energy: 1.5 },  // Cool landing
];

const DEFAULT_SONGS_PER_DECADE: Record<string, number> = {
  'The Sprint': 8,
  '1950s': 5,
  '1960s': 7,
  '1970s': 8,
  '1980s': 10,
  '1990s': 10,
  '2000s': 8,
  '2010s': 10,
  '2020s': 5,
};

export function getDefaultConfig(): GenerationConfig {
  return {
    pinnedSongIds: new Set(),
    targetDuration: 48 * 60,
    songsPerDecade: { ...DEFAULT_SONGS_PER_DECADE },
    energyArc: [...DEFAULT_ENERGY_ARC],
    beamWidth: 50,
    branchFactor: 15,
  };
}

// ── Decade helpers ──────────────────────────────────────────────────────────

interface DecadeBucket {
  label: string;
  sortKey: number;
  songIndices: number[];  // indices into the catalog
  targetCount: number;
}

function getDecadeLabel(year: number): string {
  if (year < 1950) return 'The Sprint';
  return `${Math.floor(year / 10) * 10}s`;
}

function getDecadeSortKey(year: number): number {
  if (year < 1950) return 0;
  return Math.floor(year / 10) * 10;
}

function buildDecadeBuckets(
  songs: Song[],
  config: GenerationConfig
): DecadeBucket[] {
  const bucketMap = new Map<string, DecadeBucket>();

  for (let i = 0; i < songs.length; i++) {
    const label = getDecadeLabel(songs[i].year);
    const sortKey = getDecadeSortKey(songs[i].year);

    if (!bucketMap.has(label)) {
      bucketMap.set(label, {
        label,
        sortKey,
        songIndices: [],
        targetCount: config.songsPerDecade[label] || 6,
      });
    }
    bucketMap.get(label)!.songIndices.push(i);
  }

  return Array.from(bucketMap.values()).sort((a, b) => a.sortKey - b.sortKey);
}

// ── Energy arc scoring ──────────────────────────────────────────────────────

const ENERGY_MAP: Record<string, number> = { Low: 0, Medium: 1, High: 2 };

function getTargetEnergy(arc: EnergyArcPoint[], position: number): number {
  if (position <= arc[0].position) return arc[0].energy;
  if (position >= arc[arc.length - 1].position) return arc[arc.length - 1].energy;

  for (let i = 0; i < arc.length - 1; i++) {
    if (position >= arc[i].position && position <= arc[i + 1].position) {
      const t = (position - arc[i].position) / (arc[i + 1].position - arc[i].position);
      return arc[i].energy + t * (arc[i + 1].energy - arc[i].energy);
    }
  }
  return 1; // fallback: medium
}

function energyArcPenalty(
  songEnergy: string,
  position: number,
  arc: EnergyArcPoint[]
): number {
  const actual = ENERGY_MAP[songEnergy] ?? 1;
  const target = getTargetEnergy(arc, position);
  const diff = Math.abs(actual - target);
  return diff * 8; // 0-16 penalty
}

// ── Beam search state ───────────────────────────────────────────────────────

interface BeamPath {
  /** Indices of selected songs (into the catalog array) */
  songIndices: number[];
  /** Total compatibility cost so far */
  totalCost: number;
  /** Songs selected per decade so far */
  decadeCounts: Map<string, number>;
  /** Estimated total duration so far (seconds, rough) */
  estimatedDuration: number;
}

function clonePath(p: BeamPath): BeamPath {
  return {
    songIndices: [...p.songIndices],
    totalCost: p.totalCost,
    decadeCounts: new Map(p.decadeCounts),
    estimatedDuration: p.estimatedDuration,
  };
}

// ── Beam search implementation ──────────────────────────────────────────────

export interface PathFinderResult {
  /** Multiple candidate paths, ranked by quality */
  paths: GeneratedPath[];
  /** The compatibility matrix used */
  matrix: CompatibilityMatrix;
}

export interface GeneratedPath {
  songIndices: number[];
  totalCost: number;
  songCount: number;
  estimatedDuration: number;
}

/**
 * Run beam search to find optimal medley paths through the catalog.
 *
 * Algorithm:
 * 1. Process decades in chronological order
 * 2. For each decade, select songs using beam search
 * 3. Within a decade, order is flexible (pick best transitions)
 * 4. Between decades, optimize boundary transitions
 * 5. Return top-K complete paths
 */
export function findPaths(
  catalog: Song[],
  config: GenerationConfig = getDefaultConfig()
): PathFinderResult {
  const matrix = buildCompatibilityMatrix(catalog);
  const decades = buildDecadeBuckets(catalog, config);
  const totalTargetSongs = decades.reduce((s, d) => s + d.targetCount, 0);

  // Identify pinned song indices
  const pinnedIndices = new Set<number>();
  for (let i = 0; i < catalog.length; i++) {
    if (config.pinnedSongIds.has(catalog[i].id)) {
      pinnedIndices.add(i);
    }
  }

  // Build paths decade by decade
  let beams: BeamPath[] = [
    {
      songIndices: [],
      totalCost: 0,
      decadeCounts: new Map(),
      estimatedDuration: 0,
    },
  ];

  for (const decade of decades) {
    beams = expandDecade(
      beams, decade, catalog, matrix, config,
      pinnedIndices, totalTargetSongs
    );
  }

  // Sort by total cost and return top paths
  beams.sort((a, b) => a.totalCost - b.totalCost);

  const paths: GeneratedPath[] = beams.slice(0, 5).map(beam => ({
    songIndices: beam.songIndices,
    totalCost: beam.totalCost,
    songCount: beam.songIndices.length,
    estimatedDuration: beam.estimatedDuration,
  }));

  return { paths, matrix };
}

/**
 * Expand all beam paths through a single decade.
 */
function expandDecade(
  beams: BeamPath[],
  decade: DecadeBucket,
  catalog: Song[],
  matrix: CompatibilityMatrix,
  config: GenerationConfig,
  pinnedIndices: Set<number>,
  totalTargetSongs: number
): BeamPath[] {
  const { beamWidth, branchFactor, energyArc } = config;

  // Find pinned songs in this decade
  const pinnedInDecade = decade.songIndices.filter(i => pinnedIndices.has(i));
  const unpinnedInDecade = decade.songIndices.filter(i => !pinnedIndices.has(i));

  // How many songs to select from this decade
  const targetCount = Math.max(decade.targetCount, pinnedInDecade.length);

  // For each beam, select songs for this decade
  let newBeams: BeamPath[] = [];

  for (const beam of beams) {
    // Start by adding all pinned songs
    let currentPaths = [clonePath(beam)];

    // Add pinned songs first (in a good order)
    if (pinnedInDecade.length > 0) {
      currentPaths = addPinnedSongs(
        currentPaths, pinnedInDecade, catalog, matrix,
        energyArc, totalTargetSongs
      );
    }

    // Fill remaining slots with best candidates from unpinned
    const remaining = targetCount - pinnedInDecade.length;
    for (let step = 0; step < remaining; step++) {
      const expanded: BeamPath[] = [];

      for (const path of currentPaths) {
        const usedSet = new Set(path.songIndices);
        const lastIdx = path.songIndices.length > 0
          ? path.songIndices[path.songIndices.length - 1]
          : -1;

        // Score all candidates in this decade
        const candidates: { idx: number; cost: number }[] = [];

        for (const idx of unpinnedInDecade) {
          if (usedSet.has(idx)) continue;

          // Transition cost from last song
          let transitionCost = 0;
          if (lastIdx >= 0) {
            transitionCost = getScore(matrix, lastIdx, idx);
          }

          // Energy arc penalty
          const position = (path.songIndices.length + 1) / totalTargetSongs;
          const arcPenalty = energyArcPenalty(
            catalog[idx].energy, position, energyArc
          );

          // Singalong bonus (crowd favorites should be included)
          const singalongBonus = catalog[idx].crowd_singalong ? -8 : 0;

          // Diversity bonus for unique decades
          const decadeLabel = getDecadeLabel(catalog[idx].year);
          const currentDecadeCount = path.decadeCounts.get(decadeLabel) || 0;
          const densityPenalty = currentDecadeCount > targetCount
            ? (currentDecadeCount - targetCount) * 15
            : 0;

          candidates.push({
            idx,
            cost: transitionCost + arcPenalty + singalongBonus + densityPenalty,
          });
        }

        // Take top branchFactor candidates
        candidates.sort((a, b) => a.cost - b.cost);
        const topCandidates = candidates.slice(0, branchFactor);

        for (const cand of topCandidates) {
          const newPath = clonePath(path);
          newPath.songIndices.push(cand.idx);
          newPath.totalCost += cand.cost;
          const dl = getDecadeLabel(catalog[cand.idx].year);
          newPath.decadeCounts.set(dl, (newPath.decadeCounts.get(dl) || 0) + 1);
          // Rough duration estimate: 30-50s per song
          newPath.estimatedDuration += catalog[cand.idx].crowd_singalong ? 50 : 35;
          expanded.push(newPath);
        }
      }

      // Prune to beam width
      expanded.sort((a, b) => a.totalCost - b.totalCost);
      currentPaths = expanded.slice(0, beamWidth);

      if (currentPaths.length === 0) break;
    }

    newBeams.push(...currentPaths);
  }

  // Final prune across all beams
  newBeams.sort((a, b) => a.totalCost - b.totalCost);
  return newBeams.slice(0, beamWidth);
}

/**
 * Add pinned songs to paths in the best order.
 */
function addPinnedSongs(
  paths: BeamPath[],
  pinnedIndices: number[],
  catalog: Song[],
  matrix: CompatibilityMatrix,
  energyArc: EnergyArcPoint[],
  totalTargetSongs: number
): BeamPath[] {
  // Sort pinned songs by year first
  const sorted = [...pinnedIndices].sort((a, b) => catalog[a].year - catalog[b].year);

  let currentPaths = paths;

  for (const pinnedIdx of sorted) {
    const expanded: BeamPath[] = [];

    for (const path of currentPaths) {
      const newPath = clonePath(path);
      const lastIdx = newPath.songIndices.length > 0
        ? newPath.songIndices[newPath.songIndices.length - 1]
        : -1;

      let cost = 0;
      if (lastIdx >= 0) {
        cost = getScore(matrix, lastIdx, pinnedIdx);
      }

      const position = (newPath.songIndices.length + 1) / totalTargetSongs;
      cost += energyArcPenalty(catalog[pinnedIdx].energy, position, energyArc);

      newPath.songIndices.push(pinnedIdx);
      newPath.totalCost += cost;
      const dl = getDecadeLabel(catalog[pinnedIdx].year);
      newPath.decadeCounts.set(dl, (newPath.decadeCounts.get(dl) || 0) + 1);
      newPath.estimatedDuration += catalog[pinnedIdx].crowd_singalong ? 50 : 35;
      expanded.push(newPath);
    }

    currentPaths = expanded;
  }

  return currentPaths;
}

// ── Simulated annealing refinement ──────────────────────────────────────────

/**
 * Refine a path using simulated annealing.
 * Tries swaps and substitutions to reduce total cost.
 */
export function refinePath(
  path: GeneratedPath,
  catalog: Song[],
  matrix: CompatibilityMatrix,
  config: GenerationConfig,
  iterations: number = 2000
): GeneratedPath {
  const indices = [...path.songIndices];
  const pinnedSet = config.pinnedSongIds;

  // Build index→catalog position lookup
  const inPath = new Set(indices);

  // Available substitutes per decade
  const decadeSubs = new Map<string, number[]>();
  for (let i = 0; i < catalog.length; i++) {
    if (inPath.has(i)) continue;
    const dl = getDecadeLabel(catalog[i].year);
    if (!decadeSubs.has(dl)) decadeSubs.set(dl, []);
    decadeSubs.get(dl)!.push(i);
  }

  let currentCost = computePathCost(indices, catalog, matrix, config);
  let temperature = 50;
  const cooling = 0.995;

  for (let iter = 0; iter < iterations; iter++) {
    temperature *= cooling;

    // Random move: swap within decade (60%) or substitute (40%)
    const moveType = Math.random();

    if (moveType < 0.6) {
      // Swap two adjacent songs within the same decade
      const i = Math.floor(Math.random() * (indices.length - 1));
      const j = i + 1;

      // Must be same decade and neither pinned
      const songI = catalog[indices[i]];
      const songJ = catalog[indices[j]];
      if (getDecadeLabel(songI.year) !== getDecadeLabel(songJ.year)) continue;
      if (pinnedSet.has(songI.id) || pinnedSet.has(songJ.id)) continue;

      // Try swap
      [indices[i], indices[j]] = [indices[j], indices[i]];
      const newCost = computePathCost(indices, catalog, matrix, config);

      if (acceptMove(currentCost, newCost, temperature)) {
        currentCost = newCost;
      } else {
        // Undo
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
    } else {
      // Substitute: replace a non-pinned song with another from same decade
      const i = Math.floor(Math.random() * indices.length);
      const song = catalog[indices[i]];
      if (pinnedSet.has(song.id)) continue;

      const dl = getDecadeLabel(song.year);
      const subs = decadeSubs.get(dl);
      if (!subs || subs.length === 0) continue;

      const subIdx = subs[Math.floor(Math.random() * subs.length)];
      const old = indices[i];
      indices[i] = subIdx;

      const newCost = computePathCost(indices, catalog, matrix, config);

      if (acceptMove(currentCost, newCost, temperature)) {
        currentCost = newCost;
        // Update sub pools
        inPath.delete(old);
        inPath.add(subIdx);
        subs.splice(subs.indexOf(subIdx), 1);
        subs.push(old);
      } else {
        indices[i] = old;
      }
    }
  }

  return {
    songIndices: indices,
    totalCost: currentCost,
    songCount: indices.length,
    estimatedDuration: indices.reduce(
      (s, idx) => s + (catalog[idx].crowd_singalong ? 50 : 35), 0
    ),
  };
}

function acceptMove(oldCost: number, newCost: number, temperature: number): boolean {
  if (newCost < oldCost) return true;
  return Math.random() < Math.exp(-(newCost - oldCost) / temperature);
}

function computePathCost(
  indices: number[],
  catalog: Song[],
  matrix: CompatibilityMatrix,
  config: GenerationConfig
): number {
  let cost = 0;
  const totalSongs = indices.length;

  for (let i = 1; i < indices.length; i++) {
    // Transition cost
    cost += getScore(matrix, indices[i - 1], indices[i]);

    // Energy arc penalty
    const position = i / totalSongs;
    cost += energyArcPenalty(catalog[indices[i]].energy, position, config.energyArc);
  }

  // Chronological order penalty (should be sorted by year within decades)
  for (let i = 1; i < indices.length; i++) {
    const prevDecade = getDecadeLabel(catalog[indices[i - 1]].year);
    const currDecade = getDecadeLabel(catalog[indices[i]].year);
    if (prevDecade === currDecade) continue; // within-decade order is flexible
    if (catalog[indices[i]].year < catalog[indices[i - 1]].year) {
      // Going backwards across decades is a hard penalty
      cost += 100;
    }
  }

  // Singalong coverage bonus
  const singalongs = indices.filter(i => catalog[i].crowd_singalong).length;
  cost -= singalongs * 5;

  return cost;
}
