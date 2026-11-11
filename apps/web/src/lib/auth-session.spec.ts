import { shouldDropSessionAfterAuthMe } from './auth-session';

describe('shouldDropSessionAfterAuthMe', () => {
  it('drops the session when the token is rejected', () => {
    expect(shouldDropSessionAfterAuthMe(401)).toBe(true);
    expect(shouldDropSessionAfterAuthMe(403)).toBe(true);
  });

  it('keeps the session when the profile call is rate limited or the server fails', () => {
    expect(shouldDropSessionAfterAuthMe(429)).toBe(false);
    expect(shouldDropSessionAfterAuthMe(500)).toBe(false);
    expect(shouldDropSessionAfterAuthMe(503)).toBe(false);
  });
});
