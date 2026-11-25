// Requests outside a locale segment (the middleware normally prefixes one) have no
// [locale] layout, and the root layout renders no <html>. This page provides its own.
export default function RootNotFound() {
  return (
    <html lang="nl">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'grid',
          placeItems: 'center',
          minHeight: '100vh',
          margin: 0,
        }}
      >
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>404</h1>
      </body>
    </html>
  );
}
