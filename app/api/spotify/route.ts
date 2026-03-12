import { NextRequest, NextResponse } from 'next/server';

/**
 * Spotify API proxy — looks up song keys using Audio Features.
 *
 * POST /api/spotify
 * Body: { songs: Array<{ id: string; title: string; artist: string }> }
 * Returns: { results: Array<{ id: string; spotifyId: string | null; key: string | null; bpm: number | null; error?: string }> }
 *
 * Uses Client Credentials flow (no user login needed).
 */

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Spotify pitch class → note name
const PITCH_CLASSES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set');
  }

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!resp.ok) {
    throw new Error(`Spotify token request failed: ${resp.status} ${await resp.text()}`);
  }

  const data: SpotifyTokenResponse = await resp.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

async function searchTrack(
  token: string,
  title: string,
  artist: string,
): Promise<{ spotifyId: string; name: string; artists: string[] } | null> {
  // Clean up title for search (remove parenthetical info)
  const cleanTitle = title.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const query = encodeURIComponent(`track:${cleanTitle} artist:${artist}`);

  const resp = await fetch(`https://api.spotify.com/v1/search?q=${query}&type=track&limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    if (resp.status === 429) {
      // Rate limited — wait and retry
      const retryAfter = parseInt(resp.headers.get('retry-after') || '2', 10);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return searchTrack(token, title, artist);
    }
    return null;
  }

  const data = await resp.json();
  const tracks = data.tracks?.items;
  if (!tracks || tracks.length === 0) return null;

  // Pick the best match — prefer exact artist match
  const artistLower = artist.toLowerCase();
  const best = tracks.find((t: { artists: Array<{ name: string }> }) =>
    t.artists.some((a: { name: string }) => a.name.toLowerCase() === artistLower)
  ) || tracks[0];

  return {
    spotifyId: best.id,
    name: best.name,
    artists: best.artists.map((a: { name: string }) => a.name),
  };
}

async function getAudioFeatures(
  token: string,
  trackIds: string[],
): Promise<Map<string, { key: number; mode: number; tempo: number }>> {
  const results = new Map<string, { key: number; mode: number; tempo: number }>();

  // Spotify allows up to 100 IDs per request
  for (let i = 0; i < trackIds.length; i += 100) {
    const batch = trackIds.slice(i, i + 100);
    const resp = await fetch(
      `https://api.spotify.com/v1/audio-features?ids=${batch.join(',')}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!resp.ok) {
      if (resp.status === 429) {
        const retryAfter = parseInt(resp.headers.get('retry-after') || '2', 10);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        i -= 100; // Retry this batch
        continue;
      }
      continue;
    }

    const data = await resp.json();
    for (const feature of data.audio_features || []) {
      if (feature && feature.id) {
        results.set(feature.id, {
          key: feature.key,
          mode: feature.mode,
          tempo: feature.tempo,
        });
      }
    }
  }

  return results;
}

function formatKey(pitchClass: number, mode: number): string {
  if (pitchClass < 0 || pitchClass > 11) return 'Unknown';
  const note = PITCH_CLASSES[pitchClass];
  const quality = mode === 1 ? 'major' : 'minor';
  return `${note} ${quality}`;
}

export async function POST(req: NextRequest) {
  try {
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      return NextResponse.json(
        { error: 'Spotify API credentials not configured' },
        { status: 500 },
      );
    }

    const body = await req.json();
    const songs: Array<{ id: string; title: string; artist: string }> = body.songs;

    if (!songs || !Array.isArray(songs)) {
      return NextResponse.json({ error: 'Missing songs array' }, { status: 400 });
    }

    const token = await getAccessToken();

    // Step 1: Search for each track on Spotify
    const searchResults = new Map<string, string>(); // song.id → spotifyId
    const results: Array<{
      id: string;
      spotifyId: string | null;
      key: string | null;
      bpm: number | null;
      error?: string;
    }> = [];

    for (const song of songs) {
      try {
        const found = await searchTrack(token, song.title, song.artist);
        if (found) {
          searchResults.set(song.id, found.spotifyId);
        }
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (err) {
        results.push({
          id: song.id,
          spotifyId: null,
          key: null,
          bpm: null,
          error: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // Step 2: Batch fetch audio features
    const spotifyIds = [...searchResults.values()];
    const features = spotifyIds.length > 0
      ? await getAudioFeatures(token, spotifyIds)
      : new Map();

    // Step 3: Build results
    for (const song of songs) {
      // Skip songs that already have an error result
      if (results.some(r => r.id === song.id)) continue;

      const spotifyId = searchResults.get(song.id);
      if (!spotifyId) {
        results.push({ id: song.id, spotifyId: null, key: null, bpm: null, error: 'Not found on Spotify' });
        continue;
      }

      const feat = features.get(spotifyId);
      if (!feat) {
        results.push({ id: song.id, spotifyId, key: null, bpm: null, error: 'No audio features available' });
        continue;
      }

      results.push({
        id: song.id,
        spotifyId,
        key: formatKey(feat.key, feat.mode),
        bpm: Math.round(feat.tempo),
      });
    }

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
