'use client';

import { useState, useCallback, useRef } from 'react';
import type { Song, SongOverride } from '@/lib/types';

interface SpotifyRefreshProps {
  songs: Song[];
  overrideCount: number;
  onOverridesApplied: (overrides: SongOverride[]) => void;
}

interface SingleResult {
  id: string;
  found: boolean;
  spotifyId?: string;
  spotifyKey?: string | null;
  spotifyBpm?: number | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  acousticness?: number | null;
  instrumentalness?: number | null;
  liveness?: number | null;
  loudness?: number | null;
  speechiness?: number | null;
  timeSignature?: number | null;
  durationMs?: number | null;
  retryAfter?: number;
}

type RefreshState = 'idle' | 'fetching' | 'done';

const SAVE_EVERY = 20;
const FETCH_TIMEOUT = 15_000; // 15s max per song

/** fetch with a timeout — rejects if no response within ms */
function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** Yield to the browser so React can re-render and the UI stays responsive */
function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export default function SpotifyRefresh({ songs, overrideCount, onOverridesApplied }: SpotifyRefreshProps) {
  const [state, setState] = useState<RefreshState>('idle');
  const [progress, setProgress] = useState(0);
  const [saved, setSaved] = useState(0);
  const [stats, setStats] = useState<{
    found: number;
    notFound: number;
    skipped: number;
  } | null>(null);
  const allOverridesRef = useRef<SongOverride[]>([]);
  const pendingRef = useRef<SongOverride[]>([]);

  const flushToDb = useCallback(async () => {
    if (pendingRef.current.length === 0) return;
    const batch = pendingRef.current;
    pendingRef.current = [];
    try {
      const resp = await fetch('/api/spotify/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: batch }),
      });
      if (resp.ok) {
        allOverridesRef.current = [...allOverridesRef.current, ...batch];
        setSaved(allOverridesRef.current.length);
        onOverridesApplied(allOverridesRef.current);
      }
    } catch {
      pendingRef.current = [...batch, ...pendingRef.current];
    }
  }, [onOverridesApplied]);

  const runRefresh = useCallback(async () => {
    setState('fetching');
    setProgress(0);
    setSaved(0);
    setStats(null);
    allOverridesRef.current = [];
    pendingRef.current = [];

    // Yield so React renders the "fetching" state before we start the loop
    await yieldToUI();

    let found = 0;
    let notFound = 0;
    let skipped = 0;

    for (let i = 0; i < songs.length; i++) {
      const song = songs[i];

      try {
        const params = new URLSearchParams({ id: song.id, title: song.title, artist: song.artist });
        const resp = await fetchWithTimeout(`/api/spotify/single?${params}`, FETCH_TIMEOUT);

        if (resp.status === 429) {
          const data: SingleResult = await resp.json().catch(() => ({ id: song.id, found: false, retryAfter: 5 }));
          const wait = (data.retryAfter || 5) * 1000;
          await new Promise(r => setTimeout(r, wait));
          i--; // retry this song
          continue;
        }

        if (!resp.ok) {
          skipped++;
        } else {
          const data: SingleResult = await resp.json();

          if (data.found && data.spotifyId) {
            found++;
            pendingRef.current.push({
              songId: data.id,
              spotifyId: data.spotifyId,
              key: data.spotifyKey ?? null,
              bpm: data.spotifyBpm ?? null,
              energy: data.energy ?? null,
              danceability: data.danceability ?? null,
              valence: data.valence ?? null,
              acousticness: data.acousticness ?? null,
              instrumentalness: data.instrumentalness ?? null,
              liveness: data.liveness ?? null,
              loudness: data.loudness ?? null,
              speechiness: data.speechiness ?? null,
              timeSignature: data.timeSignature ?? null,
              durationMs: data.durationMs ?? null,
            } as SongOverride);
          } else {
            notFound++;
          }
        }
      } catch {
        // Timeout or network error — skip this song
        skipped++;
      }

      // Update progress + yield to React on every song
      setProgress(i + 1);
      setStats({ found, notFound, skipped });
      await yieldToUI();

      // Flush to DB periodically
      if (pendingRef.current.length >= SAVE_EVERY) {
        await flushToDb();
      }
    }

    // Final flush
    await flushToDb();
    onOverridesApplied(allOverridesRef.current);
    setState('done');
  }, [songs, onOverridesApplied, flushToDb]);

  const total = songs.length;
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Spotify Data</span>
        {overrideCount > 0 && state === 'idle' && (
          <span style={styles.badge}>{overrideCount} songs enriched</span>
        )}
      </div>

      {state === 'idle' && (
        <button style={styles.button} onClick={runRefresh}>
          Refresh from Spotify API
        </button>
      )}

      {state === 'fetching' && (
        <div style={styles.progressArea}>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${pct}%` }} />
          </div>
          <div style={styles.progressText}>
            Fetching from Spotify... {progress}/{total} ({pct}%)
            {saved > 0 && <span style={styles.savedText}> &middot; {saved} saved</span>}
          </div>
          {stats && (
            <div style={styles.statsRow}>
              <span>Found: {stats.found}</span>
              <span>Not found: {stats.notFound}</span>
              {stats.skipped > 0 && (
                <span style={{ color: 'var(--amber, #f0ad4e)' }}>Errors: {stats.skipped}</span>
              )}
            </div>
          )}
        </div>
      )}

      {state === 'done' && stats && (
        <div style={styles.doneArea}>
          <div style={styles.doneText}>
            Done! {stats.found} songs enriched with Spotify data.
          </div>
          <div style={styles.statsRow}>
            <span>Not found: {stats.notFound}</span>
            {stats.skipped > 0 && (
              <span style={{ color: 'var(--amber, #f0ad4e)' }}>
                {stats.skipped} errors (retry to fill gaps)
              </span>
            )}
          </div>
          <button style={styles.buttonSmall} onClick={() => setState('idle')}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '8px 12px',
    background: 'var(--bg-tertiary)',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: 700,
    color: '#1DB954',
  },
  badge: {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 8,
    background: 'rgba(29, 185, 84, 0.15)',
    color: '#1DB954',
    fontWeight: 600,
  },
  button: {
    padding: '6px 14px',
    background: '#1DB954',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  buttonSmall: {
    padding: '4px 10px',
    background: 'var(--bg-secondary)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    fontSize: 11,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  progressArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    background: 'var(--bg-secondary)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    background: '#1DB954',
    transition: 'width 0.3s ease',
  },
  progressText: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  savedText: {
    color: '#1DB954',
  },
  statsRow: {
    display: 'flex',
    gap: 12,
    fontSize: 10,
    color: 'var(--text-muted)',
  },
  doneArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  doneText: {
    fontSize: 12,
    color: '#1DB954',
    fontWeight: 600,
  },
};
