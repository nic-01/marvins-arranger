/**
 * Generative Arrangement Engine
 *
 * Takes a flat list of MedleySongs and transforms them into a musically
 * intelligent arrangement — reordering within decades, assigning bar counts,
 * choosing transitions, detecting mashup opportunities, and shaping energy arcs.
 */

import type { MedleySong, TransitionType } from './types';
import {
  getCamelotDistance,
  getEffectiveBpm,
  getEffectiveBpmDiff,
  isHalfDoubleTime,
  areKeysCompatible,
} from './camelot';

// ── Decade grouping ─────────────────────────────────────────────────────────

interface DecadeGroup {
  label: string;
  sortKey: number;
  songs: MedleySong[];
}

function getDecadeLabel(year: number): string {
  if (year < 1950) return 'The Sprint';
  return `${Math.floor(year / 10) * 10}s`;
}

function getDecadeSortKey(year: number): number {
  if (year < 1950) return 0;
  return Math.floor(year / 10) * 10;
}

function groupByDecade(songs: MedleySong[]): DecadeGroup[] {
  const groups = new Map<string, DecadeGroup>();
  for (const song of songs) {
    const label = getDecadeLabel(song.year);
    const sortKey = getDecadeSortKey(song.year);
    if (!groups.has(label)) {
      groups.set(label, { label, sortKey, songs: [] });
    }
    groups.get(label)!.songs.push(song);
  }
  return Array.from(groups.values()).sort((a, b) => a.sortKey - b.sortKey);
}

// ── Within-decade reordering (nearest-neighbor by BPM + key) ────────────────

function scorePair(current: MedleySong, candidate: MedleySong): number {
  // Lower score = better fit as next song
  const bpmDiff = getEffectiveBpmDiff(current.bpm, candidate.bpm);
  const keyDist = getCamelotDistance(current.key, candidate.key);

  // BPM score: 0-100 (heavily weighted)
  const bpmScore = Math.min(bpmDiff * 2, 100);

  // Key score: 0-60 (important but secondary to BPM)
  const keyScore = keyDist * 10;

  // Energy continuity: penalize big jumps
  const energyMap = { Low: 0, Medium: 1, High: 2 };
  const energyDiff = Math.abs(
    energyMap[current.energy] - energyMap[candidate.energy]
  );
  const energyScore = energyDiff * 8;

  return bpmScore + keyScore + energyScore;
}

function reorderWithinDecade(songs: MedleySong[], isSprintSection: boolean): MedleySong[] {
  if (songs.length <= 2) return songs;

  if (isSprintSection) {
    // The Sprint: sort by BPM descending for high-energy start, then key-walk
    return reorderByBpmAndKey(songs);
  }

  return reorderByBpmAndKey(songs);
}

function reorderByBpmAndKey(songs: MedleySong[]): MedleySong[] {
  if (songs.length <= 1) return songs;

  // Start with the song closest to the median BPM (good anchor point)
  const bpms = songs.map((s) => s.bpm).sort((a, b) => a - b);
  const medianBpm = bpms[Math.floor(bpms.length / 2)];
  const startIdx = songs.reduce(
    (best, s, i) =>
      Math.abs(s.bpm - medianBpm) < Math.abs(songs[best].bpm - medianBpm)
        ? i
        : best,
    0
  );

  const remaining = [...songs];
  const result: MedleySong[] = [remaining.splice(startIdx, 1)[0]];

  // Greedy nearest-neighbor
  while (remaining.length > 0) {
    const current = result[result.length - 1];
    let bestIdx = 0;
    let bestScore = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const score = scorePair(current, remaining[i]);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    result.push(remaining.splice(bestIdx, 1)[0]);
  }

  return result;
}

// ── Optimize decade boundaries ──────────────────────────────────────────────

