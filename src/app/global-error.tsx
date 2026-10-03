'use client';

/**
 * Global error boundary — catches failures in the ROOT layout itself.
 *
 * This replaces the entire document, so it must render its own <html> and
 * <body>. It cannot use any app provider (MoneyProvider, GeoHeader) because
 * those live in the layout that just crashed. That is why the styling here is
 * inline and self-contained: importing the design system would mean importing
 * the thing that failed.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FAF7F2',
          color: '#292524',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ maxWidth: 480, padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#78716C' }}>
            Something went wrong
          </p>
          <h1 style={{ margin: '12px 0 0', fontSize: 28, color: '#7B1E3A' }}>
            The store needs a moment.
          </h1>
          <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: '#57534E' }}>
            Nothing in your bag or your account has been affected.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              padding: '10px 20px',
              borderRadius: 999,
              border: 'none',
              background: '#7B1E3A',
              color: '#FAF7F2',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: 24, fontSize: 11, color: '#A8A29E' }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
