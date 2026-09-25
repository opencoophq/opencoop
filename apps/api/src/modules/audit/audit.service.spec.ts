import { AuditService } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuditService.findByCoop', () => {
  const prisma = {
    auditLog: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const service = new AuditService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns Prisma JSON change rows as field, oldValue, and newValue objects', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'audit-1',
        changes: [
          {
            field: 'email',
            oldValue: null,
            newValue: { primary: 'ada@example.com' },
          },
        ],
      },
    ]);
    prisma.auditLog.count.mockResolvedValue(1);

    const result = await service.findByCoop('coop-1');

    expect(result.items[0].changes).toEqual([
      {
        field: 'email',
        oldValue: null,
        newValue: { primary: 'ada@example.com' },
      },
    ]);
    expect(result).toMatchObject({ total: 1, page: 1, limit: 50, totalPages: 1 });
  });
});
