import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { McpAuthStore } from '../mcp-auth.store';

function decimalReplacer(_key: string, value: unknown) {
  if (value && typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return value;
}
import { RegistrationsService } from '../../registrations/registrations.service';

@Injectable()
export class McpTransactionTools {
  constructor(
    private readonly auth: McpAuthStore,
    private readonly registrationsService: RegistrationsService,
  ) {}

  @Tool({
    name: 'list_registrations',
    description:
      'List share registrations (buy/sell transactions) with optional filtering by status, type, shareholder, channel, and date range. Supports pagination.',
    parameters: z.object({
      status: z
        .string()
        .optional()
        .describe(
          'Filter by status: PENDING, PENDING_PAYMENT, ACTIVE, COMPLETED, or CANCELLED',
        ),
      type: z
        .string()
        .optional()
        .describe('Filter by type: BUY or SELL'),
      shareholderId: z
        .string()
        .optional()
        .describe('Filter by shareholder ID'),
      channelId: z.string().optional().describe('Filter by channel ID'),
      fromDate: z
        .string()
        .optional()
        .describe('Start date filter (ISO 8601, e.g. 2025-01-01)'),
      toDate: z
        .string()
        .optional()
        .describe('End date filter (ISO 8601, e.g. 2025-12-31)'),
      page: z.number().optional().describe('Page number (default 1)'),
      pageSize: z
        .number()
        .optional()
        .describe('Items per page (default 25, max 100)'),
    }),
  })
  async listRegistrations(params: {
    status?: string;
    type?: string;
    shareholderId?: string;
    channelId?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    pageSize?: number;
  }) {
    const coopId = this.auth.getCoopId();
    const pageSize = Math.min(params.pageSize || 25, 100);

    const result = await this.registrationsService.findAll(coopId, {
      status: params.status,
      type: params.type,
      shareholderId: params.shareholderId,
      channelId: params.channelId,
      fromDate: params.fromDate,
      toDate: params.toDate,
      page: params.page,
      pageSize,
    });

    return JSON.stringify(result, decimalReplacer, 2);
  }

  @Tool({
    name: 'get_registration',
    description:
      'Get full details for a single registration (share transaction) by ID, including shareholder info, share class, project, and payments.',
    parameters: z.object({
      registrationId: z.string().describe('The registration ID'),
    }),
  })
  async getRegistration(params: { registrationId: string }) {
    const coopId = this.auth.getCoopId();
    const registration = await this.registrationsService.findById(
      params.registrationId,
      coopId,
    );

    return JSON.stringify(registration, decimalReplacer, 2);
  }
}
