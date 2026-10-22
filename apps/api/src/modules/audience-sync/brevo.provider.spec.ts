import { BrevoProvider, clearBrevoAttributeCache } from './brevo.provider';

function mockFetchOnce(status: number, body: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

/** Email may be written only on the primary contact. Other PUTs must not carry it. */
function expectNoEmailOnOtherContacts(primaryExtId: string) {
  const calls = (global.fetch as jest.Mock).mock.calls as Array<
    [string, { method?: string; body?: string }]
  >;
  for (const [url, opts] of calls) {
    if (opts.method !== 'PUT') continue;
    if (url.includes(`/contacts/${encodeURIComponent(primaryExtId)}?`)) continue;
    expect(JSON.parse(opts.body ?? '{}')).not.toHaveProperty('email');
  }
}

describe('BrevoProvider', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    clearBrevoAttributeCache();
  });

  it('verifyConnection returns ok on 200 when COOPERANT and STATUS exist', async () => {
    mockFetchOnce(200, { email: 'x@y.z' });
    mockFetchOnce(200, {
      attributes: [
        { name: 'COOPERANT', type: 'boolean' },
        { name: 'STATUS', type: 'text' },
        { name: 'FIRSTNAME', type: 'text' },
      ],
    });
    const p = new BrevoProvider('key');
    expect(await p.verifyConnection()).toEqual({ ok: true });
    const [attrUrl] = (global.fetch as jest.Mock).mock.calls[1];
    expect(attrUrl).toBe('https://api.brevo.com/v3/contacts/attributes');
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

  it('verifyConnection reports missing COOPERANT and STATUS without creating them', async () => {
    mockFetchOnce(200, { email: 'x@y.z' });
    mockFetchOnce(200, { attributes: [{ name: 'STATUS', type: 'float' }] });
    const p = new BrevoProvider('key');
    const r = await p.verifyConnection();
    expect(r.ok).toBe(true);
    expect(r.detail).toBeUndefined();
    expect(r.warning).toContain('MISSING_ATTRIBUTES');
    expect(r.warning).toContain('COOPERANT (boolean) is not defined');
    expect(r.warning).toContain('STATUS must be text, found float');
    expect((global.fetch as jest.Mock).mock.calls.map((call) => call[1].method)).toEqual([
      'GET',
      'GET',
    ]);
  });

  it('caches contact attributes so a second read does not fetch again', async () => {
    mockFetchOnce(200, {
      attributes: [
        { name: 'COOPERANT', type: 'boolean' },
        { name: 'STATUS', type: 'text' },
      ],
    });
    const first = new BrevoProvider('same-key');
    const second = new BrevoProvider('same-key');
    await first.listContactAttributes();
    await second.listContactAttributes();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://api.brevo.com/v3/contacts/attributes',
    );
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
    expectNoEmailOnOtherContacts('primary');
  });

  it('does not put an email field on any contact except the primary', async () => {
    mockFetchOnce(404, { code: 'document_not_found' });
    mockFetchOnce(400, { code: 'duplicate_parameter', message: 'email shared@x.be already used' });
    mockFetchOnce(404, { code: 'document_not_found' });
    mockFetchOnce(200, { email: 'shared@x.be' });
    mockFetchOnce(404, { code: 'document_not_found' });
    mockFetchOnce(204, {});

    const p = new BrevoProvider('key');
    await p.upsertContact({
      extId: 'primary',
      email: 'shared@x.be',
      attributes: { FIRSTNAME: 'Ann' },
      addListIds: [3],
      removeListIds: [9],
      createIfMissing: true,
      claimFromExtIds: ['secondary'],
    });

    const foreignPuts = (global.fetch as jest.Mock).mock.calls.filter(
      (call) => call[1].method === 'PUT' && !String(call[0]).includes('/contacts/primary?'),
    );
    expect(foreignPuts.length).toBeGreaterThan(0);
    expectNoEmailOnOtherContacts('primary');
  });

  it('fails with GROUP_EMAIL_CONFLICT when the primary already has a contact and a secondary holds the address', async () => {
    mockFetchOnce(400, { code: 'duplicate_parameter', message: 'email new@x.be already used' });
    mockFetchOnce(200, { email: 'new@x.be' }); // GET secondary
    mockFetchOnce(200, { email: 'old@x.be' }); // GET primary

    const p = new BrevoProvider('key');
    await expect(
      p.upsertContact({
        extId: 'primary',
        email: 'new@x.be',
        attributes: { FIRSTNAME: 'Ann' },
        addListIds: [3],
        removeListIds: [9],
        createIfMissing: true,
        claimFromExtIds: ['secondary'],
      }),
    ).rejects.toMatchObject({
      code: 'GROUP_EMAIL_CONFLICT',
      message: 'GROUP_EMAIL_CONFLICT',
    });

    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls.map((call) => call[1].method)).toEqual(['PUT', 'GET', 'GET']);
    expect(calls[0][0]).toContain('/contacts/primary?identifierType=ext_id');
    const secondaryCalls = calls.filter((call) => String(call[0]).includes('/contacts/secondary'));
    expect(secondaryCalls.map((call) => call[1].method)).toEqual(['GET']);
    expect(calls.filter((call) => call[1].method === 'PUT')).toHaveLength(1);
    expectNoEmailOnOtherContacts('primary');
    expect(JSON.stringify(calls.map((call) => call[1].body))).not.toContain('old@x.be');
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
