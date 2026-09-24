import { Injectable } from '@nestjs/common';
import { EcoPowerThresholdType, ProjectType } from '@opencoop/database';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { ChannelsService } from '../../channels/channels.service';
import { CreateChannelDto } from '../../channels/dto/create-channel.dto';
import { UpdateChannelDto } from '../../channels/dto/update-channel.dto';
import { ProjectsService } from '../../projects/projects.service';
import { CreateProjectDto } from '../../projects/dto/create-project.dto';
import { UpdateProjectDto } from '../../projects/dto/update-project.dto';
import { ShareClassesService } from '../../shares/share-classes.service';
import { CreateShareClassDto } from '../../shares/dto/create-share-class.dto';
import { UpdateShareClassDto } from '../../shares/dto/update-share-class.dto';
import { McpToolkit } from '../mcp-toolkit';

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

export const getShareClassParameters = z
  .object({ shareClassId: z.string().describe('The share class ID') })
  .strict();

export const createShareClassParameters = z
  .object({
    name: z.string().max(50),
    code: z.string().max(10),
    pricePerShare: z.number().min(0.01),
    minShares: z.number().min(1).optional(),
    maxShares: z.number().min(1).optional(),
    hasVotingRights: z.boolean().optional(),
    dividendRateOverride: z.number().optional(),
  })
  .strict();

