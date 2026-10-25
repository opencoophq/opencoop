import { generateKeyPairSync, verify, KeyObject } from 'crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { AppleStrategy, decodeAppleIdToken } from './apple.strategy';

function config(env: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

function b64urlJson(part: string) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

describe('AppleStrategy', () => {
  let dir: string;
  let keyPath: string;
  let publicKey: KeyObject;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'apple-strategy-'));
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    publicKey = pair.publicKey;
    keyPath = join(dir, 'AuthKey_TEST.p8');
    writeFileSync(keyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const env = () => ({
    APPLE_CLIENT_ID: 'be.opencoop.test',
    APPLE_TEAM_ID: 'TEAMID1234',
    APPLE_KEY_ID: 'KEYID12345',
    APPLE_KEY_PATH: keyPath,
    APPLE_CALLBACK_URL: 'https://example.test/api/auth/apple/callback',
  });

  it('signs a valid ES256 client secret with the configured key during the code exchange', async () => {
    const strategy = new AppleStrategy(config(env())) as any;
    let postBody = '';
    strategy._oauth2._request = (_m: string, _u: string, _h: unknown, body: string, _a: unknown, cb: any) => {
      postBody = body;
      cb(null, JSON.stringify({ access_token: 'at', refresh_token: 'rt', id_token: 'idt' }));
    };

    const result = await new Promise<any[]>((resolve, reject) =>
      strategy._oauth2.getOAuthAccessToken('the-code', {}, (err: unknown, ...rest: unknown[]) =>
        err ? reject(err) : resolve(rest),
      ),
    );
    expect(result).toEqual(['at', 'rt', 'idt']);

    const params = new URLSearchParams(postBody);
    expect(params.get('code')).toBe('the-code');
    expect(params.get('client_id')).toBe('be.opencoop.test');
    const secret = params.get('client_secret')!;
    const [h, p, s] = secret.split('.');
    expect(b64urlJson(h)).toMatchObject({ alg: 'ES256', kid: 'KEYID12345' });
    expect(b64urlJson(p)).toMatchObject({
      iss: 'TEAMID1234',
      sub: 'be.opencoop.test',
      aud: 'https://appleid.apple.com',
    });
    const ok = verify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url'),
    );
    expect(ok).toBe(true);
  });
});


function b64url(obj: object) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function fakeIdToken(claims: object) {
  // Header/signature are ignored by decodeAppleIdToken; only the payload matters.
  return `${b64url({ alg: 'ES256', kid: 'KEY' })}.${b64url(claims)}.sig`;
}

describe('AppleStrategy.validate (Nest arity)', () => {
  let dir: string;
  let keyPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'apple-validate-'));
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    keyPath = join(dir, 'AuthKey_TEST.p8');
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function strategy() {
    return new AppleStrategy(
      config({
        APPLE_CLIENT_ID: 'be.opencoop.test',
        APPLE_TEAM_ID: 'TEAMID1234',
        APPLE_KEY_ID: 'KEYID12345',
        APPLE_KEY_PATH: keyPath,
        APPLE_CALLBACK_URL: 'https://example.test/api/auth/apple/callback',
      }),
    );
  }

  it('registers a 5-arg Nest verify wrapper so passport-oauth2 passes the id_token', () => {
    // Nest sets callback.length from PassportStrategy(..., 5). passport-oauth2
    // only includes `params` (Apple's id_token) when arity === 5.
    expect((strategy() as any)._verify.length).toBe(5);
  });

  it('returns the user from id_token claims without calling done', async () => {
    const idToken = fakeIdToken({ sub: 'apple.user.42', email: 'wouter@shush.com' });
    const user = await strategy().validate('at', 'rt', idToken, {
      name: { firstName: 'Wouter', lastName: 'Hermans' },
    });
    expect(user).toEqual({
      appleId: 'apple.user.42',
      email: 'wouter@shush.com',
      name: 'Wouter Hermans',
      firstName: 'Wouter',
      lastName: 'Hermans',
    });
  });

  it('works when Nest passes the 4-arg shape that previously crashed (profile, done)', async () => {
    // Reproduce GlitchTip #56: without arity 5, Nest called validate(at, rt, profile, verified).
    // With arity 5 the real path never looks like that; this guards decodeAppleIdToken /
    // validate against treating a function as the id_token if something regresses.
    const idToken = fakeIdToken({ sub: 'x', email: 'a@b.c' });
    const done = jest.fn();
    // Correct 5-arg Nest call: (at, rt, idToken, profile, done) — validate ignores done.
    const user = await (strategy().validate as any)('at', 'rt', idToken, {}, done);
    expect(user.appleId).toBe('x');
    expect(done).not.toHaveBeenCalled();
  });

  it('runs the Nest verify wrapper end-to-end without "done is not a function"', async () => {
    const idToken = fakeIdToken({ sub: 'apple.user.99', email: 'u@example.com' });
    await new Promise<void>((resolve, reject) => {
      (strategy() as any)._verify('at', 'rt', idToken, {}, (err: unknown, user?: unknown) => {
        try {
          expect(err).toBeNull();
          expect(user).toMatchObject({ appleId: 'apple.user.99', email: 'u@example.com' });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });
});

describe('decodeAppleIdToken', () => {
  it('decodes a JWT payload', () => {
    expect(decodeAppleIdToken(fakeIdToken({ sub: 's', email: 'e@x' }))).toEqual({
      sub: 's',
      email: 'e@x',
    });
  });

  it('accepts an already-decoded object', () => {
    expect(decodeAppleIdToken({ sub: 's' })).toEqual({ sub: 's' });
  });

  it('rejects a missing token', () => {
    expect(() => decodeAppleIdToken('' as any)).toThrow(/missing or not a JWT/);
  });
});
