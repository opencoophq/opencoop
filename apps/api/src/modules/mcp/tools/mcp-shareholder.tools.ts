import { Injectable } from '@nestjs/common';
import { IsString } from 'class-validator';
import { ShareholderStatus, ShareholderType } from '@opencoop/database';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { CreateShareholderDto } from '../../shareholders/dto/create-shareholder.dto';
import { LinkShareholderDto } from '../../shareholders/dto/link-shareholder.dto';
import { UpdateShareholderDto } from '../../shareholders/dto/update-shareholder.dto';
import { HouseholdService } from '../../shareholders/household.service';
import { ShareholdersService } from '../../shareholders/shareholders.service';
import { McpToolkit } from '../mcp-toolkit';

export const listShareholdersParameters = z
  .object({
    search: z.string().optional().describe('Search by name, company name, or email'),
    status: z
      .nativeEnum(ShareholderStatus)
      .optional()
      .describe('Filter by status: ACTIVE, PENDING, or INACTIVE'),
    type: z
      .nativeEnum(ShareholderType)
      .optional()
      .describe('Filter by type: INDIVIDUAL, COMPANY, or MINOR'),
    channelId: z.string().optional().describe('Filter by channel ID'),
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Items per page (default 25, max 100)'),
  })
  .strict();

export const getShareholderParameters = z
  .object({
    shareholderId: z.string().describe('The shareholder ID'),
  })
  .strict();

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

const addressParameters = z
  .object({
    street: z.string(),
    number: z.string(),
    box: z.string().optional(),
    postalCode: z.string(),
    city: z.string(),
    country: z.string(),
  })
  .strict();

const beneficialOwnerParameters = z
  .object({
    firstName: z.string(),
    lastName: z.string(),
    nationalId: z.string().optional(),
    ownershipPercentage: z.number().min(0).max(100),
  })
  .strict();

export const createShareholderParameters = z
  .object({
    type: z.nativeEnum(ShareholderType),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    nationalId: z.string().optional(),
    birthDate: isoDate.optional(),
    companyName: z.string().optional(),
    companyId: z.string().optional(),
    vatNumber: z.string().optional(),
    legalForm: z.string().optional(),
    email: z.string().email(),
    phone: z.string().optional(),
    address: addressParameters.optional(),
    bankIban: z.string().optional(),
    bankBic: z.string().optional(),
    beneficialOwners: z.array(beneficialOwnerParameters).optional(),
  })
  .strict();

export const updateShareholderParameters = z
  .object({
    shareholderId: z.string(),
    type: z.nativeEnum(ShareholderType).optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    nationalId: z.string().optional(),
    birthDate: isoDate.optional(),
    companyName: z.string().optional(),
    companyId: z.string().optional(),
    vatNumber: z.string().optional(),
    legalForm: z.string().optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().optional(),
    address: addressParameters.nullable().optional(),
    bankIban: z.string().optional(),
    bankBic: z.string().optional(),
    beneficialOwners: z.array(beneficialOwnerParameters).optional(),
    registeredByUserId: z.string().nullable().optional(),
    registeredByShareholderId: z.string().nullable().optional(),
    isEcoPowerClient: z.boolean().optional(),
    ecoPowerId: z.string().nullable().optional(),
  })
  .strict();

export const getShareholderMinorsParameters = z
  .object({
    shareholderId: z.string(),
  })
  .strict();

export const searchHouseholdUsersParameters = z
  .object({
    shareholderId: z.string(),
    search: z.string().optional().default(''),
  })
  .strict();

export const linkHouseholdParameters = z
  .object({
    shareholderId: z.string(),
    targetShareholderId: z.string(),
  })
  .strict();

export const emancipateShareholderParameters = z
  .object({
    shareholderId: z.string(),
  })
  .strict();

class UpdateShareholderToolDto extends UpdateShareholderDto {
  @IsString()
  shareholderId!: string;
}

class LinkHouseholdToolDto extends LinkShareholderDto {
  @IsString()
  shareholderId!: string;
}

type ListShareholdersParams = z.infer<typeof listShareholdersParameters>;
type GetShareholderParams = z.infer<typeof getShareholderParameters>;
type CreateShareholderParams = z.infer<typeof createShareholderParameters>;
type UpdateShareholderParams = z.infer<typeof updateShareholderParameters>;
type GetShareholderMinorsParams = z.infer<typeof getShareholderMinorsParameters>;
type SearchHouseholdUsersParams = z.infer<typeof searchHouseholdUsersParameters>;
type LinkHouseholdParams = z.infer<typeof linkHouseholdParameters>;
type EmancipateShareholderParams = z.infer<typeof emancipateShareholderParameters>;

@Injectable()
export class McpShareholderTools {
  constructor(
    private readonly shareholdersService: ShareholdersService,
    private readonly householdService: HouseholdService,
    private readonly toolkit: McpToolkit,
  ) {}

