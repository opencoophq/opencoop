import { BrevoProvider } from './brevo.provider';

function mockFetchOnce(status: number, body: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe('BrevoProvider', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('verifyConnection returns ok on 200', async () => {
    mockFetchOnce(200, { email: 'x@y.z' });
    const p = new BrevoProvider('key');
    expect(await p.verifyConnection()).toEqual({ ok: true });
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/account');
    expect(opts.headers['api-key']).toBe('key');
  });

  it('verifyConnection surfaces the 401 IP message', async () => {
    mockFetchOnce(401, { message: 'unrecognised IP address', code: 'unauthorized' });
    const p = new BrevoProvider('key');
    const r = await p.verifyConnection();
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('unrecognised IP');
  });

  it('listLists maps id+name', async () => {
    mockFetchOnce(200, { lists: [{ id: 3, name: 'Coöperanten' }], count: 1 });
    const p = new BrevoProvider('key');
    expect(await p.listLists()).toEqual([{ id: '3', name: 'Coöperanten' }]);
  });

  it('upsertContact updates existing contact by ext_id (PUT 204) → "updated"', async () => {
    mockFetchOnce(204, {});
    const p = new BrevoProvider('key');
    const res = await p.upsertContact({
      extId: 'sh_1',
      email: 'a@b.c',
      attributes: { FIRSTNAME: 'A', LASTNAME: 'B' },
      addListIds: [3],
      removeListIds: [],
      createIfMissing: true,
    });
    expect(res).toBe('updated');
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/contacts/sh_1?identifierType=ext_id');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).not.toHaveProperty('emailBlacklisted');
  });

  it('upsertContact falls back to POST create when ext_id missing (PUT 404) → "created"', async () => {
    mockFetchOnce(404, { code: 'document_not_found' }); // PUT
    mockFetchOnce(201, { id: 99 }); // POST
    const p = new BrevoProvider('key');
    const res = await p.upsertContact({
      extId: 'sh_2',
      email: 'n@b.c',
      attributes: { FIRSTNAME: 'N', LASTNAME: 'B' },
      addListIds: [3],
      removeListIds: [],
      createIfMissing: true,
    });
    expect(res).toBe('created');
    const [, postOpts] = (global.fetch as jest.Mock).mock.calls[1];
    const body = JSON.parse(postOpts.body);
    expect(body.ext_id).toBe('sh_2');
    expect(body.updateEnabled).toBe(true);
    expect(body).not.toHaveProperty('emailBlacklisted');
  });

  it('upsertContact returns "noop" for resigned contact not found (PUT 404, createIfMissing false)', async () => {
    mockFetchOnce(404, { code: 'document_not_found' });
    const p = new BrevoProvider('key');
    const res = await p.upsertContact({
      extId: 'sh_3',
      email: null,
      attributes: {},
      addListIds: [],
      removeListIds: [3],
      createIfMissing: false,
    });
    expect(res).toBe('noop');
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1); // no POST
  });

  it('upsertContact throws on unexpected error (400)', async () => {
    mockFetchOnce(400, { message: 'duplicate_parameter' });
    const p = new BrevoProvider('key');
    await expect(
      p.upsertContact({
        extId: 'sh_4',
        email: 'dup@b.c',
        attributes: {},
        addListIds: [3],
        removeListIds: [],
        createIfMissing: true,
      }),
    ).rejects.toThrow(/duplicate_parameter/);
  });
});
