import { Test } from '@nestjs/testing';
import { RetentionService } from './retention.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('RetentionService.pruneExpiredData', () => {
  let service: RetentionService;
  let prisma: any;

  const makeDeleteMany = () => jest.fn().mockResolvedValue({ count: 0 });

  beforeEach(async () => {
    prisma = {
      refreshToken: { deleteMany: makeDeleteMany() },
      magicLinkToken: { deleteMany: makeDeleteMany() },
      shareholderEmancipationToken: { deleteMany: makeDeleteMany() },
      adminInvitation: { deleteMany: makeDeleteMany() },
      emailLog: { deleteMany: makeDeleteMany() },
      // present-but-must-not-be-touched
      auditLog: { deleteMany: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [RetentionService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(RetentionService);
  });

  it('prunes each expired-token table with expiresAt < now', async () => {
    await service.pruneExpiredData();

    for (const table of [
      'refreshToken',
      'magicLinkToken',
      'shareholderEmancipationToken',
      'adminInvitation',
    ]) {
      expect(prisma[table].deleteMany).toHaveBeenCalledTimes(1);
      const arg = prisma[table].deleteMany.mock.calls[0][0];
      expect(arg.where.expiresAt.lt).toBeInstanceOf(Date);
    }
  });

  it('prunes email logs older than ~180 days by default', async () => {
    delete process.env.EMAIL_LOG_RETENTION_DAYS;
    const before = Date.now();
    await service.pruneExpiredData();
    const after = Date.now();

    expect(prisma.emailLog.deleteMany).toHaveBeenCalledTimes(1);
    const arg = prisma.emailLog.deleteMany.mock.calls[0][0];
    const cutoff: Date = arg.where.createdAt.lt;
    expect(cutoff).toBeInstanceOf(Date);

    const windowMs = 180 * 24 * 60 * 60 * 1000;
    // cutoff should sit ~180 days before "now" (bounded by the call window)
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - windowMs - 1000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - windowMs + 1000);
  });

  it('honours EMAIL_LOG_RETENTION_DAYS override', async () => {
    process.env.EMAIL_LOG_RETENTION_DAYS = '30';
    const before = Date.now();
    await service.pruneExpiredData();
    delete process.env.EMAIL_LOG_RETENTION_DAYS;

    const cutoff: Date = prisma.emailLog.deleteMany.mock.calls[0][0].where.createdAt.lt;
    const windowMs = 30 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - windowMs - 2000);
  });

  it('never deletes from auditLog', async () => {
    await service.pruneExpiredData();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('continues pruning other tables when one deleteMany throws', async () => {
    prisma.refreshToken.deleteMany.mockRejectedValueOnce(new Error('boom'));
    await service.pruneExpiredData();
    // a later table still ran despite the earlier failure
    expect(prisma.emailLog.deleteMany).toHaveBeenCalledTimes(1);
  });
});
