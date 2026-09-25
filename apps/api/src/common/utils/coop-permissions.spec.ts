import { Test } from '@nestjs/testing';
import {
  CoopPermissionsService,
  isPermitted,
  LEGACY_DEFAULT_TRUE,
  mergeAdminPermissions,
} from './coop-permissions';
import { PrismaService } from '../../prisma/prisma.service';

describe('mergeAdminPermissions', () => {
  it('ORs roles and lets overrides win', () => {
    expect(
      mergeAdminPermissions([{ canManageMessages: false }, { canManageMessages: true }], {
        canViewPII: false,
      }),
    ).toEqual({
      canManageMessages: true,
      canViewPII: false,
    });
    expect(
      mergeAdminPermissions([{ canManageMessages: true }], { canManageMessages: false }),
    ).toEqual({ canManageMessages: false });
  });
});

describe('CoopPermissionsService.permissionsWithRole', () => {
  let service: CoopPermissionsService;
  const prisma = { user: { findUnique: jest.fn() } };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CoopPermissionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CoopPermissionsService);
    jest.clearAllMocks();
  });

  it('returns default permissions and the role for a system admin', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'SYSTEM_ADMIN', coopAdminOf: [] });

    await expect(service.permissionsWithRole('u1', 'c1')).resolves.toMatchObject({
      permissions: { canManageMessages: true },
      role: 'SYSTEM_ADMIN',
    });
  });

  it('returns merged permissions and the role from one database lookup', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'COOP_ADMIN',
      coopAdminOf: [
        {
          permissionOverrides: { canViewPII: false },
          roles: [
            { role: { permissions: { canManageMessages: true } } },
            { role: { permissions: { canViewReports: true } } },
          ],
        },
      ],
    });

    await expect(service.permissionsWithRole('u1', 'c1')).resolves.toEqual({
      permissions: {
        canManageMessages: true,
        canViewReports: true,
        canViewPII: false,
      },
      role: 'COOP_ADMIN',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('returns no permissions when the user is not an admin of the coop', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'COOP_ADMIN', coopAdminOf: [] });

    await expect(service.permissionsWithRole('u1', 'c1')).resolves.toEqual({
      permissions: {},
      role: 'COOP_ADMIN',
    });
  });
});

describe('isPermitted', () => {
  it('uses the legacy default only for missing permissions and still denies false', () => {
    expect(LEGACY_DEFAULT_TRUE.has('canManageMeetings')).toBe(true);
    expect(isPermitted({}, 'canManageMeetings')).toBe(true);
    expect(isPermitted({ canManageMeetings: false }, 'canManageMeetings')).toBe(false);
    expect(isPermitted({}, 'canViewReports')).toBe(false);
    expect(isPermitted({ canViewReports: true }, 'canViewReports')).toBe(true);
  });
});
