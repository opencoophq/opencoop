jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { MfaService } from './mfa.service';
import { OAuthService } from './oauth.service';
import { MagicLinkService } from './magic-link.service';
import { EmancipationService } from './emancipation.service';
import { WebAuthnService } from './webauthn.service';
import { CoopAdminsService } from '../coop-admins/coop-admins.service';
import { AuditService } from '../audit/audit.service';
import { MAGIC_LINK_SENT_MESSAGE } from './magic-link.constants';

/**
 * The sign-in link is a frontend URL. Scanners still GET or HEAD whatever
 * path they find, including the verify URL. Those methods must not reach the
 * service, because only the confirm button's POST consumes the token.
 */
describe('magic-link HTTP consumption and IP rate limit', () => {
  let app: INestApplication;
  let baseUrl: string;
  const magic = {
    requestMagicLink: jest.fn().mockResolvedValue({ message: MAGIC_LINK_SENT_MESSAGE }),
    verifyMagicLink: jest.fn().mockResolvedValue({ accessToken: 'access' }),
    verifyMagicLinkCode: jest.fn().mockResolvedValue({ accessToken: 'access' }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
      controllers: [AuthController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: AuthService, useValue: {} },
        { provide: TokenService, useValue: {} },
        { provide: MfaService, useValue: {} },
        { provide: OAuthService, useValue: {} },
        { provide: MagicLinkService, useValue: magic },
        { provide: EmancipationService, useValue: {} },
        { provide: WebAuthnService, useValue: {} },
        { provide: CoopAdminsService, useValue: {} },
        { provide: AuditService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function post(path: string, body: Record<string, string>) {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('does not consume a token on GET or HEAD', async () => {
    const getVerify = await fetch(`${baseUrl}/auth/magic-link/verify?token=abc123`);
    const headVerify = await fetch(`${baseUrl}/auth/magic-link/verify?token=abc123`, {
      method: 'HEAD',
    });
    const getCode = await fetch(`${baseUrl}/auth/magic-link/code?email=a@example.com&code=123456`);
    const headCode = await fetch(`${baseUrl}/auth/magic-link/code?email=a@example.com&code=123456`, {
      method: 'HEAD',
    });

    expect(getVerify.status).toBe(404);
    expect(headVerify.status).toBe(404);
    expect(getCode.status).toBe(404);
    expect(headCode.status).toBe(404);
    expect(magic.verifyMagicLink).not.toHaveBeenCalled();
    expect(magic.verifyMagicLinkCode).not.toHaveBeenCalled();
    expect(magic.requestMagicLink).not.toHaveBeenCalled();

    const posted = await post('/auth/magic-link/verify', { token: 'abc123' });
    expect(posted.status).toBe(201);
    expect(magic.verifyMagicLink).toHaveBeenCalledTimes(1);
    expect(magic.verifyMagicLink).toHaveBeenCalledWith(
      { token: 'abc123' },
      expect.any(String),
      expect.anything(),
    );
  });

  it('rate limits magic-link requests per IP without echoing the email', async () => {
    const first = await post('/auth/magic-link/request', { email: 'one@example.com' });
    const second = await post('/auth/magic-link/request', { email: 'two@example.com' });
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(firstBody).toEqual(secondBody);
    expect(firstBody).toEqual({ message: MAGIC_LINK_SENT_MESSAGE });

    const third = await post('/auth/magic-link/request', { email: 'one@example.com' });
    expect(third.status).toBe(201);

    const fourth = await post('/auth/magic-link/request', { email: 'two@example.com' });
    expect(fourth.status).toBe(429);
    const blocked = JSON.stringify(await fourth.json());
    expect(blocked).not.toContain('one@example.com');
    expect(blocked).not.toContain('two@example.com');
    expect(magic.requestMagicLink).toHaveBeenCalledTimes(3);
  });
});
