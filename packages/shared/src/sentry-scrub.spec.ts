import {
  FILTERED,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubString,
  scrubValue,
} from './sentry-scrub';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJlbWFpbCI6ImFAYi5jIn0.c2lnbmF0dXJlLXZhbHVl';

describe('scrubString', () => {
  it.each([
    ['email', 'Unique constraint failed for ada.lovelace+x@example.co.uk', 'ada.lovelace'],
    ['Belgian IBAN with spaces', 'pay to BE68 5390 0754 7034 now', '5390'],
    ['Belgian IBAN compact, lower case', 'iban be68539007547034', '539007547034'],
    ['generic IBAN', 'NL91ABNA0417164300 received', 'ABNA0417164300'],
    ['national register number, dotted', 'rrn 85.07.30-033.28', '033'],
    ['national register number, bare', 'rrn 85073003328 end', '85073003328'],
    ['bearer token', 'Authorization: Bearer abc.def-ghi', 'abc.def-ghi'],
    ['JWT', `jwt ${JWT}`, 'eyJhbGci'],
    ['API key', 'key oc_abcdef1234567890', 'abcdef1234567890'],
    ['token query', '/auth/verify-email?token=deadbeef&lang=nl', 'deadbeef'],
    ['code query', '/auth/callback?code=4/0AbCd&state=x', '0AbCd'],
    ['password query', 'https://x.test/?password=hunter2', 'hunter2'],
    ['refresh token query', '?refreshToken=r3fr3sh', 'r3fr3sh'],
    ['invite path token', 'https://x/nl/invite/abc123def?x=1', 'abc123def'],
    ['RSVP API path token', 'GET /public/meetings/rsvp/r5vpT0k/pixel.gif', 'r5vpT0k'],
    ['volunteer confirm token', '/nl/vrijwilligers/bevestig/v0lunt33r', 'v0lunt33r'],
  ])('masks a %s', (_label, input, secret) => {
    const out = scrubString(input);
    expect(out).not.toContain(secret);
    expect(out).toContain(FILTERED);
  });

  it('keeps ordinary text, ids and OGM codes', () => {
    const text =
      'Shareholder cm3x9y0abc0001lq08hzk1k2 paid +++090/9337/55493+++ on 2026-05-09 (P2002, 1764201600000)';
    expect(scrubString(text)).toBe(text);
  });

  it('keeps the non-secret query parameters', () => {
    expect(scrubString('/verify?token=abc&lang=nl')).toBe(`/verify?token=${FILTERED}&lang=nl`);
  });
});

describe('scrubValue', () => {
  it('masks sensitive keys and scrubs strings deeply', () => {
    const out = scrubValue({
      email: 'a@b.be',
      password: 'x',
      nested: { iban: 'BE68539007547034', note: 'mail me at a@b.be', count: 3 },
      list: ['c@d.be', 7],
    });
    expect(out).toEqual({
      email: FILTERED,
      password: FILTERED,
      nested: { iban: FILTERED, note: `mail me at ${FILTERED}`, count: 3 },
      list: [FILTERED, 7],
    });
  });

  it('survives cycles and deep nesting', () => {
    const a: Record<string, unknown> = { note: 'x' };
    a.self = a;
    expect(scrubValue(a)).toEqual({ note: 'x', self: FILTERED });
  });

  it('passes null, undefined and numbers through', () => {
    expect(scrubValue(null)).toBeNull();
    expect(scrubValue(undefined)).toBeUndefined();
    expect(scrubValue(42)).toBe(42);
    expect(scrubValue(Number.NaN)).toBeNaN();
  });
});

describe('scrubValue edge cases', () => {
  it('scrubs an object referenced twice, both times', () => {
    const shared = { note: 'a@b.be' };
    expect(scrubValue({ a: shared, b: shared })).toEqual({
      a: { note: FILTERED },
      b: { note: FILTERED },
    });
  });

  it('turns errors and dates into readable, scrubbed strings', () => {
    expect(scrubValue([new Error('no user a@b.be'), new Date('2026-05-09T00:00:00Z')])).toEqual([
      `Error: no user ${FILTERED}`,
      '2026-05-09T00:00:00.000Z',
    ]);
  });

  it('keeps host attributes in span data', () => {
    expect(scrubValue({ 'server.address': 'postgres', 'client.address': '203.0.113.9' })).toEqual({
      'server.address': 'postgres',
      'client.address': FILTERED,
    });
  });
});