function optimizeDecadeBoundaries(groups: DecadeGroup[]): void {
  for (let g = 0; g < groups.length - 1; g++) {
    const currentDecade = groups[g].songs;
    const nextDecade = groups[g + 1].songs;
    if (currentDecade.length < 2 || nextDecade.length < 2) continue;

    // Find the best last-song / first-song pairing across the boundary
    let bestLastIdx = currentDecade.length - 1;
    let bestFirstIdx = 0;
    let bestScore = scorePair(
      currentDecade[bestLastIdx],
      nextDecade[bestFirstIdx]
    );

    // Try the last 3 songs of current decade as potential end songs
    for (
      let li = Math.max(0, currentDecade.length - 3);
      li < currentDecade.length;
      li++
    ) {
      // Try the first 3 songs of next decade as potential start songs
      for (let fi = 0; fi < Math.min(3, nextDecade.length); fi++) {
        const score = scorePair(currentDecade[li], nextDecade[fi]);
        if (score < bestScore) {
          bestScore = score;
          bestLastIdx = li;
          bestFirstIdx = fi;
        }
      }
    }

    // Move the best last song to the end of current decade
    if (bestLastIdx !== currentDecade.length - 1) {
      const song = currentDecade.splice(bestLastIdx, 1)[0];
      currentDecade.push(song);
    }

    // Move the best first song to the start of next decade
    if (bestFirstIdx !== 0) {
      const song = nextDecade.splice(bestFirstIdx, 1)[0];
      nextDecade.unshift(song);
    }
  }
}

// ── Bar count assignment ────────────────────────────────────────────────────

interface DecadeTimeBudget {
  label: string;
  targetMinutes: number;
}

// Target times per decade section (rough guidelines)
const DECADE_TARGETS: Record<string, number> = {
  'The Sprint': 4,
  '1950s': 4,
  '1960s': 6,
  '1970s': 8,
  '1980s': 10,
  '1990s': 10,
  '2000s': 10,
  '2010s': 10,
  '2020s': 6,
};

function getTargetMinutes(decadeLabel: string): number {
  return DECADE_TARGETS[decadeLabel] || 8;
}

function assignBarCounts(group: DecadeGroup): void {
  const songs = group.songs;
  const targetSeconds = getTargetMinutes(group.label) * 60;
  const isSprintSection = group.label === 'The Sprint';

  // Score each song for "feature-worthiness"
  const featureScores = songs.map((s) => {
    let score = 0;
    if (s.crowd_singalong) score += 3;
    if (s.energy === 'High') score += 1;
    if (s.danceability === 'High') score += 1;
    if (s.horn_friendly) score += 0.5; // band showcase
    return score;
  });

  // Assign initial bar counts based on feature score
  for (let i = 0; i < songs.length; i++) {
    const score = featureScores[i];
    if (isSprintSection) {
      // Sprint: everything is short and punchy
      songs[i].bar_count = score >= 3 ? 16 : 8;
    } else if (score >= 4) {
      songs[i].bar_count = 32; // Big feature moment
    } else if (score >= 2) {
      songs[i].bar_count = 24; // Featured song
    } else if (score >= 1) {
      songs[i].bar_count = 16; // Standard
    } else {
      songs[i].bar_count = 8; // Quick hit
    }
  }

  // Ensure variety: break up runs of same bar count
  for (let i = 2; i < songs.length; i++) {
    if (
      songs[i].bar_count === songs[i - 1].bar_count &&
      songs[i].bar_count === songs[i - 2].bar_count &&
      songs[i].bar_count === 16
    ) {
      // Promote or demote the middle one for variety
      if (featureScores[i - 1] >= 1.5) {
        songs[i - 1].bar_count = 24;
      } else {
        songs[i - 1].bar_count = 8;
      }
    }
  }

  // Adjust to fit time budget
  const calcTotalSeconds = () =>
    songs.reduce((sum, s) => sum + (s.bar_count! * 4 * 60) / s.bpm, 0);

  let iterations = 0;
  while (iterations < 20) {
    const total = calcTotalSeconds();
    const ratio = total / targetSeconds;

    if (ratio > 0.85 && ratio < 1.15) break; // close enough

    if (ratio > 1.15) {
      // Too long: shorten the least-featured song that isn't already 8
      const candidateIdx = songs.reduce(
        (best, s, i) =>
          s.bar_count! > 8 && featureScores[i] < featureScores[best]
            ? i
            : best,
        songs.findIndex((s) => s.bar_count! > 8)
      );
      if (candidateIdx >= 0 && songs[candidateIdx].bar_count! > 8) {
        songs[candidateIdx].bar_count = Math.max(
          8,
          songs[candidateIdx].bar_count! - 8
        ) as 8 | 16 | 24 | 32;
      } else {
        break;
      }
    } else {
      // Too short: lengthen the most-featured song that isn't already 32
      const candidateIdx = songs.reduce(
        (best, s, i) =>
          s.bar_count! < 32 && featureScores[i] > featureScores[best]
            ? i
            : best,
        songs.findIndex((s) => s.bar_count! < 32)
      );
      if (candidateIdx >= 0 && songs[candidateIdx].bar_count! < 32) {
        songs[candidateIdx].bar_count = Math.min(
          32,
          songs[candidateIdx].bar_count! + 8
        ) as 8 | 16 | 24 | 32;
      } else {
        break;
      }
    }
    iterations++;
  }

  // Recalculate snippet_duration from bar_count and BPM
  for (const song of songs) {
    song.snippet_duration = Math.round((song.bar_count! * 4 * 60) / song.bpm);
  }
}

