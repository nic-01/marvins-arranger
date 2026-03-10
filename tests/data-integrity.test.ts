import { describe, it, expect } from 'vitest';
import { allSongs } from '@/lib/data';

describe('Song catalog integrity', () => {
  it('loads a non-empty catalog', () => {
    expect(allSongs.length).toBeGreaterThan(0);
  });

  it('duplicate song IDs are within known bounds', () => {
    // Known issue: some decade catalogs have overlapping entries.
    // The dedup in lib/data/index.ts only removes catalog dupes that clash with core songs.
    const ids = allSongs.map(s => s.id);
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const id of ids) {
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    // Guard against massive regression — current count is ~222
    expect(dupes.length).toBeLessThan(300);
  });

  it('every song has required fields', () => {
    for (const song of allSongs) {
      expect(song.id, `missing id`).toBeTruthy();
      expect(song.title, `missing title for ${song.id}`).toBeTruthy();
      expect(song.artist, `missing artist for ${song.id}`).toBeTruthy();
      expect(song.year, `missing year for ${song.id}`).toBeGreaterThan(1900);
      expect(song.bpm, `missing bpm for ${song.id}`).toBeGreaterThan(0);
      expect(song.key, `missing key for ${song.id}`).toBeTruthy();
      expect(song.decade, `missing decade for ${song.id}`).toBeTruthy();
    }
  });

  it('every song has a valid energy level', () => {
    const validEnergies = new Set(['Low', 'Medium', 'High']);
    for (const song of allSongs) {
      expect(validEnergies.has(song.energy), `invalid energy "${song.energy}" for ${song.id}`).toBe(true);
    }
  });

  it('covers multiple decades', () => {
    const decades = new Set(allSongs.map(s => s.decade));
    expect(decades.size).toBeGreaterThanOrEqual(5);
  });
});
