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

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

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

async function searchTrack(token: string, title: string, artist: string): Promise<string | null> {
  const cleanTitle = title.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const query = encodeURIComponent(`track:${cleanTitle} artist:${artist}`);

  const resp = await fetch(`https://api.spotify.com/v1/search?q=${query}&type=track&limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    if (resp.status === 429) {
      const wait = parseInt(resp.headers.get('retry-after') || '3', 10);
      await new Promise(r => setTimeout(r, wait * 1000));
      return searchTrack(token, title, artist);
    }
    return null;
  }

  const data = await resp.json();
  const tracks = data.tracks?.items;
  if (!tracks?.length) return null;

  const artistLower = artist.toLowerCase();
  const best = tracks.find((t: { artists: Array<{ name: string }> }) =>
    t.artists.some((a: { name: string }) => a.name.toLowerCase() === artistLower)
  ) || tracks[0];

  return best.id;
}

function formatKey(pitchClass: number, mode: number): string {
  if (pitchClass < 0 || pitchClass > 11) return 'Unknown';
  return `${PITCH_CLASSES[pitchClass]} ${mode === 1 ? 'major' : 'minor'}`;
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

  // Search for each track
  const spotifyIds: Array<{ songId: string; spotifyId: string }> = [];
  const notFound: string[] = [];

  for (const song of chunk) {
    const sid = await searchTrack(token, song.title, song.artist);
    if (sid) {
      spotifyIds.push({ songId: song.id, spotifyId: sid });
    } else {
      notFound.push(song.id);
    }
    // Small delay
    await new Promise(r => setTimeout(r, 80));
  }

  // Batch fetch audio features
  const featureMap = new Map<string, { key: number; mode: number; tempo: number }>();
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
        if (f) featureMap.set(f.id, { key: f.key, mode: f.mode, tempo: f.tempo });
      }
    }
  }

  // Build results
  const results = chunk.map(song => {
    const match = spotifyIds.find(s => s.songId === song.id);
    if (!match) {
      return {
        id: song.id,
        title: song.title,
        artist: song.artist,
        currentKey: song.key,
        spotifyKey: null,
        spotifyBpm: null,
        currentBpm: song.bpm,
        keyChanged: false,
        bpmChanged: false,
      };
    }

    const feat = featureMap.get(match.spotifyId);
    if (!feat) {
      return {
        id: song.id,
        title: song.title,
        artist: song.artist,
        currentKey: song.key,
        spotifyKey: null,
        spotifyBpm: null,
        currentBpm: song.bpm,
        keyChanged: false,
        bpmChanged: false,
      };
    }

    const spotifyKey = formatKey(feat.key, feat.mode);
    const spotifyBpm = Math.round(feat.tempo);

    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      currentKey: song.key,
      spotifyKey,
      spotifyBpm,
      currentBpm: song.bpm,
      keyChanged: spotifyKey !== song.key,
      bpmChanged: Math.abs(spotifyBpm - song.bpm) > 3,
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
      found: spotifyIds.length,
      notFound: notFound.length,
      keyChanges: results.filter(r => r.keyChanged).length,
      bpmChanges: results.filter(r => r.bpmChanged).length,
    },
  });
}
