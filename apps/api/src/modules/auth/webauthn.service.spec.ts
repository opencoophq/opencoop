import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebAuthnService } from './webauthn.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from './redis.service';

async function buildService(env: Record<string, string>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      WebAuthnService,
      { provide: PrismaService, useValue: {} },
      { provide: RedisService, useValue: {} },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string, fallback?: string) => env[key] ?? fallback,
        },
      },
    ],
  }).compile();

  return module.get<WebAuthnService>(WebAuthnService);
}

describe('WebAuthnService relying party config', () => {
  it('derives rpId and origin from FRONTEND_URL', async () => {
    const service = await buildService({ FRONTEND_URL: 'https://opencoop.be' });

    expect(service.rpId).toBe('opencoop.be');
    expect(service.origin).toBe('https://opencoop.be');
  });

  it('derives from FRONTEND_URL on the acceptance subdomain', async () => {
    const service = await buildService({ FRONTEND_URL: 'https://acc.opencoop.be' });

    expect(service.rpId).toBe('acc.opencoop.be');
    expect(service.origin).toBe('https://acc.opencoop.be');
  });

  it('normalises a trailing slash and path off FRONTEND_URL', async () => {
    const service = await buildService({ FRONTEND_URL: 'https://opencoop.be/' });

    expect(service.rpId).toBe('opencoop.be');
    expect(service.origin).toBe('https://opencoop.be');
  });

  it('keeps the port out of rpId but inside origin for local development', async () => {
    const service = await buildService({ FRONTEND_URL: 'http://localhost:3002' });

    expect(service.rpId).toBe('localhost');
    expect(service.origin).toBe('http://localhost:3002');
  });

  it('falls back to local development defaults when FRONTEND_URL is unset', async () => {
    const service = await buildService({});

    expect(service.rpId).toBe('localhost');
    expect(service.origin).toBe('http://localhost:3002');
  });

  it('fails fast with an actionable message when FRONTEND_URL is malformed', async () => {
    await expect(buildService({ FRONTEND_URL: 'opencoop.be' })).rejects.toThrow(/FRONTEND_URL/);
  });

  it('uses WEBAUTHN_RP_NAME for the display name only', async () => {
    const service = await buildService({
      FRONTEND_URL: 'https://opencoop.be',
      WEBAUTHN_RP_NAME: 'OpenCoop BV',
    });

    expect(service.rpName).toBe('OpenCoop BV');
    expect(service.rpId).toBe('opencoop.be');
  });
});
