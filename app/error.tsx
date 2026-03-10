'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif', maxWidth: 600, margin: '80px auto' }}>
      <h2 style={{ fontSize: 20, marginBottom: 12 }}>Something went wrong</h2>
      <p style={{ color: '#666', marginBottom: 8 }}>
        The app hit an unexpected error. This is usually a temporary database connection issue.
      </p>
      <pre style={{ fontSize: 12, color: '#999', marginBottom: 20, whiteSpace: 'pre-wrap' }}>
        {error.message}
        {error.digest && ` (digest: ${error.digest})`}
      </pre>
      <button
        onClick={reset}
        style={{
          padding: '8px 20px',
          background: '#333',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 14,
        }}
      >
        Try again
      </button>
    </div>
  );
}
