#!/usr/bin/env npx tsx
/**
 * Chord Progression Enrichment Script
 *
 * Uses Claude to batch-generate Roman numeral chord progressions (verse + chorus)
 * for songs in the catalog. Outputs a patch file that can be applied to the
 * song data files.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/enrich-chords.ts [options]
 *
 * Options:
 *   --decade <decade>     Only process a specific decade (e.g. "1950s", "1970s")
 *   --dry-run             Print what would be sent to the LLM without calling it
 *   --batch-size <n>      Songs per LLM call (default: 30)
 *   --output <file>       Output JSON file (default: chord-enrichment.json)
 *   --skip-before <year>  Skip songs before this year (default: 0, use 1950 to skip early decades)
 */

const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY || '';

if (!API_KEY) {
  console.error('Error: Set ANTHROPIC_API_KEY or VITE_ANTHROPIC_API_KEY environment variable');
  process.exit(1);
}

// ── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultValue;
}
const filterDecade = getArg('decade', '');
const dryRun = args.includes('--dry-run');
const batchSize = parseInt(getArg('batch-size', '30'), 10);
const outputFile = getArg('output', 'chord-enrichment.json');
const skipBefore = parseInt(getArg('skip-before', '0'), 10);

// ── Song catalog import ──────────────────────────────────────────────────────
// We read the raw tuple data directly to avoid needing the full Vite build

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

interface SongInfo {
  title: string;
  artist: string;
  year: number;
  decade: string;
  key: string;
  genre: string;
  bpm: number;
  // For patching back
  sourceFile: string;
}

/**
 * Extract song info from a TypeScript tuple-array source file.
 * Handles the compact SongTuple format: ['title', 'artist', year, 'decade', bpm, 'key', 'genre', ...]
 */
