import { generateKeyPairSync, verify, KeyObject } from 'crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { AppleStrategy } from './apple.strategy';

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
