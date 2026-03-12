'use client';

import { useState, useCallback } from 'react';
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

type RefreshState = 'idle' | 'fetching' | 'saving' | 'done' | 'error';

const BATCH_SIZE = 30;

export default function SpotifyRefresh({ totalSongs, overrideCount, onOverridesApplied }: SpotifyRefreshProps) {
  const [state, setState] = useState<RefreshState>('idle');
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<{
    found: number;
    notFound: number;
    keyChanges: number;
    bpmChanges: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runRefresh = useCallback(async () => {
    setState('fetching');
    setProgress(0);
    setStats(null);
    setError(null);

    const allResults: BatchResult[] = [];
    let offset = 0;
    let totalFound = 0;
    let totalNotFound = 0;
    let totalKeyChanges = 0;
    let totalBpmChanges = 0;

    try {
      // Fetch all batches from Spotify
      while (true) {
        const resp = await fetch(`/api/spotify/batch?offset=${offset}&limit=${BATCH_SIZE}`);
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || `Spotify API error: ${resp.status}`);
        }

        const data = await resp.json();
        allResults.push(...data.results);
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

        if (!data.hasMore) break;
        offset += BATCH_SIZE;

        // Small delay between batches to be nice to Spotify
        await new Promise(r => setTimeout(r, 200));
      }

      // Save to DB
      setState('saving');
      const overrides = allResults
        .filter(r => r.spotifyId)
        .map(r => ({
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
        }));

      // Send in batches of 50 to avoid request size limits
      for (let i = 0; i < overrides.length; i += 50) {
        const batch = overrides.slice(i, i + 50);
        const resp = await fetch('/api/spotify/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overrides: batch }),
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || `Failed to save overrides: ${resp.status}`);
        }
      }

      // Notify parent with the new overrides
      onOverridesApplied(overrides as SongOverride[]);
      setState('done');
    } catch (err) {
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

      {(state === 'fetching' || state === 'saving') && (
        <div style={styles.progressArea}>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${pct}%` }} />
          </div>
          <div style={styles.progressText}>
            {state === 'fetching'
              ? `Fetching from Spotify... ${progress}/${totalSongs} (${pct}%)`
              : 'Saving to database...'}
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
          <div style={styles.errorText}>{error}</div>
          <button style={styles.buttonSmall} onClick={() => setState('idle')}>
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
    color: '#1DB954', // Spotify green
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
