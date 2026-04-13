import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { McpAuthStore } from '../mcp-auth.store';
import { ShareholdersService } from '../../shareholders/shareholders.service';

@Injectable()
export class McpShareholderTools {
  constructor(
    private readonly auth: McpAuthStore,
    private readonly shareholdersService: ShareholdersService,
  ) {}

  @Tool({
    name: 'list_shareholders',
    description:
      'List shareholders with optional filtering by search term, status (ACTIVE/PENDING/INACTIVE), type (INDIVIDUAL/COMPANY/MINOR), or channelId. Supports pagination.',
    parameters: z.object({
      search: z.string().optional().describe('Search by name, company name, or email'),
      status: z.string().optional().describe('Filter by status: ACTIVE, PENDING, or INACTIVE'),
      type: z.string().optional().describe('Filter by type: INDIVIDUAL, COMPANY, or MINOR'),
      channelId: z.string().optional().describe('Filter by channel ID'),
      page: z.number().optional().describe('Page number (default 1)'),
      pageSize: z
        .number()
        .optional()
        .describe('Items per page (default 25, max 100)'),
    }),
  })
  async listShareholders(params: {
    search?: string;
    status?: string;
    type?: string;
    channelId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const coopId = this.auth.getCoopId();
    const pageSize = Math.min(params.pageSize || 25, 100);

    const result = await this.shareholdersService.findAll(coopId, {
      search: params.search,
      status: params.status,
      type: params.type,
      channelId: params.channelId,
      page: params.page,
      pageSize,
    });

    // Strip sensitive fields
    const sanitized = {
      ...result,
      items: result.items.map((item: Record<string, unknown>) => {
        const { nationalId, ...rest } = item;
        return rest;
      }),
    };

    return JSON.stringify(sanitized, null, 2);
  }

  @Tool({
    name: 'get_shareholder',
    description:
      'Get full details for a single shareholder by ID, including registrations, documents, and dividend payouts.',
    parameters: z.object({
      shareholderId: z.string().describe('The shareholder ID'),
    }),
  })
  async getShareholder(params: { shareholderId: string }) {
    const coopId = this.auth.getCoopId();
    const shareholder = await this.shareholdersService.findById(
      params.shareholderId,
      coopId,
    );

    // Strip sensitive fields from shareholder and beneficial owners
    const { nationalId, ...rest } = shareholder as Record<string, unknown>;
    const beneficialOwners = rest.beneficialOwners as
      | Array<Record<string, unknown>>
      | undefined;
    if (beneficialOwners) {
      rest.beneficialOwners = beneficialOwners.map((bo) => {
        const { nationalId: boNationalId, ...boRest } = bo;
        return boRest;
      });
    }

    return JSON.stringify(rest, null, 2);
  }
}
