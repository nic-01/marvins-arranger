import { describe, it, expect } from 'vitest';
import { getCamelotPosition, getCamelotDistance, areKeysCompatible } from '@/lib/camelot';

describe('Camelot wheel', () => {
  it('maps C major to 8B', () => {
    const pos = getCamelotPosition('C major');
    expect(pos).toEqual({ number: 8, letter: 'B' });
  });

  it('maps Am to 8A', () => {
    const pos = getCamelotPosition('Am');
    expect(pos).toEqual({ number: 8, letter: 'A' });
  });

  it('adjacent keys (C→G major) have distance 1', () => {
    expect(getCamelotDistance('C major', 'G major')).toBe(1);
  });

  it('same key has distance 0', () => {
    expect(getCamelotDistance('C major', 'C major')).toBe(0);
  });

  it('C major and Am are compatible (relative major/minor)', () => {
    expect(areKeysCompatible('C major', 'Am')).toBe(true);
  });

  it('returns null for unknown keys', () => {
    expect(getCamelotPosition('Xb lydian')).toBeNull();
  });
});
