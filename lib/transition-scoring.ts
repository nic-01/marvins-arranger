/**
 * Enhanced Transition Scoring for Block Discovery
 *
 * Builds on the existing compatibility scoring to add:
 * - Mashup potential detection
 * - Key transposition feasibility (±1-2 semitones, gender swap)
 * - Tempo sync assessment (within ±15%)
 * - Transition type classification (mashup / smooth / hard)
 */

import type { Song } from './types';
import {
  getCamelotDistance,
  getCamelotPosition,
  isHalfDoubleTime,
} from './camelot';
import { scoreTransition, type CompatibilityScore } from './compatibility';
import { scoreChordCompatibility } from './chord-compatibility';

// ── Transition classification ─────────────────────────────────────────────

export type TransitionQuality = 'mashup' | 'smooth' | 'workable' | 'hard';

export interface PairScore {
  from: Song;
  to: Song;
  fromIdx: number;
  toIdx: number;

  // Raw compatibility (from existing engine)
  compatibility: CompatibilityScore;

  // Enhanced scoring
  quality: TransitionQuality;
  score: number;           // 0-100, higher = better (inverted from compatibility)
  mashupPotential: number; // 0-100, how well these could be mashed up

  // Key analysis
  keyDistance: number;       // Camelot distance (0-6)
  suggestedKeyShift: number; // Semitones to shift song B (-2 to +2, 0 = no shift)
  keyShiftDifficulty: 'none' | 'easy' | 'moderate' | 'hard';

  // Tempo analysis
  bpmRatio: number;          // bpmB / bpmA (1.0 = same)
  tempoSyncable: boolean;    // Can be synced within ±15%
  tempoSyncBpm: number;      // The BPM both songs would play at
  halfDoubleTime: boolean;

  // Texture/energy
  energyFlow: 'build' | 'sustain' | 'drop' | 'crash';
  genreCompatible: boolean;
  vocalContrast: boolean;    // Different vocal genders (good for variety)
  sharedInstrumentation: boolean;
}

// ── Key transposition analysis ────────────────────────────────────────────

interface KeyShiftResult {
  shift: number;         // semitones to shift song B
  difficulty: 'none' | 'easy' | 'moderate' | 'hard';
  resultingDistance: number; // Camelot distance after shift
}

// Camelot number -> semitone offset from C (for shift calculations)
const CAMELOT_TO_SEMITONE: Record<string, number> = {
  '8B': 0,  // C major
  '8A': 0,  // A minor (relative)
  '9B': 7,  // G major
  '9A': 7,  // E minor
  '10B': 2, // D major
  '10A': 2, // B minor
  '11B': 9, // A major
  '11A': 9, // F# minor
  '12B': 4, // E major
  '12A': 4, // C# minor
  '1B': 11, // B major
  '1A': 11, // Ab minor
  '2B': 6,  // F# major
  '2A': 6,  // Eb minor
  '3B': 1,  // Db major
  '3A': 1,  // Bb minor
  '4B': 8,  // Ab major
  '4A': 8,  // F minor
  '5B': 3,  // Eb major
  '5A': 3,  // C minor
  '6B': 10, // Bb major
  '6A': 10, // G minor
  '7B': 5,  // F major
  '7A': 5,  // D minor
};

