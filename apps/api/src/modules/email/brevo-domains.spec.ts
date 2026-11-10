import {
  authenticateBrevoDomain,
  BrevoDomainRequestError,
  createBrevoDomain,
  getBrevoDomain,
  parseBrevoDomainPayload,
} from './brevo-domains';

const API_KEY = 'platform-brevo-test-key-991';

const cnamePayload = {
  domain: 'bronsgroen.be',
  verified: false,
  authenticated: false,
  dns_records: {
    brevo_code: {
      type: 'TXT',
      host_name: '@',
      value: 'brevo-code:abc123',
      status: false,
    },
    dkim1Record: {
      type: 'CNAME',
      host_name: 'brevo1._domainkey',
      value: 'b1.bronsgroen-be.dkim.brevo.com',
      status: false,
    },
    dkim2Record: {
      type: 'CNAME',
      host_name: 'brevo2._domainkey',
      value: 'b2.bronsgroen-be.dkim.brevo.com',
      status: false,
    },
    dmarc_record: {
      type: 'TXT',
      host_name: '_dmarc',
      value: 'v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com',
      status: false,
    },
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

describe('Brevo domain payloads', () => {
  it('reads CNAME DKIM records and always adds SPF merge guidance', () => {
    const snapshot = parseBrevoDomainPayload(cnamePayload, 'bronsgroen.be');
    const dkim = snapshot.records.filter((record) => record.key === 'dkim');

    expect(dkim.map((record) => record.host)).toEqual(['brevo1._domainkey', 'brevo2._domainkey']);
    expect(dkim.every((record) => record.type === 'CNAME')).toBe(true);
    expect(snapshot.records.find((record) => record.key === 'brevo-code')?.value).toBe(
      'brevo-code:abc123',
    );
    const spf = snapshot.records.find((record) => record.key === 'spf');
    expect(spf).toEqual(
      expect.objectContaining({
        value: 'include:spf.brevo.com',
        merge: true,
        newRecordValue: 'v=spf1 include:spf.brevo.com ~all',
      }),
    );
    expect(snapshot.records.find((record) => record.key === 'dmarc')?.ifMissing).toBe(true);
  });

  it('keeps a legacy single DKIM TXT when Brevo does not return CNAMEs', () => {
    const snapshot = parseBrevoDomainPayload(
      {
        domain: 'mycompany.com',
        verified: true,
        authenticated: false,
        dns_records: {
          dkim1Record: null,
          dkim2Record: null,
          dkim_record: {
            type: 'TXT',
            host_name: 'mail._domainkey.mycompany.com',
            value: 'k=rsa;p=abc',
            status: false,
          },
          brevo_code: {
            type: 'TXT',
            host_name: '',
            value: 'brevo-code:abc',
            status: true,
          },
        },
      },
      'mycompany.com',
    );

    expect(snapshot.verified).toBe(true);
    expect(snapshot.authenticated).toBe(false);
    const dkim = snapshot.records.filter((record) => record.key === 'dkim');
    expect(dkim).toEqual([
      expect.objectContaining({ type: 'TXT', host: 'mail._domainkey', value: 'k=rsa;p=abc' }),
    ]);
    expect(snapshot.records.find((record) => record.key === 'brevo-code')?.host).toBe('@');
    expect(snapshot.records.find((record) => record.key === 'dmarc')?.host).toBe('_dmarc');
  });
});

describe('Brevo domain requests', () => {
  const fetchImpl = jest.fn();

  beforeEach(() => {
    fetchImpl.mockReset();
  });

  it('creates a domain and treats "already exists" as success without leaking the key', async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(400, `domain already exists ${API_KEY}`));

    await expect(createBrevoDomain(API_KEY, 'bronsgroen.be', fetchImpl)).resolves.toBeNull();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/senders/domains');
    expect(url).not.toContain(API_KEY);
    expect(init.headers['api-key']).toBe(API_KEY);
    expect(JSON.parse(init.body)).toEqual({ name: 'bronsgroen.be' });
  });

  it('strips the API key from a failed response', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(401, `bad key ${API_KEY}`));

    const error = await getBrevoDomain(API_KEY, 'bronsgroen.be', fetchImpl).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(BrevoDomainRequestError);
    expect((error as Error).message).not.toContain(API_KEY);
    expect((error as Error).message).toContain('[redacted]');
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain(API_KEY);
  });

  it('treats authenticate HTTP 400 as DNS not ready', async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(400, { message: 'record mismatch' }));
    await expect(authenticateBrevoDomain(API_KEY, 'bronsgroen.be', fetchImpl)).resolves.toEqual({
      ok: false,
      missing: false,
    });
  });
});
