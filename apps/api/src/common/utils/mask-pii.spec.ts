import { maskShareholderPII, maskShareholderListPII, maskShareholderRowPII } from './mask-pii';

describe('maskShareholderPII', () => {
  it('masks the fields the list renders (firstName/lastName/companyName/email)', () => {
    const masked = maskShareholderPII({
      id: 'abcd1234',
      firstName: 'Jan',
      lastName: 'Peeters',
      email: 'jan@example.be',
      companyName: null,
      sharesOwned: 5,
    });
    expect(masked.firstName).toBe('Aandeelhouder #1234');
    expect(masked.lastName).toBe('');
    expect(masked.email).toBe('***');
    // non-PII fields pass through untouched
    expect(masked.sharesOwned).toBe(5);
  });

  it('masks a company name', () => {
    const masked = maskShareholderPII({
      id: 'wxyz9999',
      companyName: 'Acme NV',
      email: 'info@acme.be',
    });
    expect(masked.companyName).toBe('Aandeelhouder #9999');
    expect(masked.email).toBe('***');
  });
});

describe('maskShareholderListPII', () => {
  it('masks the paginated { items } shape (regression: it previously no-op-ed on { data })', () => {
    const result = {
      items: [
        { id: 'a1', firstName: 'Jan', lastName: 'Peeters', email: 'jan@x.be' },
        { id: 'b2', companyName: 'Acme NV', email: 'info@acme.be' },
      ],
      total: 2,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    };
    const masked = maskShareholderListPII(result);
    expect(masked.items[0].email).toBe('***');
    expect(masked.items[0].firstName).toContain('Aandeelhouder #');
    expect(masked.items[0].lastName).toBe('');
    expect(masked.items[1].companyName).toContain('Aandeelhouder #');
    expect(masked.items[1].email).toBe('***');
    // pagination metadata preserved
    expect(masked.total).toBe(2);
    expect(masked.totalPages).toBe(1);
  });

  it('masks a bare array', () => {
    const masked = maskShareholderListPII([
      { id: 'abcd1234', firstName: 'Jan', email: 'jan@x.be' },
    ]);
    expect(masked[0].email).toBe('***');
  });
});

describe('maskShareholderRowPII', () => {
  const row = {
    id: 'card-1',
    label: 'Auto Fien',
    shareholderId: 'sh-abcd1234',
    shareholderNumber: 42 as number | null,
    shareholderName: 'Fien Vermeulen',
    shareholderEmail: 'fien@example.be' as string | null,
  };

  it('replaces the name with the member-number label and hides the email', () => {
    expect(maskShareholderRowPII(row)).toEqual({
      ...row,
      shareholderName: 'Aandeelhouder #42',
      shareholderEmail: '***',
    });
  });

  it('falls back to the id suffix without a member number and keeps a missing email null', () => {
    const masked = maskShareholderRowPII({
      ...row,
      shareholderNumber: null,
      shareholderEmail: null,
    });
    expect(masked.shareholderName).toBe('Aandeelhouder #1234');
    expect(masked.shareholderEmail).toBeNull();
    expect(masked.shareholderId).toBe('sh-abcd1234');
    expect(masked.shareholderNumber).toBeNull();
  });

  it('does not change an already masked row', () => {
    const once = maskShareholderRowPII(row);
    expect(maskShareholderRowPII(once)).toEqual(once);
  });
});