// ── Section selection ───────────────────────────────────────────────────────

function assignSections(songs: MedleySong[]): void {
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];

    // Default: chorus (most recognizable)
    song.section = 'chorus';

    // Instrumental section for guitar/keyboard showcase songs with shorter bars
    if (
      (song.guitar_driven || song.keyboard_driven) &&
      song.vocal_gender === 'Instrumental'
    ) {
      song.section = 'instrumental';
    }

    // If the song is being used as a mashup underlay, it becomes instrumental
    // (this gets overridden in the mashup detection phase)

    // Occasional verse for variety (every ~6th song, if not a singalong)
    if (i % 6 === 3 && !song.crowd_singalong && song.bar_count! >= 16) {
      song.section = 'verse';
    }

    // Bridge for energy transitions (when going from high to low energy)
    if (
      i > 0 &&
      songs[i - 1].energy === 'High' &&
      song.energy === 'Low' &&
      song.bar_count! >= 16
    ) {
      song.section = 'bridge';
    }
  }
}

// ── Transition selection ────────────────────────────────────────────────────

function assignTransitions(songs: MedleySong[]): void {
  for (let i = 0; i < songs.length; i++) {
    if (i === 0) {
      songs[i].transition_in = 'hard_cut'; // first song: just start
      continue;
    }

    const prev = songs[i - 1];
    const curr = songs[i];
    const bpmDiff = getEffectiveBpmDiff(prev.bpm, curr.bpm);
    const keysCompat = areKeysCompatible(prev.key, curr.key);
    const keyDist = getCamelotDistance(prev.key, curr.key);

    // Check for half/double-time relationship
    const halfDouble = isHalfDoubleTime(prev.bpm, curr.bpm);

    if (bpmDiff <= 5 && keysCompat) {
      // Perfect match: clean hard cut
      curr.transition_in = 'hard_cut';
    } else if (bpmDiff <= 5 && !keysCompat) {
      // BPM matches but key doesn't: modulate
      curr.transition_in = 'key_ramp';
    } else if (halfDouble) {
      // Half/double-time: drum fill bridges the feel change
      curr.transition_in = 'drum_fill';
    } else if (bpmDiff <= 20) {
      // Moderate BPM diff: ramp tempo
      curr.transition_in = 'tempo_ramp';
    } else if (
      curr.energy === 'Low' ||
      (prev.energy === 'High' && curr.energy === 'Medium')
    ) {
      // Big BPM diff + energy drop: fade transition
      curr.transition_in = 'vamp_fade';
    } else if (
      isBassGenre(prev.genre) ||
      isBassGenre(curr.genre)
    ) {
      // Bass-heavy genres: bass bridge
      curr.transition_in = 'bass_bridge';
    } else if (bpmDiff > 30) {
      // Big BPM jump: drum fill to reset feel
      curr.transition_in = 'drum_fill';
    } else {
      // Default for moderate differences
      curr.transition_in = 'tempo_ramp';
    }
  }
}

function isBassGenre(genre: string): boolean {
  const bassGenres = ['funk', 'disco', 'r&b', 'soul', 'motown', 'reggae'];
  return bassGenres.some((g) => genre.toLowerCase().includes(g));
}

