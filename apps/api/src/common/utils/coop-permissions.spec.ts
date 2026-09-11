import { Test } from '@nestjs/testing';
import { CoopPermissionsService, mergeAdminPermissions } from './coop-permissions';
import { PrismaService } from '../../prisma/prisma.service';

describe('mergeAdminPermissions', () => {
  it('ORs roles and lets overrides win', () => {
    expect(mergeAdminPermissions([{ canManageMessages: false }, { canManageMessages: true }], { canViewPII: false })).toEqual({
      canManageMessages: true,
      canViewPII: false,
    });
    expect(mergeAdminPermissions([{ canManageMessages: true }], { canManageMessages: false })).toEqual({ canManageMessages: false });
  });
});

describe('CoopPermissionsService.has', () => {
  let service: CoopPermissionsService;
  const prisma = { user: { findUnique: jest.fn() }, coopAdmin: { findFirst: jest.fn() } };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CoopPermissionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CoopPermissionsService);
    jest.clearAllMocks();
  });

  it('is true for a system admin without looking at coop roles', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'SYSTEM_ADMIN' });
    expect(await service.has('u1', 'c1', 'canManageMessages')).toBe(true);
    expect(prisma.coopAdmin.findFirst).not.toHaveBeenCalled();
  });

  it('merges the roles of the coop admin row', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
    prisma.coopAdmin.findFirst.mockResolvedValue({
      permissionOverrides: null,
      roles: [{ role: { permissions: { canManageMessages: true } } }],
    });
    expect(await service.has('u1', 'c1', 'canManageMessages')).toBe(true);
    expect(prisma.coopAdmin.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', coopId: 'c1' },
      include: { roles: { include: { role: true } } },
    });
  });

  it('is false when the user is not an admin of the coop', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
    prisma.coopAdmin.findFirst.mockResolvedValue(null);
    expect(await service.has('u1', 'c1', 'canManageMessages')).toBe(false);
  });
});
