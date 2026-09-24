import { Injectable } from '@nestjs/common';
import { ShareholderStatus, ShareholderType } from '@opencoop/database';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
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

type ListShareholdersParams = z.infer<typeof listShareholdersParameters>;
type GetShareholderParams = z.infer<typeof getShareholderParameters>;

@Injectable()
export class McpShareholderTools {
  constructor(
    private readonly shareholdersService: ShareholdersService,
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
    return this.toolkit.run(
      { permission: 'canManageShareholders', pii: 'shareholderList' },
      params,
      async (ctx) =>
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
    return this.toolkit.run(
      { permission: 'canManageShareholders', pii: 'shareholder' },
      params,
      async (ctx) => this.shareholdersService.findById(params.shareholderId, ctx.coopId),
    );
  }
}
