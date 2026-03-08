# Expanded Catalog + Two-Stage Block Arrangement — Implementation Plan

## Context

Australian work event audience. Band-playable songs. 100 years of music (1926–2025). Currently 470 songs; need 2000–5000 candidates. Two-stage arrangement: discover blocks of songs that flow well together, then assemble blocks into the full medley.

---

## 1. Expand Song Catalog to ~3000 Songs

### Approach: LLM-generate in batches by decade

Generate songs in the existing compact tuple format. Each batch covers a decade and a genre slice. Target counts:

| Era | Target | Notes |
|-----|--------|-------|
| 1926–1949 (The Sprint) | ~200 | Swing, big band, jazz standards |
| 1950s | ~200 | Rock & roll, doo-wop, early R&B |
| 1960s | ~350 | Motown, British Invasion, surf, psychedelic |
| 1970s | ~400 | Disco, funk, prog rock, punk, soul, Oz rock |
| 1980s | ~500 | New wave, synth-pop, hair metal, hip-hop, Oz pub rock |
| 1990s | ~500 | Grunge, Britpop, pop, hip-hop, dance, Oz alt-rock |
| 2000s | ~400 | Pop, R&B, indie, hip-hop, dance, Oz |
| 2010s | ~350 | EDM, pop, hip-hop, indie, Oz |
| 2020s | ~150 | Current hits, Oz artists |

### Australian flavour

Each decade gets a healthy dose of Australian artists:
- 1960s: The Easybeats, The Seekers
- 1970s: AC/DC, Skyhooks, Sherbet, John Paul Young
- 1980s: INXS, Midnight Oil, Men at Work, Crowded House, Icehouse, Divinyls
- 1990s: Silverchair, Savage Garden, Natalie Imbruglia, Powderfinger
- 2000s: Jet, Missy Higgins, Wolfmother, Empire of the Sun
- 2010s: Tame Impala, Flume, Vance Joy, Sia, Dean Lewis
- 2020s: The Kid LAROI, Tones and I, Genesis Owusu

### Implementation

- New files: `src/data/catalog-DECADE.ts` (one per era)
- Each file exports `SongTuple[]` in the same compact format
- `src/data/index.ts` updated to merge all catalogs into `allSongs`
- Old `songs.ts` preserved as the "curated core" (these get a slight priority boost in selection)
- I'll generate these using Claude, validating BPM/key accuracy for well-known songs

### Work event considerations

- Heavy emphasis on crowd-singalong songs (everyone knows the chorus)
- Party/dance energy skews high
- Include "guilty pleasure" hits people secretly love
- Skip songs that are too niche, too dark, or too slow to work in a live medley
- Include novelty/fun songs (e.g., "You're the Voice", "Nutbush City Limits")

---

## 2. Two-Stage Block Architecture

### New file: `src/block-discovery.ts`

**Stage 1: Discover Blocks**

A "block" is 3–6 songs that flow naturally together — similar BPM range, compatible keys, good energy arc within the block.

```typescript
interface SongBlock {
  id: string;
  songIndices: number[];       // indices into catalog
  decade: string;
  entryBpm: number;            // BPM of first song
  exitBpm: number;             // BPM of last song
  entryKey: string;            // Key of first song
  exitKey: string;             // Key of last song
  avgEnergy: number;           // 0-2
  totalCost: number;           // sum of internal transition costs
  totalDuration: number;       // estimated seconds
  hasCrowdMoment: boolean;     // contains a singalong
  narrative?: string;          // LLM-generated description
}
```

**Algorithm:**
1. For each decade, build a local compatibility matrix (only songs in that decade)
2. For each song, find its top-K neighbors (K=20) by compatibility score
3. Grow blocks greedily: start from each song, extend by picking the best next neighbor that doesn't break the block's BPM range (max 25 BPM spread) or key coherence
4. Score each block: internal transition cost + energy flow penalty + crowd moment bonus
5. Deduplicate overlapping blocks (if two blocks share >50% songs, keep the better one)
6. Result: ~200-500 blocks per decade

**LLM enhancement (optional, if API key present):**
- Send top 50 blocks per decade to Claude for evaluation
- Claude rates each block 1-5 on "how fun would this run be live?"
- Claude suggests reorderings within blocks
- Claude adds narrative descriptions ("Motown buildup: starts mellow, hits the singalong")

### New file: `src/block-assembly.ts`

**Stage 2: Assemble Blocks into Medley**

```typescript
interface AssemblyConfig {
  blocksPerDecade: Record<string, number>;  // how many blocks to use per decade
  targetDuration: number;                    // total medley seconds
  energyArc: EnergyArcPoint[];              // same as current
}
```

**Algorithm:**
1. For each decade, select the best N blocks (respecting target block count)
   - Ensure coverage: at least one block with a crowd moment, variety of tempos
   - No song appears in more than one selected block
2. Order blocks within each decade:
   - Beam search over block orderings (much smaller search space than individual songs)
   - Score: exit→entry compatibility between adjacent blocks + energy arc fit
3. Optimize block boundaries:
   - For each pair of adjacent blocks, try swapping the edge songs (last of block A ↔ first of block B) to improve the transition
   - Simulated annealing on edge swaps
4. Cross-decade transitions:
   - The last block of decade N and first block of decade N+1 are chosen/ordered to minimize the boundary cost

**LLM enhancement:**
- Send the full block sequence to Claude
- Claude evaluates the overall arc and suggests block swaps
- Claude identifies mashup opportunities at block boundaries

---

## 3. Updated Generator Pipeline

Update `src/generator.ts` to use the two-stage approach:

```
Stage 1: Build catalog compatibility (5%)
Stage 2: Discover blocks per decade (10-30%)
Stage 3: LLM block evaluation (30-50%)
Stage 4: Assemble blocks into medley (50-65%)
Stage 5: LLM assembly evaluation + mashups (65-80%)
Stage 6: Final arrangement (autoArrange) (80-95%)
Stage 7: Complete (100%)
```

Progress reporting updates in real-time. Expected total runtime: 30-90 seconds depending on catalog size and whether LLM stages are active.

---

## 4. UI Updates

### MedleyPlanner changes
- Show catalog size: "3,247 songs in catalog"
- Generation progress bar shows current stage name
- After generation, show stats: "Explored 847 blocks, selected 24 blocks, 87 songs"

### New: Block Visualization (optional)
- In ArrangementView, show block boundaries as visual separators
- Each block gets a subtle background color
- Block narrative shown as a tooltip or expandable section

---

## 5. Implementation Order

1. **Generate expanded song catalog** — batch by decade, ~10 files
2. **Update data/index.ts** — merge all catalogs
3. **Build `block-discovery.ts`** — block finding algorithm
4. **Build `block-assembly.ts`** — block ordering + optimization
5. **Update `generator.ts`** — wire in two-stage pipeline
6. **Update UI** — progress stages, block stats, block visualization
7. **Test & tune** — run on full catalog, review output quality

---

## 6. What This Does NOT Change

- Manual editing — all auto-arranged values remain editable
- Export — already handles whatever songs are in the medley
- Easter eggs — untouched
- Ableton export — untouched
- Compatibility scoring — same algorithm, just more songs