describe('scrubSentryEvent', () => {
  it('parses a JSON string body and masks its keys', () => {
    const body = JSON.stringify({ email: 'a@b.be', password: 'Secret123', plan: 'free' });
    const out = scrubSentryEvent({ request: { data: body } });
    expect(JSON.parse(out.request.data as string)).toEqual({
      email: FILTERED,
      password: FILTERED,
      plan: 'free',
    });
  });

  it('drops a string body that is not JSON', () => {
    const out = scrubSentryEvent({ request: { data: 'name=Ada&password=Secret123' } });
    expect(out.request.data).toBe(FILTERED);
  });

  it('drops client IP headers', () => {
    const out = scrubSentryEvent({
      request: { headers: { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' } },
    });
    expect(out.request.headers).toEqual({
      'x-forwarded-for': FILTERED,
      'cf-connecting-ip': FILTERED,
    });
  });

  it('scrubs every place the register P2002 put the email', () => {
    const event = {
      message: 'Unique constraint failed on users.email for ada@example.be',
      exception: {
        values: [{ type: 'PrismaClientKnownRequestError', value: 'email ada@example.be taken' }],
      },
      request: {
        url: 'https://acc.example/api/auth/register?token=t0k3n',
        method: 'POST',
        data: { email: 'ada@example.be', password: 'Secret123', name: 'Ada', plan: 'free' },
        query_string: [
          ['token', 't0k3n'],
          ['lang', 'nl'],
        ],
        headers: {
          authorization: `Bearer ${JWT}`,
          cookie: 'sid=1',
          'user-agent': 'Mozilla/5.0',
          referer: 'https://acc.example/reset?token=abc',
        },
        cookies: { sid: '1' },
      },
      user: { id: 'user-1', email: 'ada@example.be', ip_address: '203.0.113.9', username: 'ada' },
      extra: { body: { email: 'ada@example.be' }, attempt: 2 },
      contexts: { os: { name: 'Linux' }, note: { text: 'ada@example.be' } },
      breadcrumbs: [
        {
          category: 'http',
          message: 'POST /auth/register ada@example.be',
          data: { url: '/x?code=9' },
        },
      ],
    };

    const out = scrubSentryEvent(event);
    const serialized = JSON.stringify(out);

    expect(serialized).not.toContain('ada@example.be');
    expect(serialized).not.toContain('Secret123');
    expect(serialized).not.toContain('t0k3n');
    expect(serialized).not.toContain('eyJhbGci');
    expect(serialized).not.toContain('203.0.113.9');
    expect(out.user).toEqual({ id: 'user-1' });
    expect(out.request.headers).toMatchObject({
      authorization: FILTERED,
      cookie: FILTERED,
      'user-agent': 'Mozilla/5.0',
    });
    expect(out.request.cookies).toBe(FILTERED);
    expect(out.request.query_string).toEqual([
      ['token', FILTERED],
      ['lang', 'nl'],
    ]);
    expect(out.request.data).toMatchObject({ plan: 'free', name: FILTERED });
    expect(out.request.method).toBe('POST');
    expect(out.extra).toEqual({ body: { email: FILTERED }, attempt: 2 });
    expect(out.contexts.os).toEqual({ name: 'Linux' });
    expect(out.exception.values[0].type).toBe('PrismaClientKnownRequestError');
  });

  it('does not mutate the input event', () => {
    const event = { user: { id: 'u', email: 'a@b.be' }, extra: { email: 'a@b.be' } };
    scrubSentryEvent(event);
    expect(event.user.email).toBe('a@b.be');
    expect(event.extra.email).toBe('a@b.be');
  });

  it('handles an event with no optional fields', () => {
    expect(scrubSentryEvent({})).toEqual({});
    expect(scrubSentryEvent({ user: null })).toEqual({ user: null });
    const noId = { user: { id: undefined, email: 'a@b.be' } };
    expect(scrubSentryEvent(noId)).toEqual({ user: {} });
  });

  it('scrubs transaction names and span descriptions', () => {
    const out = scrubSentryEvent({
      transaction: 'GET /auth/verify?token=abc',
      spans: [{ description: 'GET https://x/reset?token=abc', data: { email: 'a@b.be' } }],
    });
    expect(out.transaction).toBe(`GET /auth/verify?token=${FILTERED}`);
    expect(JSON.stringify(out.spans)).not.toMatch(/abc|a@b\.be/);
  });
});

describe('scrubSentryBreadcrumb', () => {
  it('scrubs message and data, keeps the rest', () => {
    const out = scrubSentryBreadcrumb({
      category: 'console',
      message: 'login for a@b.be with Bearer xyz',
      data: { arguments: ['a@b.be'], status_code: 409 },
    });
    expect(out).toEqual({
      category: 'console',
      message: `login for ${FILTERED} with Bearer ${FILTERED}`,
      data: { arguments: [FILTERED], status_code: 409 },
    });
  });
});
