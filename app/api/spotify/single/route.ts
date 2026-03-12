import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/spotify/single?title=...&artist=...&id=...
 * Looks up a single song on Spotify and returns audio features.
 * Tiny, fast, basically impossible to 504.
 */

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
  if (!resp.ok) throw new Error(`Token failed: ${resp.status}`);
  const data = await resp.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

export async function GET(req: NextRequest) {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    return NextResponse.json({ error: 'Spotify credentials not configured' }, { status: 500 });
  }

  const id = req.nextUrl.searchParams.get('id');
  const title = req.nextUrl.searchParams.get('title');
  const artist = req.nextUrl.searchParams.get('artist');

  if (!id || !title || !artist) {
    return NextResponse.json({ error: 'Missing id, title, or artist' }, { status: 400 });
  }

  try {
    const token = await getAccessToken();

    // Search
    const cleanTitle = title.replace(/\s*\(.*?\)\s*/g, ' ').trim();
    const query = encodeURIComponent(`track:${cleanTitle} artist:${artist}`);
    const searchResp = await fetch(`https://api.spotify.com/v1/search?q=${query}&type=track&limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!searchResp.ok) {
      if (searchResp.status === 429) {
        const wait = searchResp.headers.get('retry-after') || '3';
        return NextResponse.json({ id, found: false, retryAfter: parseInt(wait, 10) }, { status: 429 });
      }
      return NextResponse.json({ id, found: false });
    }

    const searchData = await searchResp.json();
    const tracks = searchData.tracks?.items;
    if (!tracks?.length) {
      return NextResponse.json({ id, found: false });
    }

    // Best match
    const artistLower = artist.toLowerCase();
    const best = tracks.find((t: { artists: Array<{ name: string }> }) =>
      t.artists.some((a: { name: string }) => a.name.toLowerCase() === artistLower)
    ) || tracks[0];

    // Audio features
    const featResp = await fetch(`https://api.spotify.com/v1/audio-features/${best.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!featResp.ok) {
      return NextResponse.json({ id, found: true, spotifyId: best.id });
    }

    const feat = await featResp.json();
    const spotifyKey = feat.key >= 0 && feat.key <= 11
      ? `${PITCH_CLASSES[feat.key]} ${feat.mode === 1 ? 'major' : 'minor'}`
      : null;

    return NextResponse.json({
      id,
      found: true,
      spotifyId: best.id,
      spotifyKey,
      spotifyBpm: Math.round(feat.tempo),
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
    });
  } catch (err) {
    return NextResponse.json({ id, found: false, error: String(err) });
  }
}
