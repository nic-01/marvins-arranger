import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Database fallback behaviour', () => {
  beforeEach(() => {
    // Reset module cache between tests so env changes take effect
    vi.resetModules();
  });

  it('getDb returns null when TURSO_DATABASE_URL is not set', async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;

    const { getDb } = await import('@/db');
    expect(getDb()).toBeNull();
  });

  it('requireDb throws when TURSO_DATABASE_URL is not set', async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;

    const { requireDb } = await import('@/db');
    expect(() => requireDb()).toThrow('Database is not configured');
  });
});
