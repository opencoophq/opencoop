import { sentryEnvironment } from './sentry-environment';

describe('sentryEnvironment', () => {
  it('tags the acc host as acceptance', () => {
    expect(sentryEnvironment('https://acc.opencoop.be', undefined, 'production')).toBe('acceptance');
  });

  it('keeps production for the prod host', () => {
    expect(sentryEnvironment('https://opencoop.be', undefined, 'production')).toBe('production');
  });

  it('prefers an explicit SENTRY_ENVIRONMENT', () => {
    expect(sentryEnvironment('https://acc.opencoop.be', 'staging', 'production')).toBe('staging');
  });

  it('falls back to NODE_ENV, then development', () => {
    expect(sentryEnvironment(undefined, undefined, 'test')).toBe('test');
    expect(sentryEnvironment('not a url', undefined, undefined)).toBe('development');
  });
});
