import { CoopAdminsService } from './coop-admins.service';

function build() {
  const prisma = {
    coop: { findUnique: jest.fn().mockResolvedValue({ id: 'coop-1', name: 'Coop' }) },
    coopRole: {
      findMany: jest.fn().mockResolvedValue([{ id: 'role-1', name: 'Admin' }]),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    coopAdmin: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    adminInvitation: {
      findUnique: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 'inv-new' }),
    },
  };
  const emailService = { sendPlatformEmail: jest.fn().mockResolvedValue(undefined) };
  const service = new CoopAdminsService(prisma as any, emailService as any);
  return { service, prisma };
}

describe('CoopAdminsService.removeAdmin', () => {
  function withAdmins(prisma: ReturnType<typeof build>['prisma']) {
    const manager = { roles: [{ role: { permissions: { canManageAdmins: true } } }] };
    prisma.coopAdmin.findFirst.mockResolvedValue({ id: 'ca-1', userId: 'user-1', ...manager });
    prisma.coopAdmin.findMany.mockResolvedValue([manager, manager]);
  }

  it('only demotes a user whose role is COOP_ADMIN, never a SYSTEM_ADMIN', async () => {
    const { service, prisma } = build();
    withAdmins(prisma);

    await service.removeAdmin('coop-1', 'ca-1');

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', role: 'COOP_ADMIN' },
      data: { role: 'SHAREHOLDER' },
    });
  });

  it('does not demote while the user still admins another coop', async () => {
    const { service, prisma } = build();
    withAdmins(prisma);
    prisma.coopAdmin.count.mockResolvedValue(1);

    await service.removeAdmin('coop-1', 'ca-1');

    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
