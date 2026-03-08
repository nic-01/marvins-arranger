/**
 * Chord Progression Compatibility Scoring
 *
 * Compares Roman numeral chord progressions (e.g. "I-VI-IV-V") to assess
 * how well two songs would transition or mashup based on harmonic content.
 *
 * Scoring dimensions:
 * - Shared chords: more common tones = smoother blend
 * - Progression similarity: similar movement patterns mashup well
 * - Functional compatibility: dominant→tonic connections across songs
 */

// ── Parse progression into numerals ──────────────────────────────────────────

/** Standard Roman numerals we recognize (case-insensitive) */
const NUMERAL_VALUES: Record<string, number> = {
  'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7,
  'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6, 'vii': 7,
};

interface ChordToken {
  numeral: number;    // 1-7 scale degree
  isMinor: boolean;   // lowercase = minor
  raw: string;        // original token
}

function parseProgression(prog: string): ChordToken[] {
  if (!prog) return [];
  return prog.split('-').map(raw => {
    // Strip quality markers (dim, aug, 7, maj7, sus, etc.) for comparison
    const base = raw.replace(/(dim|aug|maj|sus|add|m(?!a)|7|9|11|13|\+|°)/gi, '').trim();
    const isMinor = base === base.toLowerCase() && base.length > 0;
    const upperBase = base.toUpperCase();
    const numeral = NUMERAL_VALUES[upperBase] || 0;
    return { numeral, isMinor, raw: raw.trim() };
  }).filter(t => t.numeral > 0);
}

// ── Chord set overlap ────────────────────────────────────────────────────────

/**
 * Fraction of chords shared between two progressions (Jaccard-ish).
 * Returns 0-1 where 1 = identical chord palette.
 */
function chordOverlap(a: ChordToken[], b: ChordToken[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a.map(t => t.numeral));
  const setB = new Set(b.map(t => t.numeral));
  let intersection = 0;
  for (const n of setA) {
    if (setB.has(n)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

// ── Progression shape similarity ─────────────────────────────────────────────

/**
 * Compare the "shape" of two progressions — the intervallic movement pattern.
 * Two songs with the same movement pattern (e.g. both go up a 4th then down a 2nd)
 * will blend naturally even if they use different specific chords.
 * Returns 0-1 where 1 = identical movement.
 */
function shapeSimilarity(a: ChordToken[], b: ChordToken[]): number {
  if (a.length < 2 || b.length < 2) return 0;

  // Convert to interval sequence (deltas between consecutive chords)
  const intervalsA = a.slice(1).map((t, i) => ((t.numeral - a[i].numeral) + 7) % 7);
  const intervalsB = b.slice(1).map((t, i) => ((t.numeral - b[i].numeral) + 7) % 7);

  // Compare using longest common subsequence ratio
  const shorter = Math.min(intervalsA.length, intervalsB.length);
  const longer = Math.max(intervalsA.length, intervalsB.length);
  if (longer === 0) return 0;

  let matches = 0;
  for (let i = 0; i < shorter; i++) {
    if (intervalsA[i] === intervalsB[i]) matches++;
  }

  return matches / longer;
}

// ── Functional compatibility ─────────────────────────────────────────────────

/**
 * Check if the ending of one progression connects well to the beginning of another.
 * Strong connections: V→I, IV→I, V→VI (deceptive), VII→I
 * Returns 0-1 bonus.
 */
function functionalConnection(from: ChordToken[], to: ChordToken[]): number {
  if (from.length === 0 || to.length === 0) return 0;

  const lastChord = from[from.length - 1].numeral;
  const firstChord = to[0].numeral;

  // Strong resolutions
  if (lastChord === 5 && firstChord === 1) return 1.0;   // V → I (perfect cadence)
  if (lastChord === 4 && firstChord === 1) return 0.8;   // IV → I (plagal)
  if (lastChord === 5 && firstChord === 6) return 0.7;   // V → vi (deceptive)
  if (lastChord === 7 && firstChord === 1) return 0.6;   // vii → I (leading tone)
  if (lastChord === 2 && firstChord === 5) return 0.5;   // ii → V (circle)
  if (lastChord === 1 && firstChord === 1) return 0.4;   // I → I (plateau)

  return 0;
}

// ── Exact progression match detection ────────────────────────────────────────

/**
 * Check if two progressions are the same (ignoring minor/major quality).
 * "I-V-vi-IV" and "I-V-VI-IV" would both match as [1,5,6,4].
 */
function isExactMatch(a: ChordToken[], b: ChordToken[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  return a.every((t, i) => t.numeral === b[i].numeral);
}

// ── Main scoring function ────────────────────────────────────────────────────

export interface ChordCompatibilityScore {
  /** Overall score 0-100, higher = more compatible */
  score: number;
  /** Fraction of chords shared (0-1) */
  overlap: number;
  /** Movement pattern similarity (0-1) */
  shape: number;
  /** Functional cadence connection bonus (0-1) */
  connection: number;
  /** True if progressions are identical */
  exactMatch: boolean;
  /** True if at least one song has chord data */
  hasData: boolean;
}

/**
 * Score chord compatibility between two songs.
 * Uses verse and chorus progressions from both songs.
 *
 * @param verseA - Song A verse progression (e.g. "I-IV-V-I")
 * @param chorusA - Song A chorus progression
 * @param verseB - Song B verse progression
 * @param chorusB - Song B chorus progression
 * @returns Compatibility score
 */
export function scoreChordCompatibility(
  verseA: string,
  chorusA: string,
  verseB: string,
  chorusB: string,
): ChordCompatibilityScore {
  const vA = parseProgression(verseA);
  const cA = parseProgression(chorusA);
  const vB = parseProgression(verseB);
  const cB = parseProgression(chorusB);

  const hasA = vA.length > 0 || cA.length > 0;
  const hasB = vB.length > 0 || cB.length > 0;

  if (!hasA || !hasB) {
    return { score: 0, overlap: 0, shape: 0, connection: 0, exactMatch: false, hasData: hasA || hasB };
  }

  // Compare all section pairings and take the best
  const pairs: [ChordToken[], ChordToken[]][] = [];
  if (vA.length > 0 && vB.length > 0) pairs.push([vA, vB]);
  if (cA.length > 0 && cB.length > 0) pairs.push([cA, cB]);
  if (vA.length > 0 && cB.length > 0) pairs.push([vA, cB]);
  if (cA.length > 0 && vB.length > 0) pairs.push([cA, vB]);

  let bestOverlap = 0;
  let bestShape = 0;
  let bestConnection = 0;
  let exactMatch = false;

  for (const [from, to] of pairs) {
    const overlap = chordOverlap(from, to);
    const shape = shapeSimilarity(from, to);
    const connection = functionalConnection(from, to);
    const exact = isExactMatch(from, to);

    if (overlap > bestOverlap) bestOverlap = overlap;
    if (shape > bestShape) bestShape = shape;
    if (connection > bestConnection) bestConnection = connection;
    if (exact) exactMatch = true;
  }

  // Composite score: weighted sum
  let score = 0;
  score += bestOverlap * 40;      // Shared chord palette (max 40)
  score += bestShape * 30;         // Movement pattern similarity (max 30)
  score += bestConnection * 15;    // Functional cadence connection (max 15)
  if (exactMatch) score += 15;     // Exact match bonus (max 15)

  return {
    score: Math.min(100, Math.round(score)),
    overlap: bestOverlap,
    shape: bestShape,
    connection: bestConnection,
    exactMatch,
    hasData: true,
  };
}
