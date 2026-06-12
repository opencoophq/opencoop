import { maskShareholderPII, maskShareholderListPII } from './mask-pii';

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
    const masked = maskShareholderPII({ id: 'wxyz9999', companyName: 'Acme NV', email: 'info@acme.be' });
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
    const masked = maskShareholderListPII([{ id: 'abcd1234', firstName: 'Jan', email: 'jan@x.be' }]);
    expect(masked[0].email).toBe('***');
  });
});
