#!/usr/bin/env npx tsx
/**
 * Apply Chord Enrichment to Song Data Files
 *
 * Reads the chord-enrichment.json output from enrich-chords.ts and patches
 * the SongTuple entries in the source files with chord progression data.
 *
 * Usage:
 *   npx tsx scripts/apply-chords.ts [--input chord-enrichment.json] [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const inputIdx = args.indexOf('--input');
const inputFile = inputIdx >= 0 && args[inputIdx + 1] ? args[inputIdx + 1] : 'chord-enrichment.json';

interface ChordResult {
  title: string;
  artist: string;
  year: number;
  chords_verse: string;
  chords_chorus: string;
  confidence: 'high' | 'medium' | 'low';
}

const inputPath = resolve(ROOT, inputFile);
if (!existsSync(inputPath)) {
  console.error(`Error: ${inputFile} not found. Run enrich-chords.ts first.`);
  process.exit(1);
}

const results: ChordResult[] = JSON.parse(readFileSync(inputPath, 'utf-8'));
console.log(`Loaded ${results.length} chord enrichment results`);

// Build lookup by title (case-insensitive, normalized)
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const lookup = new Map<string, ChordResult>();
for (const r of results) {
  lookup.set(normalize(r.title), r);
}

// ── Patch tuple files ────────────────────────────────────────────────────────

const dataFiles = [
  'src/data/songs.ts',
  'src/data/catalog-1950s.ts',
  'src/data/catalog-1960s.ts',
  'src/data/catalog-1970s.ts',
  'src/data/catalog-1980s.ts',
  'src/data/catalog-1990s.ts',
  'src/data/catalog-2000s.ts',
  'src/data/catalog-2010s.ts',
  'src/data/catalog-2020s.ts',
];

let totalPatched = 0;
let totalSkipped = 0;

for (const relPath of dataFiles) {
  const filePath = resolve(ROOT, relPath);
  if (!existsSync(filePath)) continue;

  let src = readFileSync(filePath, 'utf-8');
  let patchCount = 0;

  // Match tuple lines and append chord fields if missing
  // Pattern: ends with ', 'some notes'], or ', 'some notes'],\n
  // We need to find lines that have the notes field but no chord fields yet
  const patched = src.replace(
    /(\[\s*'([^']+(?:\\.[^']*)*)',\s*'[^']*',\s*\d+,\s*'[^']*',\s*\d+,\s*'[^']*',\s*'[^']*',\s*'[MFXI]',\s*'[LMH]',\s*\d+,\s*'[^']*')\s*\]/g,
    (fullMatch, tupleBody, title) => {
      const cleanTitle = title.replace(/\\'/g, "'");
      const chord = lookup.get(normalize(cleanTitle));
      if (!chord || (!chord.chords_verse && !chord.chords_chorus)) {
        totalSkipped++;
        return fullMatch;
      }
      patchCount++;
      totalPatched++;
      return `${tupleBody}, '${chord.chords_verse}', '${chord.chords_chorus}']`;
    }
  );

  if (patchCount > 0) {
    console.log(`${relPath}: patched ${patchCount} songs`);
    if (!dryRun) {
      writeFileSync(filePath, patched);
    }
  }
}

console.log(`\nTotal: ${totalPatched} patched, ${totalSkipped} skipped${dryRun ? ' (dry run)' : ''}`);
