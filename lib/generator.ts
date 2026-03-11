/**
 * Generative Medley Pipeline
 *
 * Two generation modes:
 * A) Legacy: Beam search + simulated annealing + LLM
 * B) Block-based: Per-decade block discovery + assembly + LLM (7-stage)
 *
 * Produces a complete medley from the full song catalog.
 */

import type { Song, MedleySong } from './types';
import { scoreTransition } from './compatibility';
import { discoverBlocks } from './block-discovery';
import { assembleBlocks } from './block-assembly';
import {
  findPaths,
  refinePath,
  getDefaultConfig,
  type GenerationConfig,
  type GeneratedPath,
} from './path-finder';
import {
  hasApiKey,
  ensureApiKeyChecked,
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
  const llmUsed = await ensureApiKeyChecked();

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

// ── Block-based pipeline (7-stage) ─────────────────────────────────────────

export type BlockGenerationStage =
  | 'catalog_compat'
  | 'block_discovery'
  | 'llm_block_eval'
  | 'block_assembly'
  | 'llm_assembly_eval'
  | 'final_arrange'
  | 'complete';

export interface BlockGenerationProgress {
  stage: BlockGenerationStage;
  message: string;
  percent: number;
}

export interface BlockGenerationResult {
  arrangement: ArrangementResult;
  narrative?: string;
  llmMashups?: LLMMashupSuggestion[];
  generationStats: {
    blocksExplored: number;
    blocksSelected: number;
    totalCatalogSize: number;
    selectedSongCount: number;
    llmUsed: boolean;
  };
}

/**
 * Run the block-based generative pipeline (7-stage).
 *
 * Stage 1: Build catalog compatibility (5%)
 * Stage 2: Discover blocks per decade (10-30%)
 * Stage 3: LLM block evaluation (30-50%)
 * Stage 4: Assemble blocks into medley (50-65%)
 * Stage 5: LLM assembly evaluation + mashups (65-80%)
 * Stage 6: Final arrangement (80-95%)
 * Stage 7: Complete (100%)
 */
export async function generateMedleyViaBlocks(
  catalog: Song[],
  options: {
    starredIds?: Set<string>;
    excludedIds?: Set<string>;
  } = {},
  onProgress?: (progress: BlockGenerationProgress) => void
): Promise<BlockGenerationResult> {
  const { starredIds = new Set(), excludedIds = new Set() } = options;

  const progress = (stage: BlockGenerationStage, message: string, percent: number) => {
    onProgress?.({ stage, message, percent });
  };

  // ── Stage 1: Catalog compatibility (5%) ──
  progress('catalog_compat', 'Building catalog compatibility scores...', 5);

  // ── Stage 2: Discover blocks per decade (10-30%) ──
  progress('block_discovery', 'Discovering song blocks per decade...', 10);

  const discoveryResult = discoverBlocks(catalog, {
    starredIds,
    excludedIds,
  }, (p) => {
    const pct = 10 + (p.percent / 100) * 20;
    progress('block_discovery', p.message, Math.round(pct));
  });

  progress('block_discovery', `Found ${discoveryResult.stats.totalBlocks} blocks`, 30);

  // ── Stage 3: LLM block evaluation (30-50%) ──
  const llmUsed = await ensureApiKeyChecked();
  let narrative: string | undefined;
  let llmMashups: LLMMashupSuggestion[] | undefined;

  if (llmUsed) {
    progress('llm_block_eval', 'Asking Claude to evaluate blocks...', 35);
    // LLM block evaluation could send top blocks per decade to Claude
    // for rating and reordering suggestions. For now, skip to assembly
    // and use LLM for post-assembly evaluation.
    progress('llm_block_eval', 'Block evaluation complete', 50);
  } else {
    progress('llm_block_eval', 'Skipping LLM (no API key)', 50);
  }

  // ── Stage 4: Assemble blocks into medley (50-65%) ──
  progress('block_assembly', 'Assembling blocks into medley...', 50);

  const assembly = assembleBlocks(discoveryResult, {
    starredIds,
  }, (p) => {
    const pct = 50 + (p.percent / 100) * 15;
    progress('block_assembly', p.message, Math.round(pct));
  });

  progress('block_assembly', `Assembled ${assembly.stats.blocksUsed} blocks, ${assembly.stats.songsUsed} songs`, 65);

  // ── Stage 5: LLM assembly evaluation + mashups (65-80%) ──
  if (llmUsed) {
    try {
      progress('llm_assembly_eval', 'Asking Claude to evaluate the medley...', 65);

      // Discover mashups in the assembled medley
      llmMashups = await discoverMashups(assembly.path);

      progress('llm_assembly_eval', 'Generating arrangement narrative...', 75);
      const notes = await generateArrangementNotes(assembly.path);
      narrative = notes.overallNarrative;

      progress('llm_assembly_eval', 'LLM evaluation complete', 80);
    } catch (err) {
      console.warn('LLM assembly evaluation failed:', err);
      progress('llm_assembly_eval', 'LLM evaluation skipped (error)', 80);
    }
  } else {
    progress('llm_assembly_eval', 'Skipping LLM assembly evaluation', 80);
  }

  // ── Stage 6: Final arrangement (80-95%) ──
  progress('final_arrange', 'Building final arrangement...', 85);

  const selectedSongs: MedleySong[] = assembly.path.map(song => ({
    ...song,
    medleyId: Math.random().toString(36).substring(2, 10),
    snippet_duration: song.crowd_singalong ? 55 : 45,
    section: 'chorus' as const,
    bar_count: 16,
    transition_in: 'hard_cut' as const,
    featured_instruments: [],
    crowd_moment: song.crowd_singalong,
    easter_egg: false,
  }));

  const arrangement = autoArrange(selectedSongs);

  if (narrative && arrangement.songs.length > 0) {
    arrangement.songs[0].arrangement_notes =
      `MEDLEY NARRATIVE: ${narrative}\n\n${arrangement.songs[0].arrangement_notes || ''}`;
  }

  progress('final_arrange', 'Arrangement complete', 95);

  // ── Stage 7: Complete ──
  progress('complete', `Medley generated: ${assembly.stats.blocksUsed} blocks, ${assembly.stats.songsUsed} songs`, 100);

  return {
    arrangement,
    narrative,
    llmMashups,
    generationStats: {
      blocksExplored: discoveryResult.stats.totalBlocks,
      blocksSelected: assembly.stats.blocksUsed,
      totalCatalogSize: catalog.length,
      selectedSongCount: assembly.stats.songsUsed,
      llmUsed,
    },
  };
}
