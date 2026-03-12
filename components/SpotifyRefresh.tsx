'use client';

import { useState, useCallback, useRef } from 'react';
import type { SongOverride } from '@/lib/types';

interface SpotifyRefreshProps {
  totalSongs: number;
  overrideCount: number;
  onOverridesApplied: (overrides: SongOverride[]) => void;
}

interface BatchResult {
  id: string;
  spotifyId: string | null;
  spotifyKey: string | null;
  spotifyBpm: number | null;
  keyChanged: boolean;
  bpmChanged: boolean;
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

type RefreshState = 'idle' | 'fetching' | 'done' | 'error';

const BATCH_SIZE = 10;
const MAX_RETRIES = 3;

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const resp = await fetch(url);
    if (resp.ok) return resp;
    if (resp.status === 504 || resp.status === 502 || resp.status === 503) {
      // Transient server error — wait and retry
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
        continue;
      }
    }
    // Non-retryable error or final attempt
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.error || `Spotify API error: ${resp.status}`);
  }
  throw new Error('Max retries exceeded');
}

function toOverride(r: BatchResult) {
  return {
    songId: r.id,
    spotifyId: r.spotifyId,
    key: r.spotifyKey,
    bpm: r.spotifyBpm,
    energy: r.energy,
    danceability: r.danceability,
    valence: r.valence,
    acousticness: r.acousticness,
    instrumentalness: r.instrumentalness,
    liveness: r.liveness,
    loudness: r.loudness,
    speechiness: r.speechiness,
    timeSignature: r.timeSignature,
    durationMs: r.durationMs,
  };
}

export default function SpotifyRefresh({ totalSongs, overrideCount, onOverridesApplied }: SpotifyRefreshProps) {
  const [state, setState] = useState<RefreshState>('idle');
  const [progress, setProgress] = useState(0);
  const [saved, setSaved] = useState(0);
  const [stats, setStats] = useState<{
    found: number;
    notFound: number;
    keyChanges: number;
    bpmChanges: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allOverridesRef = useRef<SongOverride[]>([]);

  const runRefresh = useCallback(async () => {
    setState('fetching');
    setProgress(0);
    setSaved(0);
    setStats(null);
    setError(null);
    allOverridesRef.current = [];

    let offset = 0;
    let totalFound = 0;
    let totalNotFound = 0;
    let totalKeyChanges = 0;
    let totalBpmChanges = 0;

    try {
      while (true) {
        // Fetch batch with retry
        const resp = await fetchWithRetry(`/api/spotify/batch?offset=${offset}&limit=${BATCH_SIZE}`);
        const data = await resp.json();

        totalFound += data.stats.found;
        totalNotFound += data.stats.notFound;
        totalKeyChanges += data.stats.keyChanges;
        totalBpmChanges += data.stats.bpmChanges;

        setProgress(Math.min(offset + BATCH_SIZE, data.total));
        setStats({
          found: totalFound,
          notFound: totalNotFound,
          keyChanges: totalKeyChanges,
          bpmChanges: totalBpmChanges,
        });

        // Save this batch to DB immediately (incremental save)
        const batchOverrides = (data.results as BatchResult[])
          .filter((r: BatchResult) => r.spotifyId)
          .map(toOverride);

        if (batchOverrides.length > 0) {
          const saveResp = await fetch('/api/spotify/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ overrides: batchOverrides }),
          });
          if (!saveResp.ok) {
            const errData = await saveResp.json().catch(() => ({}));
            throw new Error(errData.error || `Failed to save overrides: ${saveResp.status}`);
          }
          allOverridesRef.current = [...allOverridesRef.current, ...batchOverrides as SongOverride[]];
          setSaved(allOverridesRef.current.length);
        }

        // Notify parent incrementally so UI updates live
        onOverridesApplied(allOverridesRef.current);

        if (!data.hasMore) break;
        offset += BATCH_SIZE;

        // Small delay between batches
        await new Promise(r => setTimeout(r, 300));
      }

      setState('done');
    } catch (err) {
      // Even on error, keep whatever we saved so far
      if (allOverridesRef.current.length > 0) {
        onOverridesApplied(allOverridesRef.current);
      }
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }, [onOverridesApplied]);

  const pct = totalSongs > 0 ? Math.round((progress / totalSongs) * 100) : 0;

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
            Fetching from Spotify... {progress}/{totalSongs} ({pct}%)
            {saved > 0 && <span style={styles.savedText}> &middot; {saved} saved</span>}
          </div>
          {stats && (
            <div style={styles.statsRow}>
              <span>Found: {stats.found}</span>
              <span>Not found: {stats.notFound}</span>
              <span>Key changes: {stats.keyChanges}</span>
              <span>BPM changes: {stats.bpmChanges}</span>
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
            <span>Key changes: {stats.keyChanges}</span>
            <span>BPM changes: {stats.bpmChanges}</span>
            <span>Not found: {stats.notFound}</span>
          </div>
          <button style={styles.buttonSmall} onClick={() => setState('idle')}>
            Dismiss
          </button>
        </div>
      )}

      {state === 'error' && (
        <div style={styles.errorArea}>
          <div style={styles.errorText}>
            {error}
            {saved > 0 && (
              <span style={styles.savedNote}> ({saved} songs saved before error)</span>
            )}
          </div>
          <button style={styles.buttonSmall} onClick={runRefresh}>
            Retry
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
  savedNote: {
    color: '#1DB954',
    fontSize: 10,
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
  errorArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  errorText: {
    fontSize: 11,
    color: '#ff6b6b',
  },
};
