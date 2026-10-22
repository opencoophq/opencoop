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

  it('unlinks lists after create when POST cannot carry unlinkListIds', async () => {
    mockFetchOnce(404, { code: 'document_not_found' });
    mockFetchOnce(201, { id: 99 });
    mockFetchOnce(204, {});
    const p = new BrevoProvider('key');
    const res = await p.upsertContact({
      extId: 'sh_new',
      email: 'n@b.c',
      attributes: { FIRSTNAME: 'N' },
      addListIds: [3],
      removeListIds: [9],
      createIfMissing: true,
    });
    expect(res).toBe('created');
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls.map((call) => call[1].method)).toEqual(['PUT', 'POST', 'PUT']);
    const unlink = JSON.parse(calls[2][1].body);
    expect(unlink).toEqual({ unlinkListIds: [9] });
    expect(calls[2][0]).toContain('/contacts/sh_new?identifierType=ext_id');
    expect(JSON.parse(calls[1][1].body)).not.toHaveProperty('unlinkListIds');
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

  it('upsertContact maps duplicate_parameter to DUPLICATE_EMAIL and hides the raw body', async () => {
    mockFetchOnce(400, {
      code: 'duplicate_parameter',
      message: 'email dup@b.c is already associated with another Contact',
    });
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
    ).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL', message: 'DUPLICATE_EMAIL' });
  });

  it('retries PUT once after POST duplicate_parameter and stops when that succeeds', async () => {
    mockFetchOnce(404, { code: 'document_not_found' });
    mockFetchOnce(400, { code: 'duplicate_parameter', message: 'email shared@x.be already used' });
    mockFetchOnce(204, {});

    const p = new BrevoProvider('key');
    const res = await p.upsertContact({
      extId: 'primary',
      email: 'shared@x.be',
      attributes: { FIRSTNAME: 'Ann' },
      addListIds: [3],
      removeListIds: [9],
      createIfMissing: true,
      claimFromExtIds: ['secondary'],
    });

    expect(res).toBe('updated');
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls.map((call) => call[1].method)).toEqual(['PUT', 'POST', 'PUT']);
    expect(calls[2][0]).toContain('/contacts/primary?identifierType=ext_id');
    expect(JSON.parse(calls[2][1].body).unlinkListIds).toEqual([9]);
  });

  it('adopts a secondary EXT_ID that already holds the email instead of deleting it', async () => {
    mockFetchOnce(404, { code: 'document_not_found' }); // PUT primary
    mockFetchOnce(400, {
      code: 'duplicate_parameter',
      message: 'email shared@x.be already used',
    }); // POST
    mockFetchOnce(404, { code: 'document_not_found' }); // retry PUT still missing
    mockFetchOnce(200, { email: 'shared@x.be' }); // GET secondary
    mockFetchOnce(404, { code: 'document_not_found' }); // GET primary
    mockFetchOnce(204, {}); // PUT reassign ext_id

    const p = new BrevoProvider('key');
    const res = await p.upsertContact({
      extId: 'primary',
      email: 'shared@x.be',
      attributes: { FIRSTNAME: 'Ann' },
      addListIds: [3],
      removeListIds: [9],
      createIfMissing: true,
      claimFromExtIds: ['secondary'],
    });

    expect(res).toBe('updated');
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls.map((call) => call[1].method)).toEqual([
      'PUT',
      'POST',
      'PUT',
      'GET',
      'GET',
      'PUT',
    ]);
    const reassign = JSON.parse(calls[5][1].body);
    expect(reassign.ext_id).toBe('primary');
    expect(reassign.listIds).toEqual([3]);
    expect(reassign.unlinkListIds).toEqual([9]);
    expect(reassign).not.toHaveProperty('forceMerge');
    expect(calls[5][0]).toContain('/contacts/secondary?identifierType=ext_id');
    expect(calls.map((call) => call[1].method)).not.toContain('DELETE');
  });

  it('parks the primary old address on a same-group secondary and clears that EXT_ID', async () => {
    mockFetchOnce(400, { code: 'duplicate_parameter', message: 'email new@x.be already used' });
    mockFetchOnce(200, { email: 'new@x.be' }); // GET secondary
    mockFetchOnce(200, { email: 'old@x.be' }); // GET primary
    mockFetchOnce(204, {}); // park secondary
    mockFetchOnce(204, {}); // PUT primary onto the new address

    const p = new BrevoProvider('key');
    const res = await p.upsertContact({
      extId: 'primary',
      email: 'new@x.be',
      attributes: { FIRSTNAME: 'Ann' },
      addListIds: [3],
      removeListIds: [9],
      createIfMissing: true,
      claimFromExtIds: ['secondary'],
    });

    expect(res).toBe('updated');
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls.map((call) => call[1].method)).toEqual(['PUT', 'GET', 'GET', 'PUT', 'PUT']);
    const park = JSON.parse(calls[3][1].body);
    expect(calls[3][0]).toContain('/contacts/secondary?identifierType=ext_id');
    expect(park).toEqual({
      email: 'old@x.be',
      ext_id: '',
      listIds: [],
      unlinkListIds: [3, 9],
    });
    expect(park).not.toHaveProperty('forceMerge');
    const primary = JSON.parse(calls[4][1].body);
    expect(primary.email).toBe('new@x.be');
    expect(primary).not.toHaveProperty('forceMerge');
    expect(calls.map((call) => call[1].method)).not.toContain('DELETE');
  });

  it('keeps DUPLICATE_EMAIL when the primary contact has no address to park', async () => {
    mockFetchOnce(400, { code: 'duplicate_parameter', message: 'email new@x.be already used' });
    mockFetchOnce(200, { email: 'new@x.be' });
    mockFetchOnce(200, { email: null });

    const p = new BrevoProvider('key');
    await expect(
      p.upsertContact({
        extId: 'primary',
        email: 'new@x.be',
        attributes: {},
        addListIds: [3],
        removeListIds: [],
        createIfMissing: true,
        claimFromExtIds: ['secondary'],
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL' });
    expect((global.fetch as jest.Mock).mock.calls.map((call) => call[1].method)).toEqual([
      'PUT',
      'GET',
      'GET',
    ]);
  });

  it('keeps DUPLICATE_EMAIL when the address is not held by a same-group EXT_ID', async () => {
    mockFetchOnce(400, { code: 'duplicate_parameter', message: 'email new@x.be already used' });
    mockFetchOnce(200, { email: 'other@x.be' });

    const p = new BrevoProvider('key');
    await expect(
      p.upsertContact({
        extId: 'primary',
        email: 'new@x.be',
        attributes: {},
        addListIds: [3],
        removeListIds: [],
        createIfMissing: true,
        claimFromExtIds: ['secondary'],
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL' });
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls.map((call) => call[1].method)).toEqual(['PUT', 'GET']);
    expect(calls[1][0]).toContain('/contacts/secondary');
    expect(calls.map((call) => call[1].method)).not.toContain('DELETE');
  });

  it('does not adopt a secondary contact that holds a different email', async () => {
    mockFetchOnce(404, { code: 'document_not_found' });
    mockFetchOnce(400, { code: 'duplicate_parameter', message: 'email shared@x.be already used' });
    mockFetchOnce(404, { code: 'document_not_found' }); // retry PUT
    mockFetchOnce(200, { email: 'other@x.be' });

    const p = new BrevoProvider('key');
    await expect(
      p.upsertContact({
        extId: 'primary',
        email: 'shared@x.be',
        attributes: {},
        addListIds: [3],
        removeListIds: [],
        createIfMissing: true,
        claimFromExtIds: ['secondary'],
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL' });
    expect((global.fetch as jest.Mock).mock.calls.map((call) => call[1].method)).not.toContain(
      'DELETE',
    );
  });
});
