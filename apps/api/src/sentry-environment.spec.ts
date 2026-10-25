import { sentryDsn, sentryEnvironment } from './sentry-environment';

const glitchtip = 'https://public@glitchtip.example.com/1';

describe('sentryEnvironment', () => {
  it('tags the acc host as acc', () => {
    expect(sentryEnvironment('https://acc.opencoop.be', undefined, 'production')).toBe('acc');
  });

  it('tags the prod host as prod', () => {
    expect(sentryEnvironment('https://opencoop.be', undefined, 'production')).toBe('prod');
  });

  it('normalizes the previous acceptance and production names', () => {
    expect(sentryEnvironment('https://opencoop.be', 'acceptance', 'production')).toBe('acc');
    expect(sentryEnvironment('https://acc.opencoop.be', 'production', 'production')).toBe('prod');
    expect(sentryEnvironment(undefined, undefined, 'production')).toBe('prod');
  });

  it('prefers an explicit SENTRY_ENVIRONMENT that is not one of those aliases', () => {
    expect(sentryEnvironment('https://acc.opencoop.be', 'staging', 'production')).toBe('staging');
  });

  it('falls back to NODE_ENV, then development', () => {
    expect(sentryEnvironment(undefined, undefined, 'test')).toBe('test');
    expect(sentryEnvironment('not a url', undefined, undefined)).toBe('development');
  });
});

describe('sentryDsn', () => {
  it('reads a GlitchTip DSN from the environment', () => {
    expect(sentryDsn(glitchtip)).toBe(glitchtip);
    expect(sentryDsn(`  ${glitchtip}  `)).toBe(glitchtip);
  });

  it('ignores a missing DSN and any sentry.io host', () => {
    expect(sentryDsn(undefined)).toBeUndefined();
    expect(sentryDsn('')).toBeUndefined();
    expect(sentryDsn('   ')).toBeUndefined();
    expect(sentryDsn('https://public@o123.ingest.sentry.io/1')).toBeUndefined();
    expect(sentryDsn('https://public@sentry.io/1')).toBeUndefined();
    expect(sentryDsn('not a url')).toBeUndefined();
  });
});
