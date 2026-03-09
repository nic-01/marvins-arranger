/**
 * Pairwise Compatibility Scoring Engine
 *
 * Computes edge weights between all song pairs for the generative arranger.
 * Lower score = better compatibility (easier transition).
 */

import type { Song } from './types';
import {
  getCamelotDistance,
  getEffectiveBpmDiff,
  isHalfDoubleTime,
} from './camelot';
import { scoreChordCompatibility } from './chord-compatibility';

// ── Genre affinity matrix ───────────────────────────────────────────────────
// Groups of genres that transition naturally into each other

const GENRE_FAMILIES: string[][] = [
  ['swing', 'big band', 'jazz', 'jump blues'],
  ['rock', 'rock and roll', 'rockabilly', 'garage rock', 'classic rock', 'hard rock', 'punk', 'alternative', 'grunge', 'indie rock'],
  ['pop', 'dance pop', 'synth pop', 'electropop', 'teen pop', 'power pop'],
  ['r&b', 'soul', 'motown', 'funk', 'neo-soul'],
  ['disco', 'dance', 'house', 'electronic', 'edm', 'techno'],
  ['hip hop', 'rap', 'trap'],
  ['country', 'country rock', 'folk', 'folk rock', 'americana'],
  ['ballad', 'soft rock', 'adult contemporary'],
  ['reggae', 'ska', 'latin', 'bossa nova'],
  ['new wave', 'post-punk', 'synth pop'],
  ['patriotic', 'march'],
];

function getGenreFamily(genre: string): number[] {
  const g = genre.toLowerCase();
  const families: number[] = [];
  for (let i = 0; i < GENRE_FAMILIES.length; i++) {
    if (GENRE_FAMILIES[i].some(f => g.includes(f))) {
      families.push(i);
    }
  }
  return families;
}

function genreAffinity(genre1: string, genre2: string): number {
  const f1 = getGenreFamily(genre1);
  const f2 = getGenreFamily(genre2);

  if (f1.length === 0 || f2.length === 0) return 0.5; // unknown = neutral

  // Check for shared family
  for (const fam of f1) {
    if (f2.includes(fam)) return 1.0; // same family
  }

  // Check for adjacent families (e.g., soul→disco, rock→pop)
  // Some cross-family affinities
  const CROSS_AFFINITIES: [number, number][] = [
    [0, 1],  // swing→rock (evolution)
    [1, 2],  // rock→pop
    [3, 4],  // r&b/soul→disco/dance
    [2, 4],  // pop→dance
    [3, 2],  // r&b→pop
    [5, 3],  // hip hop→r&b
    [1, 6],  // rock→country
    [7, 2],  // ballad→pop
    [9, 2],  // new wave→pop
  ];

  for (const [a, b] of CROSS_AFFINITIES) {
    if ((f1.includes(a) && f2.includes(b)) || (f1.includes(b) && f2.includes(a))) {
      return 0.7; // adjacent family
    }
  }

  return 0.3; // unrelated genres
}

// ── Vocal contrast scoring ──────────────────────────────────────────────────

function vocalContrastScore(
  v1: Song['vocal_gender'],
  v2: Song['vocal_gender']
): number {
  // Alternating vocals is good for variety
  if (v1 === v2) return 0;          // same = neutral
  if (v1 === 'Instrumental' || v2 === 'Instrumental') return 0.3; // instrumental pivot = slight bonus
  if (v1 !== v2) return 0.5;        // gender switch = good variety
  return 0;
}

// ── Instrumentation handoff ─────────────────────────────────────────────────

function instrumentationContinuity(a: Song, b: Song): number {
  // Shared instrumentation makes transitions smoother
  let shared = 0;
  let total = 0;

  if (a.horn_friendly || b.horn_friendly) {
    total++;
    if (a.horn_friendly && b.horn_friendly) shared++;
  }
  if (a.guitar_driven || b.guitar_driven) {
    total++;
    if (a.guitar_driven && b.guitar_driven) shared++;
  }
  if (a.keyboard_driven || b.keyboard_driven) {
    total++;
    if (a.keyboard_driven && b.keyboard_driven) shared++;
  }

  if (total === 0) return 0.5; // no strong instrumentation = neutral
  return shared / total; // 0 = no overlap, 1 = full overlap
}

// ── Main compatibility score ────────────────────────────────────────────────

export interface CompatibilityScore {
  total: number;         // 0 = perfect, higher = worse
  bpm: number;           // BPM component
  key: number;           // Key/Camelot component
  energy: number;        // Energy flow component
  genre: number;         // Genre affinity component
  vocal: number;         // Vocal contrast component (negative = bonus)
  instrumentation: number; // Instrumentation continuity
  chords: number;        // Chord progression compatibility (negative = bonus)
}

