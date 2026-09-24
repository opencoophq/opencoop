import { Test } from '@nestjs/testing';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';

jest.mock('../../channels/channels.service', () => ({
  ChannelsService: class ChannelsService {},
}));

import { ChannelsService } from '../../channels/channels.service';
import { ProjectsService } from '../../projects/projects.service';
import { ShareClassesService } from '../../shares/share-classes.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import {
  McpCatalogTools,
  createChannelParameters,
  createProjectParameters,
  createShareClassParameters,
  updateChannelParameters,
  updateProjectParameters,
  updateShareClassParameters,
} from './mcp-catalog.tools';

describe('McpCatalogTools', () => {
  let tools: McpCatalogTools;
  let scope: 'READ_ONLY' | 'READ_WRITE' = 'READ_WRITE';
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'k1',
    getScope: () => scope,
  };
  const permissions = { permissions: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const shareClasses = { findById: jest.fn(), create: jest.fn(), update: jest.fn() };
  const projects = { findById: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() };
  const channels = {
    findAll: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpCatalogTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: ShareClassesService, useValue: shareClasses },
        { provide: ProjectsService, useValue: projects },
        { provide: ChannelsService, useValue: channels },
      ],
    }).compile();
    tools = module.get(McpCatalogTools);
    jest.clearAllMocks();
    scope = 'READ_WRITE';
    permissions.permissions.mockResolvedValue({
      canManageShareClasses: true,
      canManageProjects: true,
      canManageSettings: true,
    });
    billing.isReadOnly.mockResolvedValue(false);
    shareClasses.findById.mockResolvedValue({ id: 'sc1' });
    shareClasses.create.mockResolvedValue({ id: 'sc1' });
    shareClasses.update.mockResolvedValue({ id: 'sc1' });
    projects.findById.mockResolvedValue({ id: 'p1' });
    projects.create.mockResolvedValue({ id: 'p1' });
    projects.update.mockResolvedValue({ id: 'p1' });
    projects.delete.mockResolvedValue({ message: 'Project deleted' });
    channels.findAll.mockResolvedValue([{ id: 'ch1' }]);
    channels.findById.mockResolvedValue({ id: 'ch1' });
    channels.create.mockResolvedValue({ id: 'ch1' });
    channels.update.mockResolvedValue({ id: 'ch1' });
    channels.delete.mockResolvedValue(undefined);
  });

  it('uses the authenticated coop for every catalog service call', async () => {
    await tools.getShareClass({ shareClassId: 'sc1' });
    await tools.createShareClass({ name: 'Class A', code: 'A', pricePerShare: 10 });
    await tools.updateShareClass({ shareClassId: 'sc1', name: 'Class B' });
    await tools.getProject({ projectId: 'p1' });
    await tools.createProject({ name: 'Solar' });
    await tools.updateProject({ projectId: 'p1', name: 'Solar 2' });
    await tools.deleteProject({ projectId: 'p1' });
    await tools.listChannels();
    await tools.getChannel({ channelId: 'ch1' });
    await tools.createChannel({ slug: 'public', name: 'Public' });
    await tools.updateChannel({ channelId: 'ch1', name: 'Public 2' });
    await tools.deleteChannel({ channelId: 'ch1' });

    expect(shareClasses.findById).toHaveBeenCalledWith('sc1', 'coop-from-auth');
    expect(shareClasses.create).toHaveBeenCalledWith(
      'coop-from-auth',
      expect.objectContaining({ name: 'Class A', code: 'A', pricePerShare: 10 }),
      'u1',
      'mcp',
      'mcp-api-key:k1',
    );
    expect(shareClasses.update).toHaveBeenCalledWith(
      'sc1',
      'coop-from-auth',
      expect.objectContaining({ name: 'Class B' }),
      'u1',
      'mcp',
      'mcp-api-key:k1',
    );
    expect(projects.findById).toHaveBeenCalledWith('p1', 'coop-from-auth');
    expect(projects.create).toHaveBeenCalledWith(
      'coop-from-auth',
      expect.objectContaining({ name: 'Solar' }),
      'u1',
      'mcp',
      'mcp-api-key:k1',
    );
    expect(projects.update).toHaveBeenCalledWith(
      'p1',
      'coop-from-auth',
      expect.objectContaining({ name: 'Solar 2' }),
      'u1',
      'mcp',
      'mcp-api-key:k1',
    );
    expect(projects.delete).toHaveBeenCalledWith(
      'p1',
      'coop-from-auth',
      'u1',
      'mcp',
      'mcp-api-key:k1',
    );
    expect(channels.findAll).toHaveBeenCalledWith('coop-from-auth');
    expect(channels.findById).toHaveBeenCalledWith('ch1', 'coop-from-auth');
    expect(channels.create).toHaveBeenCalledWith(
      'coop-from-auth',
      expect.objectContaining({ slug: 'public', name: 'Public' }),
      'u1',
      'mcp',
      'mcp-api-key:k1',
    );
    expect(channels.update).toHaveBeenCalledWith(
      'ch1',
      'coop-from-auth',
      expect.objectContaining({ name: 'Public 2' }),
      'u1',
      'mcp',
      'mcp-api-key:k1',
    );
    expect(channels.delete).toHaveBeenCalledWith('ch1', 'coop-from-auth');
  });

  it('refuses a catalog tool without its permission', async () => {
    permissions.permissions.mockResolvedValue({});

    await expect(tools.getProject({ projectId: 'p1' })).rejects.toBeInstanceOf(McpError);
    expect(projects.findById).not.toHaveBeenCalled();
  });

  it('refuses catalog writes for a read-only key', async () => {
    scope = 'READ_ONLY';

    await expect(tools.createChannel({ slug: 'public', name: 'Public' })).rejects.toBeInstanceOf(
      McpError,
    );
    expect(channels.create).not.toHaveBeenCalled();
  });

  it('rejects invalid DTO-shaped input in the tool schemas', () => {
    expect(
      createShareClassParameters.safeParse({ name: 'A', code: 'A', pricePerShare: 0 }).success,
    ).toBe(false);
    expect(createProjectParameters.safeParse({ name: 'Solar', type: 'HYDRO' }).success).toBe(false);
    expect(
      updateProjectParameters.safeParse({ projectId: 'p1', startDate: 'not-a-date' }).success,
    ).toBe(false);
    expect(createChannelParameters.safeParse({ slug: 'Bad Slug', name: 'Public' }).success).toBe(
      false,
    );
    expect(
      updateShareClassParameters.safeParse({ shareClassId: 'sc1', unknown: true }).success,
    ).toBe(false);
    expect(
      updateChannelParameters.safeParse({ channelId: 'ch1', primaryColor: 'blue' }).success,
    ).toBe(false);
  });
});