// ── Tempo treatment notes ───────────────────────────────────────────────────

function assignTempoTreatments(songs: MedleySong[]): void {
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];

    if (i === 0) {
      song.tempo_treatment = `Start at ${song.bpm} BPM`;
      continue;
    }

    const prev = songs[i - 1];
    const bpmDiff = getEffectiveBpmDiff(prev.bpm, song.bpm);
    const effectivePrevBpm = getEffectiveBpm(prev.bpm, song.bpm);

    if (isHalfDoubleTime(prev.bpm, song.bpm)) {
      if (song.bpm > prev.bpm) {
        song.tempo_treatment = `Double-time: ${prev.bpm}→${song.bpm} BPM (same pulse, twice the subdivisions)`;
      } else {
        song.tempo_treatment = `Half-time: ${prev.bpm}→${song.bpm} BPM (same pulse, half the subdivisions)`;
      }
    } else if (bpmDiff <= 3) {
      song.tempo_treatment = `Hold tempo from previous (${prev.bpm}→${song.bpm}, close enough)`;
    } else if (bpmDiff <= 10) {
      song.tempo_treatment = `Slight ${song.bpm > prev.bpm ? 'push' : 'pull'}: ${prev.bpm}→${song.bpm} BPM`;
    } else if (bpmDiff <= 20) {
      song.tempo_treatment = `Ramp ${prev.bpm}→${song.bpm} BPM over 4 bars`;
    } else {
      song.tempo_treatment = `New tempo: ${song.bpm} BPM (from ${prev.bpm})`;
    }
  }
}

// ── Mashup detection ────────────────────────────────────────────────────────

interface MashupOpportunity {
  idx1: number; // instrumental underlay song index
  idx2: number; // vocal overlay song index
  reason: string;
}

function detectMashups(songs: MedleySong[]): MashupOpportunity[] {
  const mashups: MashupOpportunity[] = [];

  for (let i = 0; i < songs.length - 1; i++) {
    const a = songs[i];
    const b = songs[i + 1];

    const bpmDiff = getEffectiveBpmDiff(a.bpm, b.bpm);
    const keyDist = getCamelotDistance(a.key, b.key);

    // Must be BPM-compatible and key-compatible
    if (bpmDiff > 8 || keyDist > 2) continue;

    // Need complementary instrumentation
    // One should be more instrumental, the other more vocal
    const aInstrumental =
      a.guitar_driven || a.keyboard_driven || a.vocal_gender === 'Instrumental';
    const bInstrumental =
      b.guitar_driven || b.keyboard_driven || b.vocal_gender === 'Instrumental';
    const aVocal = a.crowd_singalong || a.vocal_gender !== 'Instrumental';
    const bVocal = b.crowd_singalong || b.vocal_gender !== 'Instrumental';

    if (aInstrumental && bVocal && !aVocal) {
      // A provides the bed, B sings over it
      mashups.push({
        idx1: i,
        idx2: i + 1,
        reason: `${a.title} instrumental bed + ${b.title} vocals`,
      });
    } else if (bInstrumental && aVocal && !bVocal) {
      // B provides the bed, A sings over it (but A comes first, so this is
      // more like: play A vocals, then B instrumental comes in underneath)
      mashups.push({
        idx1: i + 1,
        idx2: i,
        reason: `${b.title} instrumental bed + ${a.title} vocals`,
      });
    } else if (
      aInstrumental &&
      bVocal &&
      bpmDiff <= 3 &&
      keyDist <= 1
    ) {
      // Very tight match: worth mashing even if A has vocals
      mashups.push({
        idx1: i,
        idx2: i + 1,
        reason: `Tight match (${bpmDiff} BPM diff, ${keyDist} key steps): play ${a.title} as instrumental bed under ${b.title} vocals`,
      });
    }
  }

  return mashups;
}