export const updateShareClassParameters = z
  .object({
    shareClassId: z.string().describe('The share class ID'),
    name: z.string().max(50).optional(),
    code: z.string().max(10).optional(),
    pricePerShare: z.number().min(0.01).optional(),
    minShares: z.number().min(1).optional(),
    maxShares: z.number().min(1).optional(),
    hasVotingRights: z.boolean().optional(),
    dividendRateOverride: z.number().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const getProjectParameters = z
  .object({ projectId: z.string().describe('The project ID') })
  .strict();

export const createProjectParameters = z
  .object({
    name: z.string().max(100),
    description: z.string().max(1000).optional(),
    type: z.nativeEnum(ProjectType).optional(),
    capacityKw: z.number().min(0).optional(),
    estimatedAnnualMwh: z.number().min(0).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    targetShares: z.number().min(0).optional(),
  })
  .strict();

export const updateProjectParameters = z
  .object({
    projectId: z.string().describe('The project ID'),
    name: z.string().max(100).optional(),
    description: z.string().max(1000).optional(),
    type: z.nativeEnum(ProjectType).optional(),
    capacityKw: z.number().min(0).optional(),
    estimatedAnnualMwh: z.number().min(0).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    targetShares: z.number().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const deleteProjectParameters = z
  .object({ projectId: z.string().describe('The project ID') })
  .strict();

const channelFields = {
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Slug must be lowercase alphanumeric with optional hyphens',
    ),
  name: z.string().min(2).max(100),
  description: z.string().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color')
    .optional(),
  secondaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color')
    .optional(),
  termsUrl: z.string().optional(),
  shareClassIds: z.array(z.string()).optional(),
  projectIds: z.array(z.string()).optional(),
};

export const getChannelParameters = z
  .object({ channelId: z.string().describe('The channel ID') })
  .strict();

const channelFieldsSchema = z.object(channelFields);

export const createChannelParameters = channelFieldsSchema.strict();

export const updateChannelParameters = z
  .object({
    channelId: z.string().describe('The channel ID'),
    ...channelFieldsSchema.partial().shape,
    active: z.boolean().optional(),
  })
  .strict();

export const deleteChannelParameters = z
  .object({ channelId: z.string().describe('The channel ID') })
  .strict();

type GetShareClassParams = z.infer<typeof getShareClassParameters>;
type CreateShareClassParams = z.infer<typeof createShareClassParameters>;
type UpdateShareClassParams = z.infer<typeof updateShareClassParameters>;
type GetProjectParams = z.infer<typeof getProjectParameters>;
type CreateProjectParams = z.infer<typeof createProjectParameters>;
type UpdateProjectParams = z.infer<typeof updateProjectParameters>;
type DeleteProjectParams = z.infer<typeof deleteProjectParameters>;
type GetChannelParams = z.infer<typeof getChannelParameters>;
type CreateChannelParams = z.infer<typeof createChannelParameters>;
type UpdateChannelParams = z.infer<typeof updateChannelParameters>;
type DeleteChannelParams = z.infer<typeof deleteChannelParameters>;

@Injectable()
export class McpCatalogTools {
  constructor(
    private readonly shareClassesService: ShareClassesService,
    private readonly projectsService: ProjectsService,
    private readonly channelsService: ChannelsService,
    private readonly toolkit: McpToolkit,
  ) {}

  // Mirrors GET admin/coops/:coopId/share-classes/:id
  @Tool({
    name: 'get_share_class',
    description: 'Get one share class by ID.',
    parameters: getShareClassParameters,
  })
  async getShareClass(params: GetShareClassParams) {
    return this.toolkit.run({ permission: 'canManageShareClasses' }, params, async (ctx) =>
      this.shareClassesService.findById(params.shareClassId, ctx.coopId),
    );
  }

  // Mirrors POST admin/coops/:coopId/share-classes
  @Tool({
    name: 'create_share_class',
    description: 'Create a share class and return the created record.',
    parameters: createShareClassParameters,
  })
  async createShareClass(params: CreateShareClassParams) {
    return this.toolkit.run(
      { permission: 'canManageShareClasses', write: true, dto: CreateShareClassDto },
      params,
      async (ctx, dto) =>
        this.shareClassesService.create(
          ctx.coopId,
          dto,
          ctx.audit.userId,
          ctx.audit.ip,
          ctx.audit.userAgent,
        ),
    );
  }

  // Mirrors PUT admin/coops/:coopId/share-classes/:id
  @Tool({
    name: 'update_share_class',
    description: 'Update a share class and return the updated record.',
    parameters: updateShareClassParameters,
  })
  async updateShareClass(params: UpdateShareClassParams) {
    const { shareClassId, ...input } = params;
    return this.toolkit.run(
      { permission: 'canManageShareClasses', write: true, dto: UpdateShareClassDto },
      input,
      async (ctx, dto) =>
        this.shareClassesService.update(
          shareClassId,
          ctx.coopId,
          dto,
          ctx.audit.userId,
          ctx.audit.ip,
          ctx.audit.userAgent,
        ),
    );
  }

  // Mirrors GET admin/coops/:coopId/projects/:id
  @Tool({
    name: 'get_project',
    description: 'Get one project by ID.',
    parameters: getProjectParameters,
  })
  async getProject(params: GetProjectParams) {
    return this.toolkit.run({ permission: 'canManageProjects' }, params, async (ctx) =>
      this.projectsService.findById(params.projectId, ctx.coopId),
    );
  }

  // Mirrors POST admin/coops/:coopId/projects
  @Tool({
    name: 'create_project',
    description: 'Create a project and return the created record.',
    parameters: createProjectParameters,
  })
  async createProject(params: CreateProjectParams) {
    return this.toolkit.run(
      { permission: 'canManageProjects', write: true, dto: CreateProjectDto },
      params,
      async (ctx, dto) =>
        this.projectsService.create(
          ctx.coopId,
          dto,
          ctx.audit.userId,
          ctx.audit.ip,
          ctx.audit.userAgent,
        ),
    );
  }

  // Mirrors PUT admin/coops/:coopId/projects/:id
  @Tool({
    name: 'update_project',
    description: 'Update a project and return the updated record.',
    parameters: updateProjectParameters,
  })
  async updateProject(params: UpdateProjectParams) {
    const { projectId, ...input } = params;
    return this.toolkit.run(
      { permission: 'canManageProjects', write: true, dto: UpdateProjectDto },
      input,
      async (ctx, dto) =>
        this.projectsService.update(
          projectId,
          ctx.coopId,
          dto,
          ctx.audit.userId,
          ctx.audit.ip,
          ctx.audit.userAgent,
        ),
    );
  }

  // Mirrors DELETE admin/coops/:coopId/projects/:id
  @Tool({
    name: 'delete_project',
    description: 'Delete a project. This is irreversible and fails when registrations use it.',
    parameters: deleteProjectParameters,
  })
  async deleteProject(params: DeleteProjectParams) {
    return this.toolkit.run({ permission: 'canManageProjects', write: true }, params, async (ctx) =>
      this.projectsService.delete(
        params.projectId,
        ctx.coopId,
        ctx.audit.userId,
        ctx.audit.ip,
        ctx.audit.userAgent,
      ),
    );
  }

  // Mirrors GET admin/coops/:coopId/channels
  @Tool({
    name: 'list_channels',
    description: 'List all channels for the cooperative.',
    parameters: z.object({}).strict(),
  })
  async listChannels() {
    return this.toolkit.run({ permission: 'canManageSettings' }, undefined, async (ctx) =>
      this.channelsService.findAll(ctx.coopId),
    );
  }

  // Mirrors GET admin/coops/:coopId/channels/:channelId
  @Tool({
    name: 'get_channel',
    description: 'Get one channel by ID, including its linked share classes and projects.',
    parameters: getChannelParameters,
  })
  async getChannel(params: GetChannelParams) {
    return this.toolkit.run({ permission: 'canManageSettings' }, params, async (ctx) =>
      this.channelsService.findById(params.channelId, ctx.coopId),
    );
  }

  // Mirrors POST admin/coops/:coopId/channels
  @Tool({
    name: 'create_channel',
    description: 'Create a channel and return the created record.',
    parameters: createChannelParameters,
  })
  async createChannel(params: CreateChannelParams) {
    return this.toolkit.run(
      { permission: 'canManageSettings', write: true, dto: CreateChannelDto },
      params,
      async (ctx, dto) =>
        this.channelsService.create(
          ctx.coopId,
          dto,
          ctx.audit.userId,
          ctx.audit.ip,
          ctx.audit.userAgent,
        ),
    );
  }

  // Mirrors PUT admin/coops/:coopId/channels/:channelId
  @Tool({
    name: 'update_channel',
    description: 'Update a channel and return the updated record.',
    parameters: updateChannelParameters,
  })
  async updateChannel(params: UpdateChannelParams) {
    const { channelId, ...input } = params;
    return this.toolkit.run(
      { permission: 'canManageSettings', write: true, dto: UpdateChannelDto },
      input,
      async (ctx, dto) =>
        this.channelsService.update(
          channelId,
          ctx.coopId,
          dto,
          ctx.audit.userId,
          ctx.audit.ip,
          ctx.audit.userAgent,
        ),
    );
  }

  // Mirrors DELETE admin/coops/:coopId/channels/:channelId
  @Tool({
    name: 'delete_channel',
    description: 'Delete a channel. This is irreversible and fails for the default channel.',
    parameters: deleteChannelParameters,
  })
  async deleteChannel(params: DeleteChannelParams) {
    return this.toolkit.run({ permission: 'canManageSettings', write: true }, params, async (ctx) =>
      this.channelsService.delete(params.channelId, ctx.coopId),
    );
  }
}
