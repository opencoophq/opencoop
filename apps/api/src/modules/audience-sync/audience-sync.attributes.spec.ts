import {
  describeMissingBrevoAttributes,
  filterMemberAttributes,
  memberAttributeSupport,
  memberContactAttributes,
} from './audience-sync.attributes';

const base = {
  firstName: 'Ann',
  lastName: 'De Vries',
  companyName: null,
};

describe('memberContactAttributes', () => {
  it('marks an active member', () => {
    expect(memberContactAttributes({ ...base, status: 'ACTIVE' })).toEqual({
      FIRSTNAME: 'Ann',
      LASTNAME: 'De Vries',
      COOPERANT: true,
      STATUS: 'active',
    });
  });

  it('marks a resigned member and falls back to the company name', () => {
    expect(
      memberContactAttributes({
        status: 'INACTIVE',
        firstName: null,
        lastName: null,
        companyName: 'Acme',
      }),
    ).toEqual({
      LASTNAME: 'Acme',
      COOPERANT: false,
      STATUS: 'resigned',
    });
  });

  it('does not call a pending shareholder resigned', () => {
    expect(memberContactAttributes({ ...base, status: 'PENDING' })).toEqual({
      FIRSTNAME: 'Ann',
      LASTNAME: 'De Vries',
      COOPERANT: false,
    });
  });
});

describe('describeMissingBrevoAttributes', () => {
  it('returns null when both attributes have the right type', () => {
    expect(
      describeMissingBrevoAttributes([
        { name: 'cooperant', type: 'boolean' },
        { name: 'Status', type: 'text' },
      ]),
    ).toBeNull();
  });

  it('names a missing attribute and a wrong type', () => {
    const detail = describeMissingBrevoAttributes([{ name: 'STATUS', type: 'float' }]);
    expect(detail).toContain('COOPERANT (boolean) is not defined');
    expect(detail).toContain('STATUS must be text, found float');
  });

  it('drops only the attributes the account does not define', () => {
    const support = memberAttributeSupport([{ name: 'STATUS', type: 'text' }]);
    expect(support.cooperant).toBe(false);
    expect(support.status).toBe(true);
    expect(support.warning).toContain('MISSING_ATTRIBUTES');
    expect(
      filterMemberAttributes({ FIRSTNAME: 'Ann', COOPERANT: true, STATUS: 'active' }, support),
    ).toEqual({ FIRSTNAME: 'Ann', STATUS: 'active' });
  });
});
