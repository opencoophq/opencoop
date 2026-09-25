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

describe('CoopPermissionsService.has', () => {
  let service: CoopPermissionsService;
  const prisma = { user: { findUnique: jest.fn() } };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CoopPermissionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CoopPermissionsService);
    jest.clearAllMocks();
  });

  it('is true for a system admin without looking at coop roles', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'SYSTEM_ADMIN', coopAdminOf: [] });
    expect(await service.has('u1', 'c1', 'canManageMessages')).toBe(true);
  });

  it('returns all merged permissions from one database lookup', async () => {
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

    expect(await service.permissions('u1', 'c1')).toEqual({
      canManageMessages: true,
      canViewReports: true,
      canViewPII: false,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('is false when the user is not an admin of the coop', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'COOP_ADMIN', coopAdminOf: [] });
    expect(await service.has('u1', 'c1', 'canManageMessages')).toBe(false);
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
