import { ForbiddenException } from '@nestjs/common';
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
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const authEmail = {
    sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    sendLoginEmailChangeNotice: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CoopAdminsService(
    prisma as any,
    emailService as any,
    audit as any,
    authEmail as any,
  );
  return { service, prisma, authEmail };
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

describe('CoopAdminsService.inviteAdmin', () => {
  it('replaces an old invitation that was already accepted', async () => {
    const { service, prisma } = build();
    prisma.adminInvitation.findUnique.mockResolvedValue({ id: 'inv-old', accepted: true });

    await service.inviteAdmin('coop-1', { email: 'Ex@Admin.com', roleIds: ['role-1'] } as any);

    expect(prisma.adminInvitation.delete).toHaveBeenCalledWith({ where: { id: 'inv-old' } });
    expect(prisma.adminInvitation.create).toHaveBeenCalledTimes(1);
  });

  it('replaces an old pending invitation', async () => {
    const { service, prisma } = build();
    prisma.adminInvitation.findUnique.mockResolvedValue({ id: 'inv-old', accepted: false });

    await service.inviteAdmin('coop-1', { email: 'ex@admin.com', roleIds: ['role-1'] } as any);

    expect(prisma.adminInvitation.delete).toHaveBeenCalledWith({ where: { id: 'inv-old' } });
  });
});

describe('CoopAdminsService.updateAdminUser', () => {
  it('refuses a coop admin changing a system admin login email', async () => {
    const { service, prisma } = build();
    prisma.coopAdmin.findFirst.mockResolvedValue({
      id: 'ca-1',
      user: { id: 'u-sys', email: 'root@opencoop.be', role: 'SYSTEM_ADMIN' },
    });

    await expect(
      service.updateAdminUser(
        'coop-1',
        'ca-1',
        { email: 'attacker@example.com' },
        { id: 'u-coop', role: 'COOP_ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('lets a system admin request a system admin login email change, pending proof', async () => {
    const { service, prisma, authEmail } = build();
    prisma.coopAdmin.findFirst.mockResolvedValue({
      id: 'ca-1',
      user: {
        id: 'u-sys',
        email: 'root@opencoop.be',
        role: 'SYSTEM_ADMIN',
        preferredLanguage: 'nl',
      },
    });
    prisma.user.update.mockResolvedValue({
      id: 'u-sys',
      email: 'root@opencoop.be',
      pendingEmail: 'new@example.com',
      preferredLanguage: 'nl',
    });

    await service.updateAdminUser(
      'coop-1',
      'ca-1',
      { email: 'new@example.com' },
      { id: 'u-root', role: 'SYSTEM_ADMIN' },
    );

    // The login email itself changes only after the new address verifies.
    const { data } = prisma.user.update.mock.calls[0][0];
    expect(data).toMatchObject({ pendingEmail: 'new@example.com' });
    expect(data).not.toHaveProperty('email');
    expect(authEmail.sendVerificationEmail).toHaveBeenCalledWith(
      'new@example.com',
      expect.any(String),
      'nl',
    );
  });

  it('refuses a coop admin changing another coop admin login email', async () => {
    const { service, prisma } = build();
    prisma.coopAdmin.findFirst.mockResolvedValue({
      id: 'ca-2',
      user: { id: 'u-2', email: 'peer@coop.be', role: 'COOP_ADMIN' },
    });

    await expect(
      service.updateAdminUser(
        'coop-1',
        'ca-2',
        { email: 'fixed@coop.be' },
        { id: 'u-coop', role: 'COOP_ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
