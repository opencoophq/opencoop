import { Injectable } from '@nestjs/common';
import { RegistrationStatus, RegistrationType } from '@opencoop/database';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { maskShareholderPII } from '../../../common/utils/mask-pii';
import { RegistrationsService } from '../../registrations/registrations.service';
import { McpToolkit } from '../mcp-toolkit';

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

export const listRegistrationsParameters = z
  .object({
    status: z
      .nativeEnum(RegistrationStatus)
      .optional()
      .describe('Filter by status: PENDING, PENDING_PAYMENT, ACTIVE, COMPLETED, or CANCELLED'),
    type: z.nativeEnum(RegistrationType).optional().describe('Filter by type: BUY or SELL'),
    shareholderId: z.string().optional().describe('Filter by shareholder ID'),
    channelId: z.string().optional().describe('Filter by channel ID'),
    fromDate: isoDate.optional().describe('Start date filter (ISO 8601, e.g. 2025-01-01)'),
    toDate: isoDate.optional().describe('End date filter (ISO 8601, e.g. 2025-12-31)'),
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

export const getRegistrationParameters = z
  .object({
    registrationId: z.string().describe('The registration ID'),
  })
  .strict();

type ListRegistrationsParams = z.infer<typeof listRegistrationsParameters>;
type GetRegistrationParams = z.infer<typeof getRegistrationParameters>;

@Injectable()
export class McpTransactionTools {
  constructor(
    private readonly registrationsService: RegistrationsService,
    private readonly toolkit: McpToolkit,
  ) {}

  // Mirrors GET admin/coops/:coopId/registrations
  @Tool({
    name: 'list_registrations',
    description:
      'List share registrations (buy/sell transactions) with optional filtering by status, type, shareholder, channel, and date range. Supports pagination.',
    parameters: listRegistrationsParameters,
  })
  async listRegistrations(params: ListRegistrationsParams) {
    return this.toolkit.run({ permission: 'canManageTransactions' }, params, async (ctx) =>
      this.registrationsService.findAll(ctx.coopId, {
        status: params.status,
        type: params.type,
        shareholderId: params.shareholderId,
        channelId: params.channelId,
        fromDate: params.fromDate,
        toDate: params.toDate,
        page: params.page,
        pageSize: params.pageSize ?? 25,
      }),
    );
  }

  // Mirrors GET admin/coops/:coopId/registrations
  @Tool({
    name: 'get_registration',
    description:
      'Get full details for a single registration (share transaction) by ID, including shareholder info, share class, project, and payments.',
    parameters: getRegistrationParameters,
  })
  async getRegistration(params: GetRegistrationParams) {
    return this.toolkit.run({ permission: 'canManageTransactions' }, params, async (ctx) => {
      const registration = await this.registrationsService.findById(
        params.registrationId,
        ctx.coopId,
      );
      const { shareholder, ...rest } = registration;
      const shareholderSummary = {
        id: shareholder.id,
        type: shareholder.type,
        firstName: shareholder.firstName,
        lastName: shareholder.lastName,
        companyName: shareholder.companyName,
        email: shareholder.email,
      };

      return {
        ...rest,
        shareholder: ctx.canViewPII ? shareholderSummary : maskShareholderPII(shareholderSummary),
      };
    });
  }
}
