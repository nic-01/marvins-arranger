# Generative Arranger — Implementation Plan

## Overview

Create a new `src/arranger.ts` engine + "Auto-Arrange" button that transforms a flat list of medley songs into a musically intelligent arrangement. The engine makes all the decisions a skilled musical director would: tempo flow, key progressions, song durations, transition types, mashup opportunities, and energy arcs.

---

## 1. New file: `src/arranger.ts` — The Arrangement Engine

### 1a. Within-decade song reordering (BPM + Key flow)

Songs are already grouped by decade. Within each decade, reorder them to create smooth musical flow:

- **BPM sorting with key awareness**: Use a nearest-neighbor algorithm that scores each possible next song by:
  - BPM proximity (weighted heavily) — prefer songs within 10-15 BPM of each other
  - Camelot wheel distance (number of steps) — prefer compatible keys (0-1 step)
  - Half-time/double-time recognition: 70 BPM and 140 BPM should be considered compatible (one is playable at the other's tempo)
  - Energy continuity — avoid Low→High→Low whiplash; prefer gradual builds/cooldowns

- **"The Sprint" (pre-1950s) special case**: These are short, fast-paced — optimize purely for entertainment flow, keep BPM high, and use shorter durations.

- **Decade-boundary transitions**: The last song of a decade and the first song of the next decade are chosen to create the best possible bridge (best BPM/key match at the seam).

### 1b. Smart bar count assignment

Not everything should be 16 bars. The engine assigns bar counts based on song role:

| Criteria | Bar Count | Duration ~  |
|----------|-----------|-------------|
| Iconic crowd singalong + high energy | **32 bars** | ~70s |
| Standard featured song | **24 bars** | ~55s |
| Normal song in the flow | **16 bars** | ~40s |
| Quick hit / sprint / less-known | **8 bars** | ~20s |

Factors that influence bar count:
- `crowd_singalong: true` → boost (people need time to sing)
- `energy: 'High'` at a climactic position → boost
- Song recognition/fame (proxy: singalong + notes field)
- Decade time budget — if a decade has many songs, shorten them; if few, lengthen
- Variety — avoid 5x 16-bar songs in a row; mix it up

Snippet duration is recalculated from bar_count and BPM: `duration = (bar_count * 4 * 60) / bpm` (for 4/4 time).

### 1c. Section selection

Choose which part of the song to play:

- **chorus** (default for most): Crowd-pleasers, singalongs, iconic hooks
- **verse**: Songs famous for their verses (use `notes` field hints), or when the verse BPM better matches neighbors
- **instrumental**: Guitar-driven or keyboard-driven songs where the instrumental is iconic; also used for mashup underlays
- **bridge**: Occasional variety; used when the bridge creates a nice energy shift

### 1d. Transition type selection

Choose transitions based on the musical relationship between adjacent songs:

| Condition | Transition |
|-----------|-----------|
| BPM within 5 + key compatible | `hard_cut` — clean and punchy |
| BPM within 5 + key incompatible | `key_ramp` — modulate into the new key |
| BPM diff 6-20 + any key | `tempo_ramp` — gradual tempo shift |
| BPM diff 20+ entering a lower-energy song | `vamp_fade` — fade out, breathe, fade in |
| BPM diff 20+ entering a high-energy song | `drum_fill` — drummer bridges the gap |
| Bass-heavy genre (funk, disco, R&B) adjacent | `bass_bridge` — bass line walks between songs |

### 1e. Tempo treatment notes

For each song, generate a `tempo_treatment` string describing what the band does:
- "Play at original tempo (120 BPM)" — when no adjustment needed
- "Speed up from 98 to 110 BPM to match next song" — when a song is played slightly faster
- "Half-time feel at 140 BPM (feels like 70)" — for double-time matching
- "Band holds tempo from previous song (128→125, close enough)" — for small diffs

### 1f. Mashup / overlay detection

This is the marquee feature. When adjacent songs have:
- BPM within 5 (or half/double-time match)
- Compatible keys (Camelot ≤1 step)
- Complementary instrumentation (one vocal-focused, one instrument-focused)

...the engine suggests a **mashup overlay**:
- One song plays as `section: 'instrumental'`
- The next plays as `section: 'chorus'` (vocals over the previous instrumental)
- Both get `arrangement_notes` explaining the mashup
- `featured_instruments` are set to show what's playing from each song

### 1g. Energy arc shaping

Within each decade, shape the energy:
- **Opening**: Start medium-high to grab attention
- **Build**: Escalate energy through the middle
- **Peak**: Place the biggest crowd singalong moment 60-75% through the decade
- **Resolve**: Slight cooldown at end to set up the next decade transition

Cross-medley arc:
- The Sprint: High energy, fast pace
- 1950s-1960s: Building excitement
- 1970s-1980s: Peak energy (disco, rock anthems)
- 1990s-2000s: Second peak (pop, hip-hop energy)
- 2010s-2020s: Grand finale energy, end on a massive crowd moment

### 1h. Crowd moment placement

Don't just use the `crowd_singalong` flag blindly:
- Space crowd moments so there's one every 3-5 songs (not back-to-back)
- Ensure each decade has at least one crowd moment
- Place the biggest crowd moments at decade peaks and the grand finale

---

## 2. New Camelot utilities in `src/camelot.ts`

Add helper functions the engine needs:

- `getCamelotDistance(key1, key2): number` — number of steps between two keys on the Camelot wheel (0 = same, 1 = adjacent, up to 6 = opposite)
- `getOptimalKeyPath(keys: string[]): string[]` — reorder a set of keys to minimize total Camelot distance (greedy nearest-neighbor)
- `isHalfDoubleTime(bpm1, bpm2): boolean` — true if one BPM is ~2x the other (within 5%)
- `getEffectiveBpm(bpm, targetBpm): number` — returns the BPM (original, half, or double) closest to target

---

## 3. UI Integration

### 3a. "Auto-Arrange" button in MedleyPlanner

- Add a prominent button at the top of the MedleyPlanner: **"Auto-Arrange"**
- When clicked, runs the arrangement engine on the current medley songs
- Updates all songs in-place via `onUpdateSong` (reorder + set all arrangement fields)
- Shows a brief summary toast: "Arranged 83 songs: 12 mashups detected, avg Camelot distance 0.8"

### 3b. Arrangement notes in ArrangementView

- The `arrangement_notes` field is already on MedleySong but not displayed
- Show arrangement notes (especially mashup instructions) in the ArrangementView song blocks
- Highlight mashup pairs visually (connected bracket or shared background color)

---

## 4. Implementation Order

1. **Add Camelot utilities** (`getCamelotDistance`, `isHalfDoubleTime`, etc.)
2. **Build `src/arranger.ts`** with the core engine (reordering, bar counts, transitions, mashups, energy arc)
3. **Wire up "Auto-Arrange" button** in MedleyPlanner → calls engine → updates state
4. **Enhance ArrangementView** to display arrangement_notes and mashup indicators
5. **Test & tune** — run on the full 83-song medley, review the output, adjust weights

---

## 5. What This Does NOT Change

- Song database / browsing — untouched
- Manual editing — all auto-arranged values remain editable
- Easter eggs — untouched (but could be a future enhancement)
- Export — already exports all fields including the new arrangement data
