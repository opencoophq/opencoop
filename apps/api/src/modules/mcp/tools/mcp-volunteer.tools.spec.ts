jest.mock('../../coops/coops.service', () => ({
  CoopsService: class CoopsService {},
}));

import { Test } from '@nestjs/testing';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { VolunteersService } from '../../volunteers/volunteers.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import {
  McpVolunteerTools,
  listVolunteersParameters,
  updateVolunteerInterestsParameters,
  updateVolunteerParameters,
} from './mcp-volunteer.tools';

describe('McpVolunteerTools', () => {
  let tools: McpVolunteerTools;
  let scope: 'READ_ONLY' | 'READ_WRITE' = 'READ_WRITE';
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'k1',
    getScope: () => scope,
  };
  const permissions = { permissions: jest.fn(), permissionsWithRole: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const volunteers = {
    adminList: jest.fn(),
    adminGet: jest.fn(),
    adminInterestOptions: jest.fn(),
    adminUpdate: jest.fn(),
    adminUpdateInterests: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpVolunteerTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: VolunteersService, useValue: volunteers },
      ],
    }).compile();
    tools = module.get(McpVolunteerTools);
    jest.clearAllMocks();
    permissions.permissionsWithRole.mockImplementation(async () => ({
      permissions: await permissions.permissions(),
      role: 'COOP_ADMIN',
    }));
    scope = 'READ_WRITE';
    permissions.permissions.mockResolvedValue({ canViewVolunteers: true, canViewPII: true });
    billing.isReadOnly.mockResolvedValue(false);
    volunteers.adminList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
    volunteers.adminGet.mockResolvedValue({
      id: 'v1',
      name: 'An Peeters',
      email: 'an@example.be',
      phone: '0470000000',
      postalCode: '3600',
      interests: ['board'],
      status: 'ACTIVE',
    });
    volunteers.adminInterestOptions.mockResolvedValue({
      source: 'configured',
      options: [
        {
          tag: 'board',
          position: 0,
          active: true,
          labels: {
            nl: 'Bestuur',
            fr: "Conseil d'administration",
            de: 'Vorstand',
            en: 'Board of directors',
          },
        },
      ],
    });
    volunteers.adminUpdate.mockResolvedValue({ id: 'v1', status: 'WITHDRAWN' });
    volunteers.adminUpdateInterests.mockResolvedValue({ source: 'configured', options: [] });
  });

  it('uses the authenticated coop for every volunteer call', async () => {
    await tools.listVolunteers({
      status: 'PENDING_CONFIRMATION',
      tag: 'board',
      page: 2,
      pageSize: 10,
    });
    await tools.getVolunteer({ volunteerId: 'v1' });
    await tools.listVolunteerInterests();
    await tools.updateVolunteer({ volunteerId: 'v1', tags: ['board'], status: 'WITHDRAWN' });
    await tools.updateVolunteerInterests({ add: ['board'] });

    expect(volunteers.adminList).toHaveBeenCalledWith(
      'coop-from-auth',
      expect.objectContaining({
        status: 'PENDING_CONFIRMATION',
        tag: 'board',
        page: 2,
        pageSize: 10,
      }),
    );
    expect(volunteers.adminGet).toHaveBeenCalledWith('coop-from-auth', 'v1');
    expect(volunteers.adminInterestOptions).toHaveBeenCalledWith('coop-from-auth');
    expect(volunteers.adminUpdate).toHaveBeenCalledWith(
      'coop-from-auth',
      'v1',
      expect.objectContaining({ tags: ['board'], status: 'WITHDRAWN' }),
      { userId: 'u1', ip: 'mcp', userAgent: 'mcp-api-key:k1' },
    );
    expect(volunteers.adminUpdateInterests).toHaveBeenCalledWith(
      'coop-from-auth',
      expect.objectContaining({ add: ['board'] }),
      { userId: 'u1', ip: 'mcp', userAgent: 'mcp-api-key:k1' },
    );
  });

  it('refuses volunteer tools without canViewVolunteers', async () => {
    permissions.permissions.mockResolvedValue({
      canManageSettings: true,
      canViewVolunteers: false,
    });

    await expect(tools.listVolunteers({})).rejects.toBeInstanceOf(McpError);
    await expect(tools.getVolunteer({ volunteerId: 'v1' })).rejects.toBeInstanceOf(McpError);
    await expect(tools.listVolunteerInterests()).rejects.toBeInstanceOf(McpError);
    await expect(
      tools.updateVolunteer({ volunteerId: 'v1', status: 'WITHDRAWN' }),
    ).rejects.toBeInstanceOf(McpError);
    await expect(tools.updateVolunteerInterests({ add: ['board'] })).rejects.toBeInstanceOf(
      McpError,
    );
    expect(volunteers.adminList).not.toHaveBeenCalled();
    expect(volunteers.adminGet).not.toHaveBeenCalled();
    expect(volunteers.adminInterestOptions).not.toHaveBeenCalled();
    expect(volunteers.adminUpdate).not.toHaveBeenCalled();
    expect(volunteers.adminUpdateInterests).not.toHaveBeenCalled();
  });

  it('refuses volunteer writes for a read-only key', async () => {
    scope = 'READ_ONLY';

    await expect(
      tools.updateVolunteer({ volunteerId: 'v1', tags: ['board'] }),
    ).rejects.toBeInstanceOf(McpError);
    await expect(tools.updateVolunteerInterests({ add: ['board'] })).rejects.toBeInstanceOf(
      McpError,
    );
    expect(volunteers.adminUpdate).not.toHaveBeenCalled();
    expect(volunteers.adminUpdateInterests).not.toHaveBeenCalled();
  });

  it('masks volunteer contact details without canViewPII', async () => {
    permissions.permissions.mockResolvedValue({ canViewVolunteers: true, canViewPII: false });

    const result = await tools.getVolunteer({ volunteerId: 'v1' });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'v1',
        name: '***',
        email: '***',
        phone: '***',
        postalCode: '***',
        interests: ['board'],
      }),
    );
  });

  it('rejects a coop id argument and unsafe interest tags', () => {
    expect(listVolunteersParameters.safeParse({ coopId: 'other-coop' }).success).toBe(false);
    expect(
      updateVolunteerParameters.safeParse({ volunteerId: 'v1', tags: ["Conseil d'administration"] })
        .success,
    ).toBe(false);
    expect(
      updateVolunteerInterestsParameters.safeParse({ add: ["Conseil d'administration"] }).success,
    ).toBe(false);
    expect(updateVolunteerInterestsParameters.safeParse({ add: ['board'] }).success).toBe(true);
    expect(
      listVolunteersParameters.safeParse({ status: 'ALL', interest: 'technisch' }).success,
    ).toBe(true);
  });
});
