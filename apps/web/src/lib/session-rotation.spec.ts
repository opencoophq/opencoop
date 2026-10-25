import { api } from './api';

describe('session rotation client', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    global.fetch = fetchMock as typeof fetch;
    localStorage.setItem('accessToken', 'access-1');
    localStorage.setItem('refreshToken', 'refresh-1');
    localStorage.setItem('activeSessionId', 'sess');
    localStorage.setItem(
      'savedSessions',
      JSON.stringify([
        {
          id: 'sess',
          email: 'a@b.c',
          role: 'USER',
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          user: { email: 'a@b.c' },
        },
      ]),
    );
  });

  it('opts into rotation and stores the replacement refresh token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2' }, 200))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

    await expect(api('/me')).resolves.toEqual({ ok: true });

    const refreshCall = fetchMock.mock.calls[1];
    expect(String(refreshCall[0])).toContain('/auth/refresh');
    expect(refreshCall[1].headers['X-Session-Rotation']).toBe('1');
    expect(JSON.parse(refreshCall[1].body)).toEqual({ refreshToken: 'refresh-1' });
    expect(localStorage.getItem('accessToken')).toBe('access-2');
    expect(localStorage.getItem('refreshToken')).toBe('refresh-2');
    expect(JSON.parse(localStorage.getItem('savedSessions')!)[0].refreshToken).toBe('refresh-2');
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer access-2');
  });

  it('stores a session token delivered on an authenticated response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true }, 200, { 'x-session-token': 'refresh-3' }),
    );

    await api('/coops');

    expect(fetchMock.mock.calls[0][1].headers['X-Session-Rotation']).toBe('1');
    expect(localStorage.getItem('refreshToken')).toBe('refresh-3');
    expect(localStorage.getItem('accessToken')).toBe('access-1');
    expect(JSON.parse(localStorage.getItem('savedSessions')!)[0].refreshToken).toBe('refresh-3');
  });

  it('keeps a directly refreshed session when the caller only reads the access token', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ accessToken: 'access-9', refreshToken: 'refresh-9' }, 200),
    );

    const body = await api<{ accessToken: string }>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: 'refresh-1' },
    });

    expect(body.accessToken).toBe('access-9');
    expect(localStorage.getItem('refreshToken')).toBe('refresh-9');
    expect(localStorage.getItem('accessToken')).toBe('access-9');
  });
});

function jsonResponse(body: unknown, status: number, headers?: Record<string, string>) {
  const text = JSON.stringify(body);
  const headerMap = new Map(
    Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const response = {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
    json: async () => body,
    text: async () => text,
    clone() {
      return response;
    },
  };
  return response;
}
