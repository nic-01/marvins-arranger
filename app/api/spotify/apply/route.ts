import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { songOverrides } from '@/db/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/spotify/apply
 * Saves Spotify audio features as song overrides in the database.
 *
 * Body: { overrides: Array<{ songId, spotifyId, key, bpm, energy, danceability, ... }> }
 */

interface OverrideInput {
  songId: string;
  spotifyId: string | null;
  key: string | null;
  bpm: number | null;
  energy: number | null;
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  liveness: number | null;
  loudness: number | null;
  speechiness: number | null;
  timeSignature: number | null;
  durationMs: number | null;
}

export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const body = await req.json();
  const overrides: OverrideInput[] = body.overrides;

  if (!overrides || !Array.isArray(overrides)) {
    return NextResponse.json({ error: 'Missing overrides array' }, { status: 400 });
  }

  // Keep rows that at least resolved a Spotify ID; metrics can be filled on later refreshes.
  const valid = overrides.filter(o => Boolean(o.spotifyId));

  let saved = 0;
  for (const o of valid) {
    // Upsert: delete existing then insert
    await db.delete(songOverrides).where(eq(songOverrides.songId, o.songId));
    await db.insert(songOverrides).values({
      songId: o.songId,
      spotifyId: o.spotifyId,
      key: o.key,
      bpm: o.bpm,
      energy: o.energy,
      danceability: o.danceability,
      valence: o.valence,
      acousticness: o.acousticness,
      instrumentalness: o.instrumentalness,
      liveness: o.liveness,
      loudness: o.loudness,
      speechiness: o.speechiness,
      timeSignature: o.timeSignature,
      durationMs: o.durationMs,
    });
    saved++;
  }

  return NextResponse.json({
    saved,
    skipped: overrides.length - saved,
  });
}
