import { NextRequest, NextResponse } from 'next/server';

/**
 * Batch Spotify key lookup for ALL songs in the catalog.
 *
 * GET /api/spotify/batch?offset=0&limit=50
 * Returns: { results: [...], total: number, offset: number, hasMore: boolean }
 *
 * Process in chunks to avoid Spotify rate limits and Vercel timeouts.
 */

import { allSongs } from '@/lib/data';
import { getDb } from '@/db';
import { songOverrides } from '@/db/schema';
import { inArray } from 'drizzle-orm';

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_MARKET = process.env.SPOTIFY_MARKET || 'US';

const PITCH_CLASSES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!resp.ok) throw new Error(`Token request failed: ${resp.status}`);
  const data = await resp.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function runner() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await worker(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
  await Promise.all(workers);
  return results;
}

function normalizeForMatch(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(feat|ft|featuring)\b\.?/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleVariants(title: string): string[] {
  const raw = title.trim();
  const variants = new Set<string>([raw]);

  // Strip bracketed qualifiers like "(Remix)" / "[Live]"
  variants.add(raw.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim());
  // Strip common dash suffixes like " - Remaster 2011"
  variants.add(raw.replace(/\s[-–]\s.*$/, '').trim());

  return [...variants].filter(Boolean);
}

function primaryArtist(artist: string): string {
  return artist
    .split(/,|&|\band\b|\bfeat\b|\bft\b|\bwith\b|\bx\b/i)[0]
    .trim();
}

function scoreCandidate(
  wantedTitle: string,
  wantedArtist: string,
  candidateTitle: string,
  candidateArtists: string[],
): number {
  const wt = normalizeForMatch(wantedTitle);
  const wa = normalizeForMatch(wantedArtist);
  const ct = normalizeForMatch(candidateTitle);
  const ca = normalizeForMatch(candidateArtists.join(' '));

  let score = 0;
  if (ct === wt) score += 70;
  else if (ct.includes(wt) || wt.includes(ct)) score += 45;

  if (ca.includes(wa) || wa.includes(ca)) score += 50;

  const wantedTokens = new Set(wt.split(' ').filter(Boolean));
  const titleOverlap = ct.split(' ').filter(t => wantedTokens.has(t)).length;
  score += Math.min(20, titleOverlap * 4);

  return score;
}

async function searchTrack(token: string, title: string, artist: string): Promise<string | null> {
  const titleOptions = titleVariants(title);
  const artistMain = primaryArtist(artist);
  const queries: string[] = [];

  for (const t of titleOptions) {
    queries.push(`track:${t} artist:${artistMain}`);
    queries.push(`track:${t} ${artistMain}`);
    queries.push(`track:${t}`);
  }

  let bestId: string | null = null;
  let bestScore = -1;

  for (const q of queries) {
    const query = encodeURIComponent(q);
    const resp = await fetch(`https://api.spotify.com/v1/search?q=${query}&type=track&limit=10&market=${encodeURIComponent(SPOTIFY_MARKET)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      if (resp.status === 429) continue;
      continue;
    }

    const data = await resp.json();
    const tracks = data.tracks?.items as Array<{
      id: string;
      name: string;
      artists: Array<{ name: string }>;
    }> | undefined;
    if (!tracks?.length) continue;

    for (const t of tracks) {
      const score = scoreCandidate(title, artistMain, t.name, t.artists.map(a => a.name));
      if (score > bestScore) {
        bestScore = score;
        bestId = t.id;
      }
    }

    // Early exit once we have a strong candidate.
    if (bestScore >= 85) break;
  }

  return bestId;
}

function formatKey(pitchClass: number, mode: number): string {
  if (pitchClass < 0 || pitchClass > 11) return 'Unknown';
  return `${PITCH_CLASSES[pitchClass]} ${mode === 1 ? 'major' : 'minor'}`;
}

// Full audio features from Spotify
interface SpotifyAudioFeatures {
  id: string;
  key: number;
  mode: number;
  tempo: number;
  energy: number;
  danceability: number;
  valence: number;
  acousticness: number;
  instrumentalness: number;
  liveness: number;
  loudness: number;
  speechiness: number;
  time_signature: number;
  duration_ms: number;
}

export interface SpotifyBatchResult {
  id: string;
  title: string;
  artist: string;
  spotifyId: string | null;
  currentKey: string;
  spotifyKey: string | null;
  currentBpm: number;
  spotifyBpm: number | null;
  keyChanged: boolean;
  bpmChanged: boolean;
  // Extended audio features
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

export const maxDuration = 60; // Vercel Pro limit

export async function GET(req: NextRequest) {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    return NextResponse.json({ error: 'Spotify credentials not configured' }, { status: 500 });
  }

  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0', 10);
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '30', 10);
  const chunk = allSongs.slice(offset, offset + limit);

  const token = await getAccessToken();

  // Step 1: Reuse previously resolved Spotify IDs from DB when available.
  const knownBySongId = new Map<string, string>();
  const db = getDb();
  if (db && chunk.length > 0) {
    const songIds = chunk.map(s => s.id);
    const existing = await db
      .select({
        songId: songOverrides.songId,
        spotifyId: songOverrides.spotifyId,
      })
      .from(songOverrides)
      .where(inArray(songOverrides.songId, songIds));
    for (const row of existing) {
      if (row.spotifyId) knownBySongId.set(row.songId, row.spotifyId);
    }
  }

  // Step 2: Search Spotify only for songs without a known ID.
  const unresolved = chunk.filter(song => !knownBySongId.has(song.id));
  const searchResults = await runWithConcurrency(
    unresolved,
    async (song) => {
      const sid = await searchTrack(token, song.title, song.artist);
      return { songId: song.id, spotifyId: sid };
    },
    6,
  );

  const spotifyIdsBySong = new Map<string, string>(knownBySongId);
  const notFound: string[] = [];
  for (const result of searchResults) {
    if (result.spotifyId) spotifyIdsBySong.set(result.songId, result.spotifyId);
    else notFound.push(result.songId);
  }

  const spotifyIds: Array<{ songId: string; spotifyId: string }> = chunk
    .map(song => ({ songId: song.id, spotifyId: spotifyIdsBySong.get(song.id) }))
    .filter((v): v is { songId: string; spotifyId: string } => Boolean(v.spotifyId));

  // Batch fetch audio features (full data)
  const featureMap = new Map<string, SpotifyAudioFeatures>();
  const ids = spotifyIds.map(s => s.spotifyId);

  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const resp = await fetch(
      `https://api.spotify.com/v1/audio-features?ids=${batch.join(',')}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (resp.ok) {
      const data = await resp.json();
      for (const f of data.audio_features || []) {
        if (f) featureMap.set(f.id, f as SpotifyAudioFeatures);
      }
    }
  }

  // Build results with full audio features
  const results: SpotifyBatchResult[] = chunk.map(song => {
    const spotifyId = spotifyIdsBySong.get(song.id) ?? null;
    if (!spotifyId) {
      return {
        id: song.id,
        title: song.title,
        artist: song.artist,
        spotifyId: null,
        currentKey: song.key,
        spotifyKey: null,
        spotifyBpm: null,
        currentBpm: song.bpm,
        keyChanged: false,
        bpmChanged: false,
        energy: null,
        danceability: null,
        valence: null,
        acousticness: null,
        instrumentalness: null,
        liveness: null,
        loudness: null,
        speechiness: null,
        timeSignature: null,
        durationMs: null,
      };
    }

    const feat = featureMap.get(spotifyId);
    if (!feat) {
      return {
        id: song.id,
        title: song.title,
        artist: song.artist,
        spotifyId,
        currentKey: song.key,
        spotifyKey: null,
        spotifyBpm: null,
        currentBpm: song.bpm,
        keyChanged: false,
        bpmChanged: false,
        energy: null,
        danceability: null,
        valence: null,
        acousticness: null,
        instrumentalness: null,
        liveness: null,
        loudness: null,
        speechiness: null,
        timeSignature: null,
        durationMs: null,
      };
    }

    const spotifyKey = formatKey(feat.key, feat.mode);
    const spotifyBpm = Math.round(feat.tempo);

    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      spotifyId,
      currentKey: song.key,
      spotifyKey,
      spotifyBpm,
      currentBpm: song.bpm,
      keyChanged: spotifyKey !== song.key,
      bpmChanged: Math.abs(spotifyBpm - song.bpm) > 3,
      energy: feat.energy,
      danceability: feat.danceability,
      valence: feat.valence,
      acousticness: feat.acousticness,
      instrumentalness: feat.instrumentalness,
      liveness: feat.liveness,
      loudness: feat.loudness,
      speechiness: feat.speechiness,
      timeSignature: feat.time_signature,
      durationMs: feat.duration_ms,
    };
  });

  return NextResponse.json({
    results,
    total: allSongs.length,
    offset,
    limit,
    hasMore: offset + limit < allSongs.length,
    notFound,
    stats: {
      processed: chunk.length,
      found: spotifyIdsBySong.size,
      notFound: notFound.length,
      keyChanges: results.filter(r => r.keyChanged).length,
      bpmChanges: results.filter(r => r.bpmChanged).length,
    },
  });
}