function applyMashups(
  songs: MedleySong[],
  mashups: MashupOpportunity[]
): void {
  for (const mashup of mashups) {
    const underlay = songs[mashup.idx1];
    const overlay = songs[mashup.idx2];

    // The underlay plays as instrumental
    underlay.section = 'instrumental';
    underlay.arrangement_notes = `MASHUP: Play as instrumental bed under ${overlay.title}. ${mashup.reason}`;
    underlay.featured_instruments = [];
    if (underlay.guitar_driven) underlay.featured_instruments.push('guitar');
    if (underlay.keyboard_driven) underlay.featured_instruments.push('keys');
    if (underlay.horn_friendly) underlay.featured_instruments.push('horns');

    // The overlay sings over the underlay
    overlay.arrangement_notes = `MASHUP: Sing over ${underlay.title} instrumental. ${mashup.reason}`;
    if (overlay.section !== 'chorus') overlay.section = 'chorus';

    // Both should be the same length for the overlap
    const maxBars = Math.max(underlay.bar_count!, overlay.bar_count!);
    underlay.bar_count = maxBars as 8 | 16 | 24 | 32;
    overlay.bar_count = maxBars as 8 | 16 | 24 | 32;

    // Recalculate durations
    underlay.snippet_duration = Math.round(
      (underlay.bar_count * 4 * 60) / underlay.bpm
    );
    overlay.snippet_duration = Math.round(
      (overlay.bar_count * 4 * 60) / overlay.bpm
    );

    // Transition between them should be seamless
    if (mashup.idx2 > mashup.idx1) {
      overlay.transition_in = 'hard_cut';
    } else {
      underlay.transition_in = 'hard_cut';
    }
  }
}

// ── Crowd moment placement ──────────────────────────────────────────────────

function assignCrowdMoments(groups: DecadeGroup[]): void {
  const allSongs = groups.flatMap((g) => g.songs);

  // Reset all crowd moments
  for (const song of allSongs) {
    song.crowd_moment = false;
  }

  // Within each decade, place crowd moments strategically
  for (const group of groups) {
    const songs = group.songs;
    if (songs.length === 0) continue;

    // Find singalong-worthy songs
    const singalongIdxs = songs
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.crowd_singalong)
      .map(({ i }) => i);

    if (singalongIdxs.length === 0) {
      // No singalongs: pick the highest-energy song as the crowd moment
      const bestIdx = songs.reduce(
        (best, s, i) =>
          s.energy === 'High' && songs[best].energy !== 'High' ? i : best,
        0
      );
      songs[bestIdx].crowd_moment = true;
      continue;
    }

    // Place crowd moments with spacing (at least 2 songs apart)
    let lastCrowdIdx = -3;
    // Prioritize the one at ~60-75% through the decade (the peak)
    const peakIdx = Math.floor(songs.length * 0.65);
    const peakSingalong = singalongIdxs.reduce((best, idx) =>
      Math.abs(idx - peakIdx) < Math.abs(best - peakIdx) ? idx : best
    );

    // Mark the peak singalong
    songs[peakSingalong].crowd_moment = true;
    lastCrowdIdx = peakSingalong;

    // Fill in other crowd moments with spacing
    for (const idx of singalongIdxs) {
      if (idx === peakSingalong) continue;
      if (Math.abs(idx - lastCrowdIdx) >= 3) {
        songs[idx].crowd_moment = true;
        lastCrowdIdx = idx;
      }
    }
  }

  // Ensure grand finale: last song should be a crowd moment
  if (allSongs.length > 0) {
    allSongs[allSongs.length - 1].crowd_moment = true;
  }
}

// ── Featured instruments ────────────────────────────────────────────────────

function assignFeaturedInstruments(songs: MedleySong[]): void {
  for (const song of songs) {
    // Don't overwrite mashup-assigned instruments
    if (
      song.featured_instruments &&
      song.featured_instruments.length > 0
    )
      continue;

    const instruments: string[] = [];
    if (song.horn_friendly) instruments.push('horns');
    if (song.guitar_driven) instruments.push('guitar');
    if (song.keyboard_driven) instruments.push('keys');
    if (song.crowd_singalong && song.section === 'chorus')
      instruments.push('vocals');

    song.featured_instruments = instruments;
  }
}

// ── Arrangement notes for non-mashup songs ──────────────────────────────────