  // Mirrors GET admin/coops/:coopId/shareholders
  @Tool({
    name: 'list_shareholders',
    description:
      'List shareholders with optional filtering by search term, status (ACTIVE/PENDING/INACTIVE), type (INDIVIDUAL/COMPANY/MINOR), or channelId. Supports pagination.',
    parameters: listShareholdersParameters,
  })
  async listShareholders(params: ListShareholdersParams) {
    return this.toolkit.run({ permission: 'canManageShareholders' }, params, async (ctx) =>
      this.shareholdersService.findAll(ctx.coopId, {
        search: params.search,
        status: params.status,
        type: params.type,
        channelId: params.channelId,
        page: params.page,
        pageSize: params.pageSize ?? 25,
      }),
    );
  }

  // Mirrors GET admin/coops/:coopId/shareholders/:id
  @Tool({
    name: 'get_shareholder',
    description:
      'Get full details for a single shareholder by ID, including registrations, documents, and dividend payouts.',
    parameters: getShareholderParameters,
  })
  async getShareholder(params: GetShareholderParams) {
    return this.toolkit.run({ permission: 'canManageShareholders' }, params, async (ctx) =>
      this.shareholdersService.findById(params.shareholderId, ctx.coopId),
    );
  }

  // Mirrors POST admin/coops/:coopId/shareholders
  @Tool({
    name: 'create_shareholder',
    description:
      'Create a shareholder in the authenticated cooperative and return the created record.',
    parameters: createShareholderParameters,
  })
  async createShareholder(params: CreateShareholderParams) {
    return this.toolkit.run(
      {
        permission: 'canManageShareholders',
        write: true,
        dto: CreateShareholderDto,
      },
      params,
      async (ctx, dto) =>
        this.shareholdersService.create(
          ctx.coopId,
          dto,
          ctx.audit.userId,
          ctx.audit.ip,
          ctx.audit.userAgent,
        ),
    );
  }

  // Mirrors PUT admin/coops/:coopId/shareholders/:id
  @Tool({
    name: 'update_shareholder',
    description: 'Update a shareholder by ID and return the updated record.',
    parameters: updateShareholderParameters,
  })
  async updateShareholder(params: UpdateShareholderParams) {
    return this.toolkit.run(
      {
        permission: 'canManageShareholders',
        write: true,
        dto: UpdateShareholderToolDto,
      },
      params,
      async (ctx, dto) => {
        const { shareholderId: _shareholderId, ...updateDto } = dto;
        return this.shareholdersService.update(
          params.shareholderId,
          ctx.coopId,
          updateDto,
          ctx.audit.userId,
          ctx.audit.ip,
          ctx.audit.userAgent,
        );
      },
    );
  }

  // Mirrors GET admin/coops/:coopId/shareholders/:id/minors
  @Tool({
    name: 'get_shareholder_minors',
    description: 'List the minor shareholders registered by a shareholder.',
    parameters: getShareholderMinorsParameters,
  })
  async getShareholderMinors(params: GetShareholderMinorsParams) {
    return this.toolkit.run({ permission: 'canManageShareholders' }, params, async (ctx) =>
      this.shareholdersService.findMinorsByShareholderId(params.shareholderId, ctx.coopId),
    );
  }

  // Mirrors GET admin/coops/:coopId/shareholders/:shareholderId/household/search-users
  @Tool({
    name: 'search_household_users',
    description:
      'Search shareholder household-link candidates by email. Returns shareholder IDs, contact emails, names, and household counts.',
    parameters: searchHouseholdUsersParameters,
  })
  async searchHouseholdUsers(params: SearchHouseholdUsersParams) {
    return this.toolkit.run({ permission: 'canManageShareholders' }, params, async (ctx) =>
      this.householdService.searchHouseholdCandidates(
        ctx.coopId,
        params.shareholderId,
        params.search,
      ),
    );
  }

  // Mirrors POST admin/coops/:coopId/shareholders/:shareholderId/household/link
  @Tool({
    name: 'link_household',
    description:
      'Link one shareholder into another shareholder household. The target shareholder account is auto-created from its email when needed, and the updated shareholder is returned.',
    parameters: linkHouseholdParameters,
  })
  async linkHousehold(params: LinkHouseholdParams) {
    return this.toolkit.run(
      {
        permission: 'canManageShareholders',
        write: true,
        dto: LinkHouseholdToolDto,
      },
      params,
      async (ctx, dto) =>
        this.householdService.linkShareholders({
          coopId: ctx.coopId,
          shareholderId: params.shareholderId,
          targetShareholderId: dto.targetShareholderId,
          actorUserId: ctx.userId,
        }),
    );
  }

  // Mirrors POST admin/coops/:coopId/shareholders/:shareholderId/household/emancipate
  @Tool({
    name: 'emancipate_shareholder',
    description:
      'Unlink a shareholder from a shared household and start the household emancipation flow. Returns the emancipation result.',
    parameters: emancipateShareholderParameters,
  })
  async emancipateShareholder(params: EmancipateShareholderParams) {
    return this.toolkit.run(
      { permission: 'canManageShareholders', write: true },
      params,
      async (ctx) =>
        this.householdService.unlinkShareholder({
          coopId: ctx.coopId,
          shareholderId: params.shareholderId,
          actorUserId: ctx.userId,
        }),
    );
  }
}