function analyzeKeyShift(from: Song, to: Song): KeyShiftResult {
  const baseDistance = getCamelotDistance(from.key, to.key);

  // If already compatible, no shift needed
  if (baseDistance <= 1) {
    return { shift: 0, difficulty: 'none', resultingDistance: baseDistance };
  }

  const posFrom = getCamelotPosition(from.key);
  const posTo = getCamelotPosition(to.key);
  if (!posFrom || !posTo) {
    return { shift: 0, difficulty: 'none', resultingDistance: baseDistance };
  }

  const fromCode = `${posFrom.number}${posFrom.letter}`;
  const toCode = `${posTo.number}${posTo.letter}`;
  const fromSemitone = CAMELOT_TO_SEMITONE[fromCode];
  const toSemitone = CAMELOT_TO_SEMITONE[toCode];

  if (fromSemitone === undefined || toSemitone === undefined) {
    return { shift: 0, difficulty: 'none', resultingDistance: baseDistance };
  }

  // Try shifts of -2, -1, +1, +2 semitones on song B
  let bestShift = 0;
  let bestDistance = baseDistance;
  let bestDifficulty: KeyShiftResult['difficulty'] = 'none';

  for (const shift of [-1, 1, -2, 2]) {
    // Shifting by N semitones moves the Camelot number
    // Each semitone = 7 steps on the Camelot wheel (modulo 12)
    const shiftedSemitone = ((toSemitone + shift) % 12 + 12) % 12;

    // Find the Camelot position for the shifted key
    // We keep the same letter (major/minor stays the same)
    let shiftedNumber = -1;
    for (const [code, semi] of Object.entries(CAMELOT_TO_SEMITONE)) {
      if (semi === shiftedSemitone && code.endsWith(posTo.letter)) {
        shiftedNumber = parseInt(code);
        break;
      }
    }
    if (shiftedNumber === -1) continue;

    // Calculate new Camelot distance
    const circDist = Math.min(
      Math.abs(posFrom.number - shiftedNumber),
      12 - Math.abs(posFrom.number - shiftedNumber)
    );
    const newDist = posFrom.letter === posTo.letter ? circDist : 1 + circDist;

    if (newDist < bestDistance) {
      bestDistance = newDist;
      bestShift = shift;

      // Difficulty based on shift amount and direction
      const absShift = Math.abs(shift);
      if (absShift === 1) {
        bestDifficulty = shift < 0 ? 'easy' : 'easy'; // down slightly easier
      } else {
        // ±2 semitones
        bestDifficulty = shift < 0 ? 'easy' : 'moderate'; // down a tone = easy, up a tone = moderate
      }

      // Harder if going up for high-range vocals
      if (shift > 0 && (to.vocal_gender === 'Female' || to.energy === 'High')) {
        bestDifficulty = absShift === 1 ? 'moderate' : 'hard';
      }
    }
  }

  // Only suggest shift if it actually helps
  if (bestDistance >= baseDistance) {
    return { shift: 0, difficulty: 'none', resultingDistance: baseDistance };
  }

  return { shift: bestShift, difficulty: bestDifficulty, resultingDistance: bestDistance };
}

// ── Tempo sync analysis ───────────────────────────────────────────────────

interface TempoSyncResult {
  syncable: boolean;
  syncBpm: number;       // Target BPM for both songs
  ratio: number;         // bpmB / bpmA
  halfDouble: boolean;
  stretchPercent: number; // How much song B needs to stretch (%)
}

function analyzeTempoSync(from: Song, to: Song): TempoSyncResult {
  const ratio = to.bpm / from.bpm;
  const halfDouble = isHalfDoubleTime(from.bpm, to.bpm);

  // Find the effective BPM of song B closest to song A
  let effectiveBpmB = to.bpm;
  if (halfDouble) {
    if (to.bpm > from.bpm * 1.5) effectiveBpmB = to.bpm / 2;
    else if (to.bpm < from.bpm * 0.75) effectiveBpmB = to.bpm * 2;
  }

  const stretchPercent = Math.abs((effectiveBpmB - from.bpm) / from.bpm) * 100;

  // Syncable if within ±15% (or half/double time equivalent)
  const syncable = stretchPercent <= 15;

  // Target sync BPM: split the difference, biased toward song A
  const syncBpm = syncable
    ? Math.round((from.bpm * 2 + effectiveBpmB) / 3) // 2/3 toward A
    : from.bpm;

  return { syncable, syncBpm, ratio, halfDouble, stretchPercent };
}

// ── Energy flow classification ────────────────────────────────────────────

