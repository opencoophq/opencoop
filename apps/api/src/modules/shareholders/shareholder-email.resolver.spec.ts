import { resolveShareholderEmail, resolveShareholderEmailWithSource } from './shareholder-email.resolver';

describe('resolveShareholderEmail', () => {
  it('returns user.email when user is linked and has email', () => {
    const sh = { email: null, user: { email: 'jan@example.com' } } as any;
    expect(resolveShareholderEmail(sh)).toBe('jan@example.com');
  });

  it('falls back to shareholder.email when user is null', () => {
    const sh = { email: 'solo@example.com', user: null } as any;
    expect(resolveShareholderEmail(sh)).toBe('solo@example.com');
  });

  it('falls back to shareholder.email when user has no email (edge case)', () => {
    const sh = { email: 'solo@example.com', user: { email: null } } as any;
    expect(resolveShareholderEmail(sh)).toBe('solo@example.com');
  });

  it('returns null when neither has email (postal-only shareholder)', () => {
    const sh = { email: null, user: { email: null } } as any;
    expect(resolveShareholderEmail(sh)).toBeNull();
  });

  it('prefers user.email even if shareholder.email also set (user is source of truth)', () => {
    const sh = { email: 'old@example.com', user: { email: 'new@example.com' } } as any;
    expect(resolveShareholderEmail(sh)).toBe('new@example.com');
  });

  it('resolveShareholderEmailWithSource returns {email, source} for audit/logs', () => {
    const sh = { email: null, user: { email: 'jan@example.com' } } as any;
    expect(resolveShareholderEmailWithSource(sh)).toEqual({
      email: 'jan@example.com',
      source: 'user',
    });
  });
});
