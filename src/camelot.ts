import type { CamelotPosition } from './types';

// Camelot Wheel mapping: key name -> Camelot position
const CAMELOT_MAP: Record<string, CamelotPosition> = {
  // Minor keys (A column)
  'Ab minor': { number: 1, letter: 'A' },
  'G# minor': { number: 1, letter: 'A' },
  'Eb minor': { number: 2, letter: 'A' },
  'D# minor': { number: 2, letter: 'A' },
  'Bb minor': { number: 3, letter: 'A' },
  'A# minor': { number: 3, letter: 'A' },
  'F minor': { number: 4, letter: 'A' },
  'Fm': { number: 4, letter: 'A' },
  'C minor': { number: 5, letter: 'A' },
  'Cm': { number: 5, letter: 'A' },
  'G minor': { number: 6, letter: 'A' },
  'Gm': { number: 6, letter: 'A' },
  'D minor': { number: 7, letter: 'A' },
  'Dm': { number: 7, letter: 'A' },
  'A minor': { number: 8, letter: 'A' },
  'Am': { number: 8, letter: 'A' },
  'E minor': { number: 9, letter: 'A' },
  'Em': { number: 9, letter: 'A' },
  'B minor': { number: 10, letter: 'A' },
  'Bm': { number: 10, letter: 'A' },
  'F# minor': { number: 11, letter: 'A' },
  'F#m': { number: 11, letter: 'A' },
  'Gb minor': { number: 11, letter: 'A' },
  'Db minor': { number: 12, letter: 'A' },
  'C# minor': { number: 12, letter: 'A' },
  'C#m': { number: 12, letter: 'A' },

  // Major keys (B column)
  'B major': { number: 1, letter: 'B' },
  'F# major': { number: 2, letter: 'B' },
  'Gb major': { number: 2, letter: 'B' },
  'Db major': { number: 3, letter: 'B' },
  'C# major': { number: 3, letter: 'B' },
  'Ab major': { number: 4, letter: 'B' },
  'G# major': { number: 4, letter: 'B' },
  'Eb major': { number: 5, letter: 'B' },
  'D# major': { number: 5, letter: 'B' },
  'Bb major': { number: 6, letter: 'B' },
  'A# major': { number: 6, letter: 'B' },
  'F major': { number: 7, letter: 'B' },
  'C major': { number: 8, letter: 'B' },
  'G major': { number: 9, letter: 'B' },
  'D major': { number: 10, letter: 'B' },
  'A major': { number: 11, letter: 'B' },
  'E major': { number: 12, letter: 'B' },
};

export function getCamelotPosition(key: string): CamelotPosition | null {
  return CAMELOT_MAP[key] || null;
}

export function getCamelotCode(key: string): string {
  const pos = getCamelotPosition(key);
  if (!pos) return '?';
  return `${pos.number}${pos.letter}`;
}

// Check if two keys are compatible on the Camelot wheel
// Compatible = same position, ±1 position same letter, or same number different letter
export function areKeysCompatible(key1: string, key2: string): boolean {
  const pos1 = getCamelotPosition(key1);
  const pos2 = getCamelotPosition(key2);

  if (!pos1 || !pos2) return true; // unknown = no warning

  // Same position
  if (pos1.number === pos2.number && pos1.letter === pos2.letter) return true;

  // Same number, different letter (relative major/minor)
  if (pos1.number === pos2.number) return true;

  // Adjacent numbers, same letter
  if (pos1.letter === pos2.letter) {
    const diff = Math.abs(pos1.number - pos2.number);
    if (diff === 1 || diff === 11) return true; // 11 wraps around 12->1
  }

  return false;
}

// Get BPM compatibility level
export function getBpmCompatibility(
  bpm1: number,
  bpm2: number
): 'ok' | 'amber' | 'red' {
  const diff = Math.abs(bpm1 - bpm2);
  if (diff > 40) return 'red';
  if (diff > 20) return 'amber';
  return 'ok';
}

// Camelot color for visualization
const CAMELOT_COLORS: Record<number, string> = {
  1: '#ff6b6b',
  2: '#ff8e72',
  3: '#ffa94d',
  4: '#ffd43b',
  5: '#a9e34b',
  6: '#69db7c',
  7: '#38d9a9',
  8: '#3bc9db',
  9: '#4dabf7',
  10: '#748ffc',
  11: '#9775fa',
  12: '#da77f2',
};

export function getCamelotColor(key: string): string {
  const pos = getCamelotPosition(key);
  if (!pos) return '#888';
  return CAMELOT_COLORS[pos.number];
}

// Get the number of steps between two keys on the Camelot wheel (0-6)
// Considers same-letter adjacency and cross-letter (relative major/minor)
export function getCamelotDistance(key1: string, key2: string): number {
  const pos1 = getCamelotPosition(key1);
  const pos2 = getCamelotPosition(key2);
  if (!pos1 || !pos2) return 3; // unknown = moderate distance

  // Same position exactly
  if (pos1.number === pos2.number && pos1.letter === pos2.letter) return 0;

  // Relative major/minor (same number, different letter) = 1 step
  if (pos1.number === pos2.number) return 1;

  // Circular distance on the wheel (1-6)
  const circDist = Math.min(
    Math.abs(pos1.number - pos2.number),
    12 - Math.abs(pos1.number - pos2.number)
  );

  // If same letter, just the circular distance
  if (pos1.letter === pos2.letter) return circDist;

  // Different letter + different number: cross to relative then walk
  // e.g., 8A to 10B = 8A->8B (1 step) then 8B->10B (2 steps) = 3 steps
  return 1 + circDist;
}

// Check if two BPMs are in a half-time or double-time relationship (within 5%)
export function isHalfDoubleTime(bpm1: number, bpm2: number): boolean {
  const ratio = bpm1 / bpm2;
  return (ratio > 1.9 && ratio < 2.1) || (ratio > 0.475 && ratio < 0.525);
}

// Get the effective BPM closest to a target (considering half/double-time)
export function getEffectiveBpm(bpm: number, targetBpm: number): number {
  const candidates = [bpm, bpm / 2, bpm * 2];
  let best = bpm;
  let bestDiff = Math.abs(bpm - targetBpm);
  for (const c of candidates) {
    const diff = Math.abs(c - targetBpm);
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return best;
}

// Get the minimum BPM difference considering half/double-time
export function getEffectiveBpmDiff(bpm1: number, bpm2: number): number {
  return Math.abs(bpm1 - getEffectiveBpm(bpm2, bpm1));
}
