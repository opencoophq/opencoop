// Cloudflare Agent Readiness reads the card from the site root, but Caddy only sends /api/*
// to the API. Proxy the API's card so it is also served at opencoop.be/.well-known/...
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const apiUrl = process.env.API_URL || 'http://api:3001';
  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl}/.well-known/mcp/server-card.json`, { cache: 'no-store' });
  } catch {
    return Response.json(
      { error: 'MCP server card is unavailable' },
      { status: 502, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } },
    );
  }

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': upstream.headers.get('cache-control') || 'no-store',
    },
  });
}
