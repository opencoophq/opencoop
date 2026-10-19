jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

import { generateKeyPairSync } from 'crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { checkApplePrivateKey, isAppleLoginEnabled, resolveAppleLogin } from './apple-login.config';

describe('Apple login boot check', () => {
  let dir: string;
  let keyPath: string;
  let errorLog: jest.SpyInstance;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'apple-login-'));
    keyPath = join(dir, 'AuthKey_TEST.p8');
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(() => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errorLog.mockRestore());

  it('enables Apple login when the client id and a valid key are configured', () => {
    expect(resolveAppleLogin({ APPLE_CLIENT_ID: 'be.opencoop.test', APPLE_KEY_PATH: keyPath })).toBe(true);
    expect(isAppleLoginEnabled()).toBe(true);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('stays off quietly when APPLE_CLIENT_ID is not set', () => {
    expect(resolveAppleLogin({ APPLE_KEY_PATH: keyPath })).toBe(false);
    expect(isAppleLoginEnabled()).toBe(false);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  const unusable: Array<[string, () => string | undefined, RegExp]> = [
    ['the key path is not set', () => undefined, /APPLE_KEY_PATH is not set/],
    ['the key file is missing', () => join(dir, 'missing.p8'), /cannot read private key.*ENOENT/],
    [
      'the file is not a PEM key',
      () => {
        const p = join(dir, 'not-a-key.p8');
        writeFileSync(p, 'hello');
        return p;
      },
      /not a PEM private key/,
    ],
  ];

  it.each(unusable)('disables Apple login without throwing when %s', (_label, path, reason) => {
    let enabled: boolean | undefined;
    expect(() => {
      enabled = resolveAppleLogin({ APPLE_CLIENT_ID: 'be.opencoop.test', APPLE_KEY_PATH: path() });
    }).not.toThrow();
    expect(enabled).toBe(false);
    expect(isAppleLoginEnabled()).toBe(false);
    expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(reason));
    expect(Sentry.captureMessage).toHaveBeenCalledWith(expect.stringMatching(/Sign in with Apple DISABLED/), 'error');
  });

  it('reports an unreadable key file (EACCES)', () => {
    if (process.getuid?.() === 0) return; // root can read anything
    const p = join(dir, 'unreadable.p8');
    writeFileSync(p, 'x');
    chmodSync(p, 0o000);
    expect(checkApplePrivateKey(p)).toEqual({ ok: false, reason: expect.stringMatching(/EACCES/) });
  });
});