/**
 * Score how well song B follows song A in a medley.
 * Lower = better transition. Range roughly 0-200.
 */
export function scoreTransition(a: Song, b: Song): CompatibilityScore {
  // BPM: 0-80 (heavily weighted, this is the hardest thing to fake)
  const bpmDiff = getEffectiveBpmDiff(a.bpm, b.bpm);
  const halfDouble = isHalfDoubleTime(a.bpm, b.bpm);
  let bpmScore: number;
  if (bpmDiff <= 3) {
    bpmScore = 0;                    // perfect match
  } else if (halfDouble) {
    bpmScore = 5;                    // half/double time is very usable
  } else if (bpmDiff <= 8) {
    bpmScore = bpmDiff * 1.5;       // slight ramp, easy
  } else if (bpmDiff <= 20) {
    bpmScore = bpmDiff * 2.5;       // noticeable ramp
  } else {
    bpmScore = 50 + bpmDiff;        // big jump, needs special transition
  }

  // Key: 0-60 (Camelot distance * 10)
  const keyDist = getCamelotDistance(a.key, b.key);
  const keyScore = keyDist * 10;

  // Energy: 0-24 (penalize big jumps, reward smooth flow)
  const energyMap = { Low: 0, Medium: 1, High: 2 };
  const energyDiff = energyMap[b.energy] - energyMap[a.energy];
  let energyScore: number;
  if (energyDiff === 0) {
    energyScore = 0;               // same energy
  } else if (energyDiff === 1) {
    energyScore = 2;               // gradual build = good
  } else if (energyDiff === -1) {
    energyScore = 4;               // slight drop = ok
  } else if (energyDiff === 2) {
    energyScore = 12;              // big jump up = jarring
  } else {
    energyScore = 16;              // big drop = needs vamp_fade
  }

  // Genre: 0-20 (lower if genres are compatible)
  const genreAff = genreAffinity(a.genre, b.genre);
  const genreScore = (1 - genreAff) * 20;

  // Vocal: -5 to 0 (contrast is a bonus, reduces total)
  const vocalScore = -vocalContrastScore(a.vocal_gender, b.vocal_gender) * 5;

  // Instrumentation: 0-10 (shared instruments help transitions)
  const instrContinuity = instrumentationContinuity(a, b);
  const instrScore = (1 - instrContinuity) * 10;

  // Chords: -15 to 0 (compatible progressions are a bonus, reduces total)
  const chordCompat = scoreChordCompatibility(
    a.chords_verse || '', a.chords_chorus || '',
    b.chords_verse || '', b.chords_chorus || '',
  );
  // Scale 0-100 chord score to -15..0 bonus (only applies when both songs have data)
  const chordScore = chordCompat.hasData ? -(chordCompat.score / 100) * 15 : 0;

  const total = bpmScore + keyScore + energyScore + genreScore + vocalScore + instrScore + chordScore;

  return {
    total,
    bpm: bpmScore,
    key: keyScore,
    energy: energyScore,
    genre: genreScore,
    vocal: vocalScore,
    instrumentation: instrScore,
    chords: chordScore,
  };
}

// ── Batch precomputation ────────────────────────────────────────────────────

export interface CompatibilityMatrix {
  songs: Song[];
  scores: Float32Array;  // flat [i * n + j] matrix
  size: number;
}

/**
 * Precompute all pairwise compatibility scores for a song catalog.
 * For 470 songs this is ~220K pairs — runs in <100ms.
 */
export function buildCompatibilityMatrix(songs: Song[]): CompatibilityMatrix {
  const n = songs.length;
  const scores = new Float32Array(n * n);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        scores[i * n + j] = Infinity;
      } else {
        scores[i * n + j] = scoreTransition(songs[i], songs[j]).total;
      }
    }
  }

  return { songs, scores, size: n };
}

/**
 * Look up the compatibility score between two songs by index.
 */
export function getScore(matrix: CompatibilityMatrix, fromIdx: number, toIdx: number): number {
  return matrix.scores[fromIdx * matrix.size + toIdx];
}

/**
 * Find the best N transitions FROM a given song, optionally filtered.
 */
export function bestTransitionsFrom(
  matrix: CompatibilityMatrix,
  fromIdx: number,
  count: number,
  filter?: (songIdx: number) => boolean
): { songIdx: number; score: number }[] {
  const results: { songIdx: number; score: number }[] = [];

  for (let j = 0; j < matrix.size; j++) {
    if (j === fromIdx) continue;
    if (filter && !filter(j)) continue;
    results.push({ songIdx: j, score: getScore(matrix, fromIdx, j) });
  }

  results.sort((a, b) => a.score - b.score);
  return results.slice(0, count);
}