function classifyEnergyFlow(from: Song, to: Song): PairScore['energyFlow'] {
  const energyMap = { Low: 0, Medium: 1, High: 2 };
  const diff = energyMap[to.energy] - energyMap[from.energy];

  if (diff === 0) return 'sustain';
  if (diff === 1) return 'build';
  if (diff === -1) return 'drop';
  return 'crash'; // ±2 jump
}

// ── Mashup potential scoring ──────────────────────────────────────────────

function scoreMashupPotential(
  from: Song,
  to: Song,
  keyShift: KeyShiftResult,
  tempoSync: TempoSyncResult
): number {
  let score = 0;

  // Tempo: must be syncable for mashup
  if (!tempoSync.syncable) return 0;

  // Closer tempo = better mashup
  if (tempoSync.stretchPercent <= 2) score += 40;
  else if (tempoSync.stretchPercent <= 5) score += 30;
  else if (tempoSync.stretchPercent <= 10) score += 20;
  else score += 10;

  // Key: must be close
  const effectiveKeyDist = keyShift.shift !== 0
    ? keyShift.resultingDistance
    : getCamelotDistance(from.key, to.key);

  if (effectiveKeyDist === 0) score += 35;
  else if (effectiveKeyDist === 1) score += 25;
  else if (effectiveKeyDist === 2) score += 10;
  else return score * 0.3; // Too far for mashup

  // Energy match
  if (from.energy === to.energy) score += 10;
  else score += 5;

  // Vocal contrast is GOOD for mashups (one can be the bed)
  if (from.vocal_gender !== to.vocal_gender) score += 10;

  // Shared instrumentation helps the blend
  const shared = [
    from.horn_friendly && to.horn_friendly,
    from.guitar_driven && to.guitar_driven,
    from.keyboard_driven && to.keyboard_driven,
  ].filter(Boolean).length;
  score += shared * 3;

  // Chord compatibility: similar progressions mashup much better
  const chordCompat = scoreChordCompatibility(
    from.chords_verse || '', from.chords_chorus || '',
    to.chords_verse || '', to.chords_chorus || '',
  );
  if (chordCompat.hasData) {
    score += Math.round(chordCompat.score * 0.15); // Up to +15 for identical chords
    if (chordCompat.exactMatch) score += 5;        // Extra bonus for exact same progression
  }

  return Math.min(100, score);
}

// ── Main pair scoring ─────────────────────────────────────────────────────

/**
 * Score a pair of songs for transition quality.
 * Higher score = better transition (0-100 scale).
 */
