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
  // Small in-memory coops table so guarded writes behave like the database.
  let table: Record<string, Record<string, unknown>>;
  const apply = (id: string, data: Record<string, unknown>) => {
    table[id] = {
      ...table[id],
      ...data,
      senderDomainRecords:
        data.senderDomainRecords === Prisma.DbNull
          ? null
          : (data.senderDomainRecords ?? table[id].senderDomainRecords),
    };
    if ('senderDomainRecords' in data && data.senderDomainRecords === undefined) {
      table[id].senderDomainRecords = null;
    }
  };
  const seed = (coop: Record<string, unknown>) => {
    table[coop.id as string] = coop;
  };
  const writes: Array<Record<string, unknown>> = [];
  const lastWrite = () => writes[writes.length - 1];
  const prisma = {
    coop: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => table[where.id] ?? null),
      findFirst: jest.fn(
        async ({ where }: { where: { senderDomain: string; id: { not: string } } }) =>
          Object.values(table).find(
            (c) => c.senderDomain === where.senderDomain && c.id !== where.id.not,
          ) ?? null,
      ),
      findMany: jest.fn(async () =>
        Object.values(table)
          .filter((c) => c.senderDomain !== null)
          .map((c) => ({ id: c.id })),
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          writes.push(data);
          apply(where.id, data);
          return table[where.id];
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; senderDomain: string | null };
          data: Record<string, unknown>;
        }) => {
          const current = table[where.id];
          if (!current || current.senderDomain !== where.senderDomain) return { count: 0 };
          writes.push(data);
          apply(where.id, data);
          return { count: 1 };
        },
      ),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const fetchMock = jest.fn();
  const previousFetch = global.fetch;
  const previousKey = process.env.BREVO_API_KEY;

  beforeEach(async () => {
    jest.clearAllMocks();
    table = {};
    writes.length = 0;
    fetchMock.mockReset();
    process.env.BREVO_API_KEY = API_KEY;
    global.fetch = fetchMock as unknown as typeof fetch;
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
    seed(row());
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
    expect(lastWrite().senderDomainStatus).toBe('pending');
    expect(JSON.stringify(writes)).not.toContain(API_KEY);
  });

  it('stores verified immediately when Brevo already authenticated the domain', async () => {
    seed(row());
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
    seed(row());

    await expect(
      service.register('coop-1', { domain: 'bronsgroen.be', fromAddress: 'noreply@other.be' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses the platform domain', async () => {
    seed(row());
    await expect(
      service.register('coop-1', { domain: 'opencoop.be', fromAddress: 'noreply@opencoop.be' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call Brevo when the API key is missing', async () => {
    delete process.env.BREVO_API_KEY;
    seed(row());
    await expect(
      service.register('coop-1', { domain: 'bronsgroen.be', fromAddress: 'noreply@bronsgroen.be' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks the domain verified when Brevo reports both flags', async () => {
    seed(row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'pending' }));
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
    seed(row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'pending' }));
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
    seed(row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'verified' }));
    fetchMock.mockResolvedValue(jsonResponse(500, `upstream ${API_KEY}`));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const view = await service.check('coop-1');

    expect(view.senderDomainStatus).toBe('verified');
    expect(view.senderDomainError).toBe('PROVIDER_ERROR');
    expect(warn.mock.calls.flat().join(' ')).not.toContain(API_KEY);
  });

  it('clears the local sender domain without calling Brevo', async () => {
    seed(row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'verified' }));

    const view = await service.clear('coop-1');

    expect(view.senderDomain).toBeNull();
    expect(view.senderDomainStatus).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastWrite().senderDomainRecords).toBe(Prisma.DbNull);
  });

  it('demotes a verified domain on recheck only when Brevo says it is no longer authenticated', async () => {
    seed(row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'verified' }));
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        domain: 'bronsgroen.be',
        verified: false,
        authenticated: false,
        dns_records: dns,
      }),
    );

    await service.recheckAll();

    expect(lastWrite().senderDomainStatus).toBe('failed');
  });

  it('leaves a pending domain pending when the nightly read is not ready yet', async () => {
    seed(row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'pending' }));
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        domain: 'bronsgroen.be',
        verified: false,
        authenticated: false,
        dns_records: dns,
      }),
    );

    await service.recheckOne('coop-1');

    expect(lastWrite().senderDomainStatus).toBe('pending');
  });

  it('does not demote a verified domain when the nightly read fails', async () => {
    seed(row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'verified' }));
    fetchMock.mockRejectedValue(new Error(`socket hang up ${API_KEY}`));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await service.recheckOne('coop-1');

    expect(lastWrite().senderDomainStatus).toBe('verified');
    expect(lastWrite().senderDomainError).toBe('PROVIDER_ERROR');
    expect(warn.mock.calls.flat().join(' ')).not.toContain(API_KEY);
  });

  describe('ownership and races', () => {
    const readyBody = {
      domain: 'bronsgroen.be',
      verified: true,
      authenticated: true,
      dns_records: dns,
    };

    it('refuses a domain another coop already holds, before calling Brevo', async () => {
      seed(row());
      seed(
        row({
          id: 'coop-2',
          senderDomain: 'bronsgroen.be',
          senderFromAddress: 'noreply@bronsgroen.be',
          senderDomainStatus: 'verified',
        }),
      );

      await expect(
        service.register('coop-1', {
          domain: 'bronsgroen.be',
          fromAddress: 'noreply@bronsgroen.be',
        }),
      ).rejects.toMatchObject({ message: 'SENDER_DOMAIN_CLAIMED' });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
      expect(table['coop-1'].senderDomain).toBeNull();
    });

    it('lets the holder register its own domain again', async () => {
      seed(row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'verified' }));
      fetchMock
        .mockResolvedValueOnce(jsonResponse(400, { message: 'Domain already exists' }))
        .mockResolvedValueOnce(jsonResponse(200, readyBody));

      const view = await service.register('coop-1', {
        domain: 'bronsgroen.be',
        fromAddress: 'info@bronsgroen.be',
      });

      expect(view.senderFromAddress).toBe('info@bronsgroen.be');
      expect(view.senderDomainStatus).toBe('verified');
    });

    it('turns a database unique violation into a claim conflict', async () => {
      seed(row());
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(201, { domain_name: 'bronsgroen.be', dns_records: dns }),
        )
        .mockResolvedValueOnce(jsonResponse(200, readyBody));
      prisma.coop.updateMany.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
      );

      await expect(
        service.register('coop-1', { domain: 'bronsgroen.be', fromAddress: 'a@bronsgroen.be' }),
      ).rejects.toMatchObject({ message: 'SENDER_DOMAIN_CLAIMED' });
    });

    it('ignores a slow check that finishes after the domain was replaced', async () => {
      seed(
        row({
          senderDomain: 'old.be',
          senderFromAddress: 'a@old.be',
          senderDomainStatus: 'pending',
        }),
      );
      let release!: (res: Response) => void;
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, {}))
        .mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));

      const pending = service.check('coop-1');
      await new Promise((resolve) => setImmediate(resolve));
      // The admin swaps the domain while Brevo is still answering for old.be.
      table['coop-1'] = row({
        senderDomain: 'new.be',
        senderFromAddress: 'a@new.be',
        senderDomainStatus: 'pending',
      });
      release(
        jsonResponse(200, {
          domain: 'old.be',
          verified: true,
          authenticated: true,
          dns_records: dns,
        }),
      );
      const view = await pending;

      expect(view.senderDomain).toBe('new.be');
      expect(view.senderDomainStatus).toBe('pending');
      expect(table['coop-1'].senderDomainStatus).toBe('pending');
      expect(writes).toHaveLength(0);
    });

    it('does not bring a cleared domain back when a check finishes late', async () => {
      seed(row({ senderDomain: 'bronsgroen.be', senderDomainStatus: 'pending' }));
      let release!: (res: Response) => void;
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, {}))
        .mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));

      const pending = service.check('coop-1');
      await new Promise((resolve) => setImmediate(resolve));
      await service.clear('coop-1');
      release(jsonResponse(200, readyBody));
      await pending;

      expect(table['coop-1'].senderDomain).toBeNull();
      expect(table['coop-1'].senderDomainStatus).toBeNull();
    });

    it('does not let the nightly recheck verify a replacement domain', async () => {
      seed(row({ senderDomain: 'old.be', senderDomainStatus: 'pending' }));
      let release!: (res: Response) => void;
      fetchMock.mockImplementationOnce(
        () => new Promise<Response>((resolve) => (release = resolve)),
      );

      const pending = service.recheckOne('coop-1');
      await new Promise((resolve) => setImmediate(resolve));
      table['coop-1'] = row({ senderDomain: 'new.be', senderDomainStatus: 'pending' });
      release(
        jsonResponse(200, {
          domain: 'old.be',
          verified: true,
          authenticated: true,
          dns_records: dns,
        }),
      );
      await pending;

      expect(table['coop-1'].senderDomain).toBe('new.be');
      expect(table['coop-1'].senderDomainStatus).toBe('pending');
    });

    it('refuses a register that was overtaken by a clear during the Brevo calls', async () => {
      seed(row());
      let release!: (res: Response) => void;
      fetchMock
        .mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)))
        .mockResolvedValueOnce(jsonResponse(200, readyBody));

      const pending = service.register('coop-1', {
        domain: 'bronsgroen.be',
        fromAddress: 'noreply@bronsgroen.be',
      });
      await new Promise((resolve) => setImmediate(resolve));
      // Another request registered a different domain first.
      table['coop-1'] = row({ senderDomain: 'other.be', senderDomainStatus: 'pending' });
      release(jsonResponse(201, { domain_name: 'bronsgroen.be', dns_records: dns }));

      await expect(pending).rejects.toMatchObject({ message: 'SENDER_DOMAIN_CHANGED' });
      expect(table['coop-1'].senderDomain).toBe('other.be');
    });
  });
});
