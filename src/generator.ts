/**
 * Generative Medley Pipeline
 *
 * Orchestrates the three-layer architecture:
 * 1. Compatibility graph (algorithmic)
 * 2. Beam search + simulated annealing (algorithmic)
 * 3. LLM creative direction (Opus 4.6)
 *
 * Produces a complete medley from the full song catalog.
 */

import type { Song, MedleySong } from './types';
import { scoreTransition } from './compatibility';
import {
  findPaths,
  refinePath,
  getDefaultConfig,
  type GenerationConfig,
  type GeneratedPath,
} from './path-finder';
import {
  hasApiKey,
  evaluatePaths,
  discoverMashups,
  generateArrangementNotes,
  suggestBridgeSongs,
  type LLMMashupSuggestion,
} from './llm';
import { autoArrange, type ArrangementResult } from './arranger';

// ── Pipeline types ──────────────────────────────────────────────────────────

export interface GenerationProgress {
  stage: 'compatibility' | 'beam_search' | 'refinement' | 'llm_evaluation' | 'llm_mashups' | 'llm_notes' | 'llm_bridges' | 'final_arrange' | 'complete';
  message: string;
  percent: number;
}

export interface GenerationResult {
  /** The final arranged medley */
  arrangement: ArrangementResult;

  /** LLM-generated narrative (if API available) */
  narrative?: string;

  /** LLM-suggested mashups (if API available) */
  llmMashups?: LLMMashupSuggestion[];

  /** Stats about the generation process */
  generationStats: {
    candidatePathsExplored: number;
    totalCatalogSize: number;
    selectedSongCount: number;
    refinementIterations: number;
    llmUsed: boolean;
  };
}

// ── Main pipeline ───────────────────────────────────────────────────────────

/**
 * Run the full generative medley pipeline.
 *
 * @param catalog - The full song database
 * @param pinnedSongIds - Songs that must be included
 * @param onProgress - Progress callback for UI updates
 * @returns Complete medley arrangement
 */
