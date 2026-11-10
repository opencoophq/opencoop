import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { SenderDomainService } from './sender-domain.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const API_KEY = 'platform-brevo-test-key-991';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'coop-1',
    name: 'Bronsgroen',
    coopEmail: 'info@bronsgroen.be',
    senderDomain: null,
    senderFromAddress: null,
    senderFromName: null,
    senderDomainStatus: null,
    senderDomainCheckedAt: null,
    senderDomainRecords: null,
    senderDomainError: null,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

const dns = {
  brevo_code: { type: 'TXT', host_name: '@', value: 'brevo-code:abc', status: false },
  dkim1Record: {
    type: 'CNAME',
    host_name: 'brevo1._domainkey',
    value: 'b1.bronsgroen-be.dkim.brevo.com',
    status: false,
  },
  dkim2Record: {
    type: 'CNAME',
    host_name: 'brevo2._domainkey',
    value: 'b2.bronsgroen-be.dkim.brevo.com',
    status: false,
  },
};

describe('SenderDomainService', () => {
  let service: SenderDomainService;
  const prisma = {
    coop: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const fetchMock = jest.fn();
  const previousFetch = global.fetch;
  const previousKey = process.env.BREVO_API_KEY;

  beforeEach(async () => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    process.env.BREVO_API_KEY = API_KEY;
    global.fetch = fetchMock as unknown as typeof fetch;
    prisma.coop.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      row({
        ...data,
        senderDomainRecords:
          data.senderDomainRecords === Prisma.DbNull ? null : data.senderDomainRecords,
      }),
    );

    const module = await Test.createTestingModule({
      providers: [
        SenderDomainService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = module.get(SenderDomainService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = previousKey;
  });

  it('stores a pending domain and the DNS records Brevo returned', async () => {
    prisma.coop.findUnique.mockResolvedValue(row());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { domain_name: 'bronsgroen.be', dns_records: dns }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          domain: 'bronsgroen.be',
          verified: false,
          authenticated: false,
          dns_records: dns,
        }),
      );

    const view = await service.register('coop-1', {
      domain: 'Bronsgroen.be',
      fromAddress: 'noreply@bronsgroen.be',
      fromName: 'Bronsgroen',
    });

    expect(view.senderDomain).toBe('bronsgroen.be');
    expect(view.senderFromAddress).toBe('noreply@bronsgroen.be');
    expect(view.senderDomainStatus).toBe('pending');
    expect(view.senderDomainRecords.map((record) => record.key)).toEqual([
      'brevo-code',
      'dkim',
      'dkim',
      'spf',
      'dmarc',
    ]);
    expect(prisma.coop.update.mock.calls[0][0].data.senderDomainStatus).toBe('pending');
    expect(JSON.stringify(prisma.coop.update.mock.calls)).not.toContain(API_KEY);
  });

  it('stores verified immediately when Brevo already authenticated the domain', async () => {
    prisma.coop.findUnique.mockResolvedValue(row());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(400, { message: 'Domain already exists' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          domain: 'bronsgroen.be',
          verified: true,
          authenticated: true,
          dns_records: dns,
        }),
      );

    const view = await service.register('coop-1', {
      domain: 'bronsgroen.be',
      fromAddress: 'noreply@bronsgroen.be',
    });

    expect(view.senderDomainStatus).toBe('verified');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a from-address on another domain before calling Brevo', async () => {
    prisma.coop.findUnique.mockResolvedValue(row());

    await expect(
      service.register('coop-1', { domain: 'bronsgroen.be', fromAddress: 'noreply@other.be' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses the platform domain', async () => {
    prisma.coop.findUnique.mockResolvedValue(row());
    await expect(
      service.register('coop-1', { domain: 'opencoop.be', fromAddress: 'noreply@opencoop.be' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call Brevo when the API key is missing', async () => {
    delete process.env.BREVO_API_KEY;
    prisma.coop.findUnique.mockResolvedValue(row());
    await expect(
      service.register('coop-1', { domain: 'bronsgroen.be', fromAddress: 'noreply@bronsgroen.be' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks the domain verified when Brevo reports both flags', async () => {
    prisma.coop.findUnique.mockResolvedValue(
      row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'pending' }),
    );
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { message: 'authenticated' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          domain: 'bronsgroen.be',
          verified: true,
          authenticated: true,
          dns_records: dns,
        }),
      );

    const view = await service.check('coop-1');
    expect(view.senderDomainStatus).toBe('verified');
    expect(view.senderDomainError).toBeNull();
  });

  it('marks the domain failed when the DNS check is not ready', async () => {
    prisma.coop.findUnique.mockResolvedValue(
      row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'pending' }),
    );
    fetchMock
      .mockResolvedValueOnce(jsonResponse(400, { message: 'mismatch' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          domain: 'bronsgroen.be',
          verified: true,
          authenticated: false,
          dns_records: dns,
        }),
      );

    const view = await service.check('coop-1');
    expect(view.senderDomainStatus).toBe('failed');
    expect(view.senderDomainError).toBe('DNS_NOT_READY');
  });

  it('keeps a verified domain when Brevo is unreachable and does not log the key', async () => {
    prisma.coop.findUnique.mockResolvedValue(
      row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'verified' }),
    );
    fetchMock.mockResolvedValue(jsonResponse(500, `upstream ${API_KEY}`));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const view = await service.check('coop-1');

    expect(view.senderDomainStatus).toBe('verified');
    expect(view.senderDomainError).toBe('PROVIDER_ERROR');
    expect(warn.mock.calls.flat().join(' ')).not.toContain(API_KEY);
  });

  it('clears the local sender domain without calling Brevo', async () => {
    prisma.coop.findUnique.mockResolvedValue(
      row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'verified' }),
    );

    const view = await service.clear('coop-1');

    expect(view.senderDomain).toBeNull();
    expect(view.senderDomainStatus).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.coop.update.mock.calls[0][0].data.senderDomainRecords).toBe(Prisma.DbNull);
  });

  it('demotes a verified domain on recheck only when Brevo says it is no longer authenticated', async () => {
    prisma.coop.findMany.mockResolvedValue([{ id: 'coop-1' }]);
    prisma.coop.findUnique.mockResolvedValue(
      row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'verified' }),
    );
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        domain: 'bronsgroen.be',
        verified: false,
        authenticated: false,
        dns_records: dns,
      }),
    );

    await service.recheckAll();

    expect(prisma.coop.update.mock.calls[0][0].data.senderDomainStatus).toBe('failed');
  });

  it('leaves a pending domain pending when the nightly read is not ready yet', async () => {
    prisma.coop.findUnique.mockResolvedValue(
      row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'pending' }),
    );
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        domain: 'bronsgroen.be',
        verified: false,
        authenticated: false,
        dns_records: dns,
      }),
    );

    await service.recheckOne('coop-1');

    expect(prisma.coop.update.mock.calls[0][0].data.senderDomainStatus).toBe('pending');
  });

  it('does not demote a verified domain when the nightly read fails', async () => {
    prisma.coop.findUnique.mockResolvedValue(
      row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'verified' }),
    );
    fetchMock.mockRejectedValue(new Error(`socket hang up ${API_KEY}`));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await service.recheckOne('coop-1');

    expect(prisma.coop.update.mock.calls[0][0].data.senderDomainStatus).toBe('verified');
    expect(prisma.coop.update.mock.calls[0][0].data.senderDomainError).toBe('PROVIDER_ERROR');
    expect(warn.mock.calls.flat().join(' ')).not.toContain(API_KEY);
  });
});
