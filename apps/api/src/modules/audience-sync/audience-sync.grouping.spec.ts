import { groupShareholdersByEmail, normalizeEmail, selectPrimary } from './audience-sync.grouping';

function sh(over: Record<string, unknown> = {}) {
  return {
    id: 'sh',
    status: 'ACTIVE',
    email: null as string | null,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    userId: null as string | null,
    user: null as { email: string | null } | null,
    ...over,
  };
}

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ann@X.BE ')).toBe('ann@x.be');
  });

  it('treats blank as missing', () => {
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe('selectPrimary', () => {
  it('prefers ACTIVE over an older INACTIVE shareholder, even when both User emails match', () => {
    const inactive = sh({
      id: 'inactive',
      status: 'INACTIVE',
      createdAt: new Date('2015-01-01'),
      userId: 'u1',
      user: { email: 'shared@x.be' },
    });
    const active = sh({
      id: 'active',
      status: 'ACTIVE',
      createdAt: new Date('2024-01-01'),
      userId: 'u1',
      user: { email: 'shared@x.be' },
    });
    expect(selectPrimary([inactive, active], 'shared@x.be').id).toBe('active');
  });

  it('ranks ACTIVE, then INACTIVE, then PENDING, before the User email match', () => {
    const pending = sh({
      id: 'pending',
      status: 'PENDING',
      createdAt: new Date('2010-01-01'),
      user: { email: 'shared@x.be' },
    });
    const inactive = sh({
      id: 'inactive',
      status: 'INACTIVE',
      createdAt: new Date('2011-01-01'),
      email: 'shared@x.be',
      user: null,
    });
    const active = sh({
      id: 'active',
      status: 'ACTIVE',
      createdAt: new Date('2024-01-01'),
      email: 'shared@x.be',
      user: null,
    });
    expect(selectPrimary([pending, inactive, active], 'shared@x.be').id).toBe('active');
    expect(selectPrimary([pending, inactive], 'shared@x.be').id).toBe('inactive');
  });

  it('picks the shareholder whose linked User.email matches, even if they are newer', () => {
    const older = sh({
      id: 'older',
      createdAt: new Date('2018-01-01'),
      email: 'Shared@X.be',
      user: null,
    });
    const owner = sh({
      id: 'owner',
      createdAt: new Date('2024-01-01'),
      email: null,
      userId: 'u1',
      user: { email: 'shared@x.be' },
    });
    expect(selectPrimary([older, owner], 'shared@x.be').id).toBe('owner');
  });

  it('breaks ties between User-owners by oldest createdAt, then id', () => {
    const later = sh({
      id: 'b',
      createdAt: new Date('2021-01-01'),
      userId: 'u1',
      user: { email: 'shared@x.be' },
    });
    const earlierSameDayB = sh({
      id: 'b-id',
      createdAt: new Date('2019-01-01'),
      userId: 'u1',
      user: { email: 'shared@x.be' },
    });
    const earlierSameDayA = sh({
      id: 'a-id',
      createdAt: new Date('2019-01-01'),
      userId: 'u1',
      user: { email: 'shared@x.be' },
    });
    expect(selectPrimary([later, earlierSameDayB, earlierSameDayA], 'shared@x.be').id).toBe('a-id');
  });

  it('falls back to the oldest shareholder when no linked User.email matches', () => {
    const newer = sh({
      id: 'newer',
      createdAt: new Date('2022-01-01'),
      email: 'Ann@X.be',
      user: null,
    });
    const older = sh({
      id: 'older',
      createdAt: new Date('2017-01-01'),
      email: 'ann@x.be',
      user: null,
    });
    expect(selectPrimary([newer, older], 'ann@x.be').id).toBe('older');
  });
});

describe('groupShareholdersByEmail', () => {
  it('groups by normalized resolved email and puts the primary first', () => {
    const child = sh({
      id: 'child',
      createdAt: new Date('2021-05-01'),
      email: null,
      userId: 'parent-user',
      user: { email: 'Parent@X.be' },
    });
    const parent = sh({
      id: 'parent',
      createdAt: new Date('2019-05-01'),
      email: 'parent@x.be',
      userId: 'parent-user',
      user: { email: 'parent@x.be' },
    });
    const alone = sh({
      id: 'alone',
      email: 'solo@x.be',
      user: { email: 'solo@x.be' },
    });
    const nameless = sh({ id: 'nameless', email: null, user: null });

    const groups = groupShareholdersByEmail([child, nameless, alone, parent]);

    expect(groups.map((group) => group.email)).toEqual(['parent@x.be', 'solo@x.be', null]);
    expect(groups[0].shareholders.map((s) => s.id)).toEqual(['parent', 'child']);
    expect(groups[1].shareholders.map((s) => s.id)).toEqual(['alone']);
    expect(groups[2].shareholders.map((s) => s.id)).toEqual(['nameless']);
  });
});