function extractSongsFromTupleFile(filePath: string, sourceLabel: string): SongInfo[] {
  const src = readFileSync(filePath, 'utf-8');
  const songs: SongInfo[] = [];

  // Match each tuple line: ['Title', 'Artist', year, 'decade', bpm, 'key', 'genre', ...]
  const tupleRegex = /\[\s*'([^']+(?:\\.[^']*)*)',\s*'([^']+(?:\\.[^']*)*)',\s*(\d+),\s*'([^']+)',\s*(\d+),\s*'([^']+)',\s*'([^']+)'/g;
  let match;
  while ((match = tupleRegex.exec(src)) !== null) {
    songs.push({
      title: match[1].replace(/\\'/g, "'"),
      artist: match[2].replace(/\\'/g, "'"),
      year: parseInt(match[3], 10),
      decade: match[4],
      bpm: parseInt(match[5], 10),
      key: match[6],
      genre: match[7],
      sourceFile: sourceLabel,
    });
  }
  return songs;
}

// Gather all songs from tuple-format files
const tupleFiles = [
  { path: resolve(ROOT, 'src/data/songs.ts'), label: 'songs.ts' },
  { path: resolve(ROOT, 'src/data/catalog-1950s.ts'), label: 'catalog-1950s.ts' },
  { path: resolve(ROOT, 'src/data/catalog-1960s.ts'), label: 'catalog-1960s.ts' },
  { path: resolve(ROOT, 'src/data/catalog-1970s.ts'), label: 'catalog-1970s.ts' },
  { path: resolve(ROOT, 'src/data/catalog-1980s.ts'), label: 'catalog-1980s.ts' },
  { path: resolve(ROOT, 'src/data/catalog-1990s.ts'), label: 'catalog-1990s.ts' },
  { path: resolve(ROOT, 'src/data/catalog-2000s.ts'), label: 'catalog-2000s.ts' },
  { path: resolve(ROOT, 'src/data/catalog-2010s.ts'), label: 'catalog-2010s.ts' },
  { path: resolve(ROOT, 'src/data/catalog-2020s.ts'), label: 'catalog-2020s.ts' },
];

let allSongs: SongInfo[] = [];
for (const { path, label } of tupleFiles) {
  if (existsSync(path)) {
    allSongs.push(...extractSongsFromTupleFile(path, label));
  }
}

// Deduplicate by title+artist (case-insensitive)
const seen = new Set<string>();
allSongs = allSongs.filter(s => {
  const key = `${s.title.toLowerCase()}|${s.artist.toLowerCase()}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

// Apply filters
if (skipBefore > 0) {
  allSongs = allSongs.filter(s => s.year >= skipBefore);
}
if (filterDecade) {
  allSongs = allSongs.filter(s => s.decade === filterDecade);
}

// Sort by year for consistent batching
allSongs.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

console.log(`Found ${allSongs.length} songs to enrich${filterDecade ? ` (${filterDecade})` : ''}${skipBefore ? ` (from ${skipBefore})` : ''}`);

// ── Load existing enrichment (for resumption) ────────────────────────────────

interface ChordResult {
  title: string;
  artist: string;
  year: number;
  chords_verse: string;
  chords_chorus: string;
  confidence: 'high' | 'medium' | 'low';
}

let existing: ChordResult[] = [];
const outputPath = resolve(ROOT, outputFile);
if (existsSync(outputPath)) {
  existing = JSON.parse(readFileSync(outputPath, 'utf-8'));
  console.log(`Loaded ${existing.length} existing results from ${outputFile}`);
}
const existingKeys = new Set(existing.map(r => `${r.title.toLowerCase()}|${r.artist.toLowerCase()}`));

// Filter out already-enriched songs
const toProcess = allSongs.filter(s => !existingKeys.has(`${s.title.toLowerCase()}|${s.artist.toLowerCase()}`));
console.log(`${toProcess.length} songs remaining to process (${allSongs.length - toProcess.length} already done)`);

if (toProcess.length === 0) {
  console.log('Nothing to do!');
  process.exit(0);
}

// ── LLM call ─────────────────────────────────────────────────────────────────

async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2025-04-14',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Claude API error ${resp.status}: ${err}`);
  }

  const data = await resp.json() as { content: Array<{ type: string; text?: string }> };
  const textBlock = data.content.find(b => b.type === 'text');
  return textBlock?.text || '';
}

const SYSTEM_PROMPT = `You are a music theory expert. Given a list of well-known songs, provide the core chord progression for the verse and chorus sections using Roman numeral notation (e.g. I-IV-V-I).

Rules:
- Use uppercase for major chords (I, IV, V) and lowercase for minor (ii, iii, vi)
- Use hyphens to separate chords: I-V-vi-IV
- For the verse AND chorus, give the core repeating progression (typically 4-8 chords)
- If a song only has one main progression throughout, use the same for both verse and chorus
- If you're genuinely unsure about a song, set confidence to "low"
- For well-known standards and hits, you should know these — set confidence to "high"
- Use common extensions where important: V7, IVmaj7, ii7, etc.
- For blues-based songs, use I-I-I-I-IV-IV-I-I-V-IV-I-V (12-bar) or abbreviated I-IV-V

Respond ONLY with a JSON array, no other text.`;

async function processBatch(batch: SongInfo[]): Promise<ChordResult[]> {
  const songList = batch.map((s, i) =>
    `${i + 1}. "${s.title}" - ${s.artist} (${s.year}) | Key: ${s.key} | Genre: ${s.genre} | BPM: ${s.bpm}`
  ).join('\n');

  const userMessage = `Provide chord progressions for these ${batch.length} songs:

${songList}

Respond as a JSON array:
[
  {"title": "Song Title", "artist": "Artist", "year": 1960, "chords_verse": "I-vi-IV-V", "chords_chorus": "I-V-vi-IV", "confidence": "high"},
  ...
]`;

  if (dryRun) {
    console.log('--- DRY RUN ---');
    console.log(userMessage.slice(0, 500));
    console.log('...');
    return [];
  }

  const response = await callClaude(SYSTEM_PROMPT, userMessage);

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in response');
    const parsed = JSON.parse(jsonMatch[0]) as ChordResult[];
    return parsed.filter(r => r.title && r.chords_verse);
  } catch (e) {
    console.warn(`Failed to parse batch response: ${(e as Error).message}`);
    console.warn('Response preview:', response.slice(0, 300));
    return [];
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  const results = [...existing];
  const batches: SongInfo[][] = [];

  for (let i = 0; i < toProcess.length; i += batchSize) {
    batches.push(toProcess.slice(i, i + batchSize));
  }

  console.log(`Processing ${batches.length} batches of up to ${batchSize} songs...`);

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const yearRange = `${batch[0].year}-${batch[batch.length - 1].year}`;
    console.log(`\nBatch ${bi + 1}/${batches.length} (${batch.length} songs, ${yearRange})...`);

    try {
      const batchResults = await processBatch(batch);
      results.push(...batchResults);
      console.log(`  → Got ${batchResults.length} results (${batchResults.filter(r => r.confidence === 'high').length} high confidence)`);

      // Save after each batch (for resumption)
      writeFileSync(outputPath, JSON.stringify(results, null, 2));

      // Rate limiting: wait between batches
      if (bi < batches.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {
      console.error(`  Batch ${bi + 1} failed: ${(e as Error).message}`);
      // Save what we have and continue
      writeFileSync(outputPath, JSON.stringify(results, null, 2));
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`\nDone! ${results.length} total results saved to ${outputFile}`);

  // Print stats
  const byConfidence = { high: 0, medium: 0, low: 0 };
  for (const r of results) {
    byConfidence[r.confidence || 'medium']++;
  }
  console.log(`Confidence: ${byConfidence.high} high, ${byConfidence.medium} medium, ${byConfidence.low} low`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