export async function generateMedley(
  catalog: Song[],
  pinnedSongIds: Set<string> = new Set(),
  onProgress?: (progress: GenerationProgress) => void
): Promise<GenerationResult> {
  const progress = (stage: GenerationProgress['stage'], message: string, percent: number) => {
    onProgress?.({ stage, message, percent });
  };

  // ── Stage 1: Build compatibility matrix + beam search ──
  progress('compatibility', 'Computing song compatibility scores...', 5);

  const config: GenerationConfig = {
    ...getDefaultConfig(),
    pinnedSongIds,
  };

  progress('beam_search', 'Finding optimal paths through the catalog...', 15);

  const { paths, matrix } = findPaths(catalog, config);

  if (paths.length === 0) {
    throw new Error('No valid paths found. Try reducing constraints.');
  }

  progress('beam_search', `Found ${paths.length} candidate paths`, 30);

  // ── Stage 2: Refine top paths with simulated annealing ──
  progress('refinement', 'Polishing paths with simulated annealing...', 35);

  const refinedPaths: GeneratedPath[] = [];
  for (const path of paths.slice(0, 3)) {
    const refined = refinePath(path, catalog, matrix, config, 3000);
    refinedPaths.push(refined);
  }

  refinedPaths.sort((a, b) => a.totalCost - b.totalCost);
  progress('refinement', 'Paths refined', 45);

  // ── Stage 3: LLM evaluation (if API key available) ──
  let bestPath = refinedPaths[0];
  let narrative: string | undefined;
  let llmMashups: LLMMashupSuggestion[] | undefined;
  const llmUsed = hasApiKey();

  if (llmUsed) {
    try {
      // Convert paths to song arrays for LLM
      const candidateSongPaths = refinedPaths.slice(0, 3).map(
        p => p.songIndices.map(i => catalog[i])
      );

      progress('llm_evaluation', 'Asking Claude to evaluate arrangements...', 50);

      const evaluation = await evaluatePaths(candidateSongPaths, catalog);
      if (evaluation.ranking.length > 0) {
        bestPath = refinedPaths[evaluation.ranking[0]];
      }

      // Apply suggested swaps
      if (evaluation.suggestedSwaps.length > 0) {
        const songIndices = [...bestPath.songIndices];
        for (const swap of evaluation.suggestedSwaps) {
          const currentIdx = songIndices.findIndex(
            i => catalog[i].title === swap.currentSongTitle
          );
          const newIdx = catalog.findIndex(
            s => s.title === swap.suggestedSongTitle
          );
          if (currentIdx >= 0 && newIdx >= 0 && !songIndices.includes(newIdx)) {
            songIndices[currentIdx] = newIdx;
          }
        }
        bestPath = { ...bestPath, songIndices };
      }

      progress('llm_evaluation', 'Claude evaluated and refined the arrangement', 60);

      // Find problematic transitions for bridge song suggestions
      const selectedSongs = bestPath.songIndices.map(i => catalog[i]);
      const problematic: { fromIdx: number; toIdx: number; cost: number }[] = [];
      for (let i = 0; i < selectedSongs.length - 1; i++) {
        const cost = scoreTransition(selectedSongs[i], selectedSongs[i + 1]).total;
        if (cost > 60) {
          problematic.push({ fromIdx: i, toIdx: i + 1, cost });
        }
      }

      if (problematic.length > 0) {
        progress('llm_bridges', 'Finding bridge songs for rough transitions...', 65);
        const bridges = await suggestBridgeSongs(selectedSongs, catalog, problematic);

        // Insert bridge songs
        if (bridges.length > 0) {
          const updatedIndices = [...bestPath.songIndices];
          let offset = 0;

          for (const bridge of bridges) {
            const bridgeSongIdx = catalog.findIndex(s => s.title === bridge.title);
            const insertAfterIdx = selectedSongs.findIndex(s => s.title === bridge.insertAfter);

            if (bridgeSongIdx >= 0 && insertAfterIdx >= 0 && !updatedIndices.includes(bridgeSongIdx)) {
              updatedIndices.splice(insertAfterIdx + 1 + offset, 0, bridgeSongIdx);
              offset++;
            }
          }

          bestPath = { ...bestPath, songIndices: updatedIndices };
        }
      }

      // Discover mashups
      progress('llm_mashups', 'Discovering creative mashup opportunities...', 70);
      const finalSongs = bestPath.songIndices.map(i => catalog[i]);
      llmMashups = await discoverMashups(finalSongs);

      // Generate arrangement notes
      progress('llm_notes', 'Generating arrangement notes...', 80);
      const notes = await generateArrangementNotes(finalSongs);
      narrative = notes.overallNarrative;

      // We'll store the LLM notes and apply them after autoArrange
      // (autoArrange generates its own notes, but LLM ones are better)

    } catch (err) {
      console.warn('LLM stage failed, continuing with algorithmic result:', err);
    }
  }

  // ── Stage 4: Convert to MedleySong[] and run final arrangement ──
  progress('final_arrange', 'Building final arrangement...', 90);

  const selectedSongs: MedleySong[] = bestPath.songIndices.map(idx => {
    const song = catalog[idx];
    return {
      ...song,
      medleyId: Math.random().toString(36).substring(2, 10),
      snippet_duration: song.crowd_singalong ? 55 : 45,
      section: 'chorus' as const,
      bar_count: 16,
      transition_in: 'hard_cut' as const,
      featured_instruments: [],
      crowd_moment: song.crowd_singalong,
      easter_egg: false,
    };
  });

  // Run the existing arrangement engine on the selected songs
  const arrangement = autoArrange(selectedSongs);

  // If we have LLM narrative, attach it
  if (narrative) {
    // Store narrative in the first song's arrangement_notes as a header
    if (arrangement.songs.length > 0) {
      arrangement.songs[0].arrangement_notes =
        `MEDLEY NARRATIVE: ${narrative}\n\n${arrangement.songs[0].arrangement_notes || ''}`;
    }
  }

  progress('complete', 'Medley generated!', 100);

  return {
    arrangement,
    narrative,
    llmMashups,
    generationStats: {
      candidatePathsExplored: paths.length,
      totalCatalogSize: catalog.length,
      selectedSongCount: bestPath.songIndices.length,
      refinementIterations: 3000,
      llmUsed,
    },
  };
}
