import {
  BadRequestException,
  ConflictException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { SenderDomainService } from './sender-domain.service';
import { SenderDomainProofChecker, proofValue, type ProofResult } from './sender-domain-proof';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const API_KEY = 'platform-brevo-test-key-991';
const PROVEN = new Date('2026-11-09T10:00:00Z');

type Row = Record<string, unknown>;

function row(overrides: Row = {}): Row {
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
    senderDomainProofToken: null,
    senderDomainProofAt: null,
    senderDomainRevision: 0,
    ...overrides,
  };
}

/** A coop that registered bronsgroen.be and already proved DNS control. */
function proven(overrides: Row = {}): Row {
  return row({
    senderDomain: 'bronsgroen.be',
    senderFromAddress: 'noreply@bronsgroen.be',
    senderDomainStatus: 'verified',
    senderDomainProofToken: 'tok-coop-1',
    senderDomainProofAt: PROVEN,
    ...overrides,
  });
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

const ready = (domain = 'bronsgroen.be') =>
  jsonResponse(200, { domain, verified: true, authenticated: true, dns_records: dns });
const notReady = (domain = 'bronsgroen.be') =>
  jsonResponse(200, { domain, verified: false, authenticated: false, dns_records: dns });

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A promise-shaped fetch response the test releases by hand. */
function deferredResponse() {
  let release!: (res: Response) => void;
  const promise = new Promise<Response>((resolve) => (release = resolve));
  return { promise, release };
}

describe('SenderDomainService', () => {
  let service: SenderDomainService;
  // Small in-memory coops table so revision-guarded writes behave like the database.
  let table: Record<string, Row>;
  const writes: Row[] = [];
  let proofResult: ProofResult;
  const proofCheck = jest.fn(async () => proofResult);

  const apply = (id: string, data: Row) => {
    const next: Row = { ...table[id] };
    for (const [key, value] of Object.entries(data)) {
      if (key === 'senderDomainRevision') {
        next[key] = Number(next[key] ?? 0) + (value as { increment: number }).increment;
      } else if (value === Prisma.DbNull) {
        next[key] = null;
      } else if (value !== undefined) {
        next[key] = value;
      }
    }
    table[id] = next;
  };
  const seed = (coop: Row) => {
    table[coop.id as string] = coop;
  };
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
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        writes.push(data);
        apply(where.id, data);
        return table[where.id];
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; senderDomainRevision: number };
          data: Row;
        }) => {
          const current = table[where.id];
          if (!current || Number(current.senderDomainRevision) !== where.senderDomainRevision) {
            return { count: 0 };
          }
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
    proofResult = 'absent';
    fetchMock.mockReset();
    process.env.BREVO_API_KEY = API_KEY;
    global.fetch = fetchMock as unknown as typeof fetch;

    const module = await Test.createTestingModule({
      providers: [
        SenderDomainService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: SenderDomainProofChecker, useValue: { check: proofCheck } },
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

  describe('register', () => {
    it('stores a pending domain, a fresh proof token and the DNS records Brevo returned', async () => {
      seed(row());
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(201, { domain_name: 'bronsgroen.be', dns_records: dns }),
        )
        .mockResolvedValueOnce(notReady());

      const view = await service.register('coop-1', {
        domain: 'Bronsgroen.be',
        fromAddress: 'noreply@bronsgroen.be',
        fromName: 'Bronsgroen',
      });

      expect(view.senderDomain).toBe('bronsgroen.be');
      expect(view.senderDomainStatus).toBe('pending');
      expect(view.senderDomainRecords.map((record) => record.key)).toEqual([
        'proof',
        'brevo-code',
        'dkim',
        'dkim',
        'spf',
        'dmarc',
      ]);
      const token = table['coop-1'].senderDomainProofToken as string;
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      expect(view.senderDomainRecords[0]).toEqual(
        expect.objectContaining({
          type: 'TXT',
          host: '_opencoop-challenge',
          value: proofValue(token),
          status: null,
        }),
      );
      expect(table['coop-1'].senderDomainProofAt).toBeNull();
      expect(JSON.stringify(writes)).not.toContain(API_KEY);
    });

    it('does NOT mark a domain verified when Brevo already authenticated it for someone else', async () => {
      // Pre-existing platform domain (for example another tenant of the shared account).
      seed(row());
      fetchMock
        .mockResolvedValueOnce(jsonResponse(400, { message: 'Domain already exists' }))
        .mockResolvedValueOnce(ready());

      const view = await service.register('coop-1', {
        domain: 'bronsgroen.be',
        fromAddress: 'noreply@bronsgroen.be',
      });

      expect(view.senderDomainStatus).toBe('pending');
      expect(table['coop-1'].senderDomainProofAt).toBeNull();
      expect(proofCheck).not.toHaveBeenCalled();
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
      ).rejects.toMatchObject({ message: 'SENDER_DOMAIN_PLATFORM' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not call Brevo when the API key is missing', async () => {
      seed(row());
      delete process.env.BREVO_API_KEY;
      await expect(
        service.register('coop-1', {
          domain: 'bronsgroen.be',
          fromAddress: 'noreply@bronsgroen.be',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('proof ownership', () => {
    it('refuses a domain another coop holds, before calling Brevo', async () => {
      seed(row());
      seed(proven({ id: 'coop-2' }));

      await expect(
        service.register('coop-1', {
          domain: 'bronsgroen.be',
          fromAddress: 'noreply@bronsgroen.be',
        }),
      ).rejects.toMatchObject({ message: 'SENDER_DOMAIN_CLAIMED' });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(table['coop-1'].senderDomain).toBeNull();
    });

    it('turns a database unique violation into a claim conflict', async () => {
      seed(row());
      fetchMock
        .mockResolvedValueOnce(jsonResponse(201, { dns_records: dns }))
        .mockResolvedValueOnce(ready());
      prisma.coop.updateMany.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
      );
      await expect(
        service.register('coop-1', {
          domain: 'bronsgroen.be',
          fromAddress: 'noreply@bronsgroen.be',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('a manual check stays failed while Brevo is ready but the coop token is not in DNS', async () => {
      seed(proven({ senderDomainStatus: 'pending', senderDomainProofAt: null }));
      proofResult = 'absent';
      fetchMock.mockResolvedValueOnce(jsonResponse(200, {})).mockResolvedValueOnce(ready());

      const view = await service.check('coop-1');

      expect(view.senderDomainStatus).toBe('failed');
      expect(view.senderDomainError).toBe('PROOF_MISSING');
      expect(table['coop-1'].senderDomainProofAt).toBeNull();
    });

    it('a manual check verifies only when Brevo is ready AND the token is in DNS', async () => {
      seed(proven({ senderDomainStatus: 'pending', senderDomainProofAt: null }));
      proofResult = 'ok';
      fetchMock.mockResolvedValueOnce(jsonResponse(200, {})).mockResolvedValueOnce(ready());

      const view = await service.check('coop-1');

      expect(view.senderDomainStatus).toBe('verified');
      expect(view.senderDomainError).toBeNull();
      expect(table['coop-1'].senderDomainProofAt).toBeInstanceOf(Date);
      expect(view.senderDomainRecords[0]).toEqual(
        expect.objectContaining({ key: 'proof', status: true }),
      );
    });

    it('stays failed when the proof is in DNS but Brevo is not ready', async () => {
      seed(proven({ senderDomainStatus: 'pending', senderDomainProofAt: null }));
      proofResult = 'ok';
      fetchMock.mockResolvedValueOnce(jsonResponse(400, {})).mockResolvedValueOnce(notReady());

      const view = await service.check('coop-1');

      expect(view.senderDomainStatus).toBe('failed');
      expect(view.senderDomainError).toBe('DNS_NOT_READY');
    });

    it('the same coop keeps token and proof when it registers its own domain again', async () => {
      seed(proven());
      fetchMock
        .mockResolvedValueOnce(jsonResponse(400, { message: 'Domain already exists' }))
        .mockResolvedValueOnce(ready());

      const view = await service.register('coop-1', {
        domain: 'bronsgroen.be',
        fromAddress: 'info@bronsgroen.be',
      });

      expect(view.senderFromAddress).toBe('info@bronsgroen.be');
      expect(view.senderDomainStatus).toBe('verified');
      expect(table['coop-1'].senderDomainProofToken).toBe('tok-coop-1');
      expect(table['coop-1'].senderDomainProofAt).toEqual(PROVEN);
    });

    it('a new domain on a proven coop starts with a fresh token and no proof', async () => {
      seed(proven());
      fetchMock
        .mockResolvedValueOnce(jsonResponse(201, { dns_records: dns }))
        .mockResolvedValueOnce(ready('other.be'));

      const view = await service.register('coop-1', {
        domain: 'other.be',
        fromAddress: 'noreply@other.be',
      });

      expect(view.senderDomainStatus).toBe('pending');
      expect(table['coop-1'].senderDomainProofToken).not.toBe('tok-coop-1');
      expect(table['coop-1'].senderDomainProofAt).toBeNull();
    });

    it('clearing drops the token and proof, so a reclaim needs fresh proof', async () => {
      seed(proven());
      await service.clear('coop-1');
      expect(table['coop-1']).toEqual(
        expect.objectContaining({
          senderDomain: null,
          senderDomainStatus: null,
          senderDomainProofToken: null,
          senderDomainProofAt: null,
        }),
      );

      // Another coop now claims the same domain; Brevo still says ready.
      seed(row({ id: 'coop-2' }));
      fetchMock
        .mockResolvedValueOnce(jsonResponse(400, { message: 'already exists' }))
        .mockResolvedValueOnce(ready());
      const view = await service.register('coop-2', {
        domain: 'bronsgroen.be',
        fromAddress: 'noreply@bronsgroen.be',
      });
      expect(view.senderDomainStatus).toBe('pending');
      expect(table['coop-2'].senderDomainProofToken).not.toBe('tok-coop-1');

      // The old owner reclaims: also pending, with a brand new token, not the old proof.
      await service.clear('coop-2');
      seed({ ...(table['coop-1'] as Row) });
      fetchMock
        .mockResolvedValueOnce(jsonResponse(400, { message: 'already exists' }))
        .mockResolvedValueOnce(ready());
      const again = await service.register('coop-1', {
        domain: 'bronsgroen.be',
        fromAddress: 'noreply@bronsgroen.be',
      });
      expect(again.senderDomainStatus).toBe('pending');
      expect(table['coop-1'].senderDomainProofToken).not.toBe('tok-coop-1');
      expect(table['coop-1'].senderDomainProofAt).toBeNull();
    });

    it('does not call Brevo when clearing', async () => {
      seed(proven());
      const view = await service.clear('coop-1');
      expect(view.senderDomain).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(lastWrite().senderDomainRecords).toBe(Prisma.DbNull);
    });
  });

  describe('check and nightly', () => {
    it('keeps a verified domain when Brevo is unreachable and does not log the key', async () => {
      seed(proven());
      proofResult = 'ok';
      fetchMock.mockResolvedValue(jsonResponse(500, `upstream ${API_KEY}`));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const view = await service.check('coop-1');

      expect(view.senderDomainStatus).toBe('verified');
      expect(view.senderDomainError).toBe('PROVIDER_ERROR');
      expect(warn.mock.calls.flat().join(' ')).not.toContain(API_KEY);
    });

    it('demotes a verified domain on recheck when Brevo says it is no longer authenticated', async () => {
      seed(proven());
      proofResult = 'ok';
      fetchMock.mockResolvedValue(notReady());
      await service.recheckAll();
      expect(lastWrite().senderDomainStatus).toBe('failed');
      expect(lastWrite().senderDomainError).toBe('DNS_NOT_READY');
    });

    it('demotes a verified domain on recheck when the DNS proof is gone', async () => {
      seed(proven());
      proofResult = 'absent';
      fetchMock.mockResolvedValue(ready());
      await service.recheckAll();
      expect(table['coop-1'].senderDomainStatus).toBe('failed');
      expect(table['coop-1'].senderDomainProofAt).toBeNull();
      expect(table['coop-1'].senderDomainError).toBe('PROOF_MISSING');
    });

    it('keeps a verified domain when only the proof DNS lookup fails', async () => {
      seed(proven());
      proofResult = 'error';
      fetchMock.mockResolvedValue(ready());
      await service.recheckAll();
      expect(table['coop-1'].senderDomainStatus).toBe('verified');
      expect(table['coop-1'].senderDomainProofAt).toEqual(PROVEN);
    });

    it('keeps a verified domain when proof DNS and Brevo both fail', async () => {
      seed(proven());
      proofResult = 'error';
      fetchMock.mockRejectedValue(new Error(`socket hang up ${API_KEY}`));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      await service.recheckOne('coop-1');
      expect(table['coop-1'].senderDomainStatus).toBe('verified');
      expect(table['coop-1'].senderDomainError).toBe('PROVIDER_ERROR');
      expect(warn.mock.calls.flat().join(' ')).not.toContain(API_KEY);
    });

    it('nightly never promotes a pending domain without proof, even when Brevo is ready', async () => {
      seed(proven({ senderDomainStatus: 'pending', senderDomainProofAt: null }));
      proofResult = 'absent';
      fetchMock.mockResolvedValue(ready());
      await service.recheckOne('coop-1');
      expect(table['coop-1'].senderDomainStatus).toBe('pending');
      expect(table['coop-1'].senderDomainProofAt).toBeNull();
    });

    it('nightly promotes a pending domain when proof and Brevo both pass', async () => {
      seed(proven({ senderDomainStatus: 'pending', senderDomainProofAt: null }));
      proofResult = 'ok';
      fetchMock.mockResolvedValue(ready());
      await service.recheckOne('coop-1');
      expect(table['coop-1'].senderDomainStatus).toBe('verified');
    });

    it('runs DNS-only without an API key and demotes on lost proof', async () => {
      seed(proven());
      delete process.env.BREVO_API_KEY;
      proofResult = 'absent';
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      await service.recheckAll();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(table['coop-1'].senderDomainStatus).toBe('failed');
      expect(warn).toHaveBeenCalled();
    });

    it('missing API key with proof intact leaves a verified domain verified', async () => {
      seed(proven());
      delete process.env.BREVO_API_KEY;
      proofResult = 'ok';
      await service.recheckAll();
      expect(table['coop-1'].senderDomainStatus).toBe('verified');
    });
  });

  describe('stale results and revisions', () => {
    it('ignores a slow check that finishes after the domain was replaced', async () => {
      seed(
        proven({
          senderDomain: 'old.be',
          senderFromAddress: 'a@old.be',
          senderDomainStatus: 'pending',
          senderDomainProofAt: null,
        }),
      );
      proofResult = 'ok';
      const slow = deferredResponse();
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, {}))
        .mockImplementationOnce(() => slow.promise);

      const pending = service.check('coop-1');
      await tick();
      // The admin swaps the domain while Brevo is still answering for old.be.
      await service.clear('coop-1');
      table['coop-1'] = {
        ...table['coop-1'],
        senderDomain: 'new.be',
        senderDomainStatus: 'pending',
        senderDomainRevision: Number(table['coop-1'].senderDomainRevision) + 1,
      };
      slow.release(ready('old.be'));
      const view = await pending;

      expect(view.senderDomain).toBe('new.be');
      expect(view.senderDomainStatus).toBe('pending');
    });

    it('ABA: a slow check cannot land after old.be -> new.be -> old.be', async () => {
      seed(
        proven({
          senderDomain: 'old.be',
          senderFromAddress: 'a@old.be',
          senderDomainStatus: 'pending',
          senderDomainProofAt: null,
          senderDomainProofToken: 'tok-old',
        }),
      );
      proofResult = 'ok';
      const slow = deferredResponse();
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, {}))
        .mockImplementationOnce(() => slow.promise);

      const pending = service.check('coop-1');
      await tick();

      // new.be, then old.be again, each through the real service.
      fetchMock
        .mockResolvedValueOnce(jsonResponse(201, { dns_records: dns }))
        .mockResolvedValueOnce(notReady('new.be'));
      await service.register('coop-1', { domain: 'new.be', fromAddress: 'a@new.be' });
      fetchMock
        .mockResolvedValueOnce(jsonResponse(201, { dns_records: dns }))
        .mockResolvedValueOnce(notReady('old.be'));
      await service.register('coop-1', { domain: 'old.be', fromAddress: 'a@old.be' });
      const freshToken = table['coop-1'].senderDomainProofToken;
      const writesBefore = writes.length;

      slow.release(ready('old.be'));
      await pending;

      expect(writes).toHaveLength(writesBefore);
      expect(table['coop-1'].senderDomain).toBe('old.be');
      expect(table['coop-1'].senderDomainStatus).toBe('pending');
      expect(table['coop-1'].senderDomainProofAt).toBeNull();
      expect(table['coop-1'].senderDomainProofToken).toBe(freshToken);
    });

    it('a slow check cannot revive a domain the user cleared', async () => {
      seed(proven({ senderDomainStatus: 'pending', senderDomainProofAt: null }));
      proofResult = 'ok';
      const slow = deferredResponse();
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, {}))
        .mockImplementationOnce(() => slow.promise);

      const pending = service.check('coop-1');
      await tick();
      await service.clear('coop-1');
      slow.release(ready());
      await pending;

      expect(table['coop-1'].senderDomain).toBeNull();
      expect(table['coop-1'].senderDomainStatus).toBeNull();
      expect(table['coop-1'].senderDomainProofAt).toBeNull();
    });

    it('null -> clear -> null: a slow register cannot revive a cleared empty setting', async () => {
      seed(row());
      const slow = deferredResponse();
      fetchMock.mockImplementationOnce(() => slow.promise).mockResolvedValueOnce(ready());

      const pending = service.register('coop-1', {
        domain: 'bronsgroen.be',
        fromAddress: 'noreply@bronsgroen.be',
      });
      await tick();
      await service.clear('coop-1'); // still null, same domain value
      slow.release(jsonResponse(201, { dns_records: dns }));

      await expect(pending).rejects.toMatchObject({ message: 'SENDER_DOMAIN_CHANGED' });
      expect(table['coop-1'].senderDomain).toBeNull();
    });

    it('same-domain round trip: a slow register cannot overwrite a newer register of the same domain', async () => {
      seed(row());
      const slow = deferredResponse();
      fetchMock.mockImplementationOnce(() => slow.promise).mockResolvedValueOnce(notReady());
      const first = service.register('coop-1', {
        domain: 'bronsgroen.be',
        fromAddress: 'old@bronsgroen.be',
      });
      await tick();

      fetchMock
        .mockResolvedValueOnce(jsonResponse(201, { dns_records: dns }))
        .mockResolvedValueOnce(notReady());
      await service.register('coop-1', {
        domain: 'bronsgroen.be',
        fromAddress: 'new@bronsgroen.be',
      });
      slow.release(jsonResponse(201, { dns_records: dns }));

      await expect(first).rejects.toMatchObject({ message: 'SENDER_DOMAIN_CHANGED' });
      expect(table['coop-1'].senderFromAddress).toBe('new@bronsgroen.be');
    });

    it('does not let the nightly recheck verify a replacement domain', async () => {
      seed(
        proven({
          senderDomain: 'old.be',
          senderDomainStatus: 'pending',
          senderDomainProofAt: null,
        }),
      );
      proofResult = 'ok';
      const slow = deferredResponse();
      fetchMock.mockImplementationOnce(() => slow.promise);

      const pending = service.recheckOne('coop-1');
      await tick();
      await service.clear('coop-1');
      table['coop-1'] = {
        ...table['coop-1'],
        senderDomain: 'new.be',
        senderDomainStatus: 'pending',
        senderDomainRevision: Number(table['coop-1'].senderDomainRevision) + 1,
      };
      slow.release(ready('old.be'));
      await pending;

      expect(table['coop-1'].senderDomain).toBe('new.be');
      expect(table['coop-1'].senderDomainStatus).toBe('pending');
    });

    it('refuses a register that was overtaken by another register', async () => {
      seed(row());
      const slow = deferredResponse();
      fetchMock.mockImplementationOnce(() => slow.promise).mockResolvedValueOnce(ready());
      const pending = service.register('coop-1', {
        domain: 'bronsgroen.be',
        fromAddress: 'noreply@bronsgroen.be',
      });
      await tick();
      fetchMock
        .mockResolvedValueOnce(jsonResponse(201, { dns_records: dns }))
        .mockResolvedValueOnce(notReady('other.be'));
      await service.register('coop-1', { domain: 'other.be', fromAddress: 'noreply@other.be' });
      slow.release(jsonResponse(201, { dns_records: dns }));

      await expect(pending).rejects.toMatchObject({ message: 'SENDER_DOMAIN_CHANGED' });
      expect(table['coop-1'].senderDomain).toBe('other.be');
    });
  });
});
