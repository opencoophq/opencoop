/**
 * @jest-environment node
 */
import { GET } from './route';

describe('GET /.well-known/mcp/server-card.json', () => {
  const originalApiUrl = process.env.API_URL;

  afterEach(() => {
    process.env.API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it('proxies the API card with CORS open to every origin', async () => {
    process.env.API_URL = 'http://api.test:3001';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"serverInfo":{"name":"opencoop"}}', {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=300',
        },
      }),
    );

    const response = await GET();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test:3001/.well-known/mcp/server-card.json',
      { cache: 'no-store' },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await response.json()).toEqual({ serverInfo: { name: 'opencoop' } });
  });

  it('passes an upstream error status through', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('returns a JSON 502 when the API is unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    const response = await GET();

    expect(response.status).toBe(502);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual({ error: 'MCP server card is unavailable' });
  });
});