export function scorePair(
  from: Song,
  to: Song,
  fromIdx: number,
  toIdx: number
): PairScore {
  const compatibility = scoreTransition(from, to);
  const keyShift = analyzeKeyShift(from, to);
  const tempoSync = analyzeTempoSync(from, to);
  const energyFlow = classifyEnergyFlow(from, to);
  const mashupPotential = scoreMashupPotential(from, to, keyShift, tempoSync);

  // Genre compatibility
  const genreCompatible = compatibility.genre <= 6; // 30% of max genre penalty

  // Vocal contrast
  const vocalContrast = from.vocal_gender !== to.vocal_gender &&
    from.vocal_gender !== 'Instrumental' && to.vocal_gender !== 'Instrumental';

  // Shared instrumentation
  const sharedInstrumentation =
    (from.horn_friendly && to.horn_friendly) ||
    (from.guitar_driven && to.guitar_driven) ||
    (from.keyboard_driven && to.keyboard_driven);

  // Convert compatibility score (lower=better) to quality score (higher=better)
  // compatibility.total typically ranges 0-150+
  // Map to 0-100 where 100 = perfect
  let score: number;
  if (compatibility.total <= 5) score = 95;
  else if (compatibility.total <= 15) score = 85;
  else if (compatibility.total <= 30) score = 70;
  else if (compatibility.total <= 50) score = 55;
  else if (compatibility.total <= 75) score = 40;
  else if (compatibility.total <= 100) score = 25;
  else score = Math.max(5, 20 - (compatibility.total - 100) / 10);

  // Bonus for key shift making things easier
  if (keyShift.shift !== 0 && keyShift.resultingDistance < getCamelotDistance(from.key, to.key)) {
    score += (getCamelotDistance(from.key, to.key) - keyShift.resultingDistance) * 3;
  }

  // Bonus for syncable tempo
  if (tempoSync.syncable && tempoSync.stretchPercent <= 5) {
    score += 5;
  }

  // Mashup potential bonus
  if (mashupPotential >= 60) {
    score += 10;
  }

  score = Math.min(100, Math.max(0, score));

  // Classify quality
  let quality: TransitionQuality;
  if (mashupPotential >= 60 && score >= 70) {
    quality = 'mashup';
  } else if (score >= 65) {
    quality = 'smooth';
  } else if (score >= 40) {
    quality = 'workable';
  } else {
    quality = 'hard';
  }

  return {
    from,
    to,
    fromIdx,
    toIdx,
    compatibility,
    quality,
    score,
    mashupPotential,
    keyDistance: getCamelotDistance(from.key, to.key),
    suggestedKeyShift: keyShift.shift,
    keyShiftDifficulty: keyShift.difficulty,
    bpmRatio: tempoSync.ratio,
    tempoSyncable: tempoSync.syncable,
    tempoSyncBpm: tempoSync.syncBpm,
    halfDoubleTime: tempoSync.halfDouble,
    energyFlow,
    genreCompatible,
    vocalContrast,
    sharedInstrumentation,
  };
}

// ── Batch pair scoring for chronological catalog ──────────────────────────

export interface PairMatrix {
  songs: Song[];
  pairs: Map<string, PairScore>; // key: "fromIdx-toIdx"
  byFrom: Map<number, PairScore[]>; // fromIdx -> sorted pairs
}

/**
 * Build a pair score matrix for all valid chronological transitions.
 * Only scores pairs where song B is in the same year or up to maxYearGap years ahead.
 */
export function buildPairMatrix(
  songs: Song[],
  maxYearGap: number = 3
): PairMatrix {
  // Sort by year first
  const sorted = [...songs].sort((a, b) => a.year - b.year);
  const pairs = new Map<string, PairScore>();
  const byFrom = new Map<number, PairScore[]>();

  for (let i = 0; i < sorted.length; i++) {
    const fromSong = sorted[i];
    const fromPairs: PairScore[] = [];

    for (let j = 0; j < sorted.length; j++) {
      if (i === j) continue;
      const toSong = sorted[j];

      // Only forward in time (same year or ahead, within gap)
      const yearDiff = toSong.year - fromSong.year;
      if (yearDiff < 0) continue;
      if (yearDiff > maxYearGap) continue;

      const pair = scorePair(fromSong, toSong, i, j);
      const key = `${i}-${j}`;
      pairs.set(key, pair);
      fromPairs.push(pair);
    }

    // Sort by score descending (best first)
    fromPairs.sort((a, b) => b.score - a.score);
    byFrom.set(i, fromPairs);
  }

  return { songs: sorted, pairs, byFrom };
}

/**
 * Get the pair score between two songs by index.
 */
export function getPairScore(matrix: PairMatrix, fromIdx: number, toIdx: number): PairScore | undefined {
  return matrix.pairs.get(`${fromIdx}-${toIdx}`);
}

/**
 * Get the best N transitions from a song, optionally filtered.
 */
export function bestPairsFrom(
  matrix: PairMatrix,
  fromIdx: number,
  count: number,
  filter?: (pair: PairScore) => boolean
): PairScore[] {
  const pairs = matrix.byFrom.get(fromIdx) || [];
  if (!filter) return pairs.slice(0, count);
  return pairs.filter(filter).slice(0, count);
}