function assignArrangementNotes(songs: MedleySong[]): void {
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];

    // Don't overwrite mashup notes
    if (song.arrangement_notes && song.arrangement_notes.startsWith('MASHUP'))
      continue;

    const notes: string[] = [];

    if (song.bar_count === 32) {
      notes.push('FEATURE: Full showcase, let it breathe');
    } else if (song.bar_count === 8) {
      notes.push('QUICK HIT: Get in, nail the hook, get out');
    }

    if (song.crowd_moment) {
      notes.push('CROWD MOMENT: Encourage audience singalong');
    }

    if (song.section === 'instrumental') {
      notes.push('Instrumental focus — let the band shine');
    }

    if (song.section === 'verse' && song.crowd_singalong) {
      notes.push('Playing verse for variety — crowd knows this one');
    }

    if (i > 0) {
      const prev = songs[i - 1];
      if (isHalfDoubleTime(prev.bpm, song.bpm)) {
        notes.push(
          song.bpm > prev.bpm
            ? 'Double-time feel change — energy boost!'
            : 'Half-time feel — pull back, create space'
        );
      }
    }

    song.arrangement_notes = notes.length > 0 ? notes.join('. ') : undefined;
  }
}

// ── Main entry point ────────────────────────────────────────────────────────

export interface ArrangementResult {
  songs: MedleySong[];
  stats: {
    totalSongs: number;
    totalDuration: string;
    mashupCount: number;
    avgCamelotDistance: number;
    crowdMoments: number;
    transitionBreakdown: Record<string, number>;
  };
}

export function autoArrange(songs: MedleySong[]): ArrangementResult {
  if (songs.length === 0) {
    return {
      songs: [],
      stats: {
        totalSongs: 0,
        totalDuration: '0:00',
        mashupCount: 0,
        avgCamelotDistance: 0,
        crowdMoments: 0,
        transitionBreakdown: {},
      },
    };
  }

  // 1. Group by decade
  const groups = groupByDecade(songs);

  // 2. Reorder within each decade for BPM/key flow
  for (const group of groups) {
    group.songs = reorderWithinDecade(
      group.songs,
      group.label === 'The Sprint'
    );
  }

  // 3. Optimize decade boundary transitions
  optimizeDecadeBoundaries(groups);

  // 4. Assign bar counts (respecting decade time budgets)
  for (const group of groups) {
    assignBarCounts(group);
  }

  // 5. Flatten back to ordered list
  const arranged = groups.flatMap((g) => g.songs);

  // 6. Assign sections
  assignSections(arranged);

  // 7. Detect and apply mashups (before transitions, as mashups affect transitions)
  const mashups = detectMashups(arranged);
  applyMashups(arranged, mashups);

  // 8. Assign transitions
  assignTransitions(arranged);

  // 9. Assign tempo treatments
  assignTempoTreatments(arranged);

  // 10. Assign crowd moments
  assignCrowdMoments(groups);

  // 11. Assign featured instruments
  assignFeaturedInstruments(arranged);

  // 12. Generate arrangement notes
  assignArrangementNotes(arranged);

  // ── Compute stats ──
  const totalSeconds = arranged.reduce(
    (sum, s) => sum + s.snippet_duration,
    0
  );
  const totalMin = Math.floor(totalSeconds / 60);
  const totalSec = totalSeconds % 60;

  let totalKeyDist = 0;
  let keyPairs = 0;
  const transitionBreakdown: Record<string, number> = {};
  for (let i = 1; i < arranged.length; i++) {
    totalKeyDist += getCamelotDistance(arranged[i - 1].key, arranged[i].key);
    keyPairs++;
    const t = arranged[i].transition_in || 'hard_cut';
    transitionBreakdown[t] = (transitionBreakdown[t] || 0) + 1;
  }

  return {
    songs: arranged,
    stats: {
      totalSongs: arranged.length,
      totalDuration: `${totalMin}:${totalSec.toString().padStart(2, '0')}`,
      mashupCount: mashups.length,
      avgCamelotDistance:
        keyPairs > 0 ? Math.round((totalKeyDist / keyPairs) * 10) / 10 : 0,
      crowdMoments: arranged.filter((s) => s.crowd_moment).length,
      transitionBreakdown,
    },
  };
}
