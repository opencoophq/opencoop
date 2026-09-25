import { Injectable } from '@nestjs/common';
import { EcoPowerThresholdType } from '@opencoop/database';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { PrismaService } from '../../../prisma/prisma.service';
import { AnalyticsService } from '../../admin/analytics.service';
import { CoopsService } from '../../coops/coops.service';
import { UpdateCoopSettingsDto } from '../../coops/dto/mcp-update-coop-settings.dto';
import { McpToolkit } from '../mcp-toolkit';

export const updateCoopSettingsParameters = z
  .object({
    name: z.string().max(100).optional(),
    requiresApproval: z.boolean().optional(),
    bankName: z.string().optional(),
    bankIban: z.string().optional(),
    bankBic: z.string().optional(),
    minimumHoldingPeriod: z.number().int().min(0).optional(),
    ecoPowerEnabled: z.boolean().optional(),
    ecoPowerMinThresholdType: z.nativeEnum(EcoPowerThresholdType).nullable().optional(),
    ecoPowerMinThreshold: z.number().nullable().optional(),
    emailAudienceProvider: z.literal('brevo').nullable().optional(),
    brevoMembersListId: z.string().optional(),
    brevoResignedListId: z.string().optional(),
    legalForm: z.string().optional(),
    foundedDate: z.string().optional(),
    certificateSignatory: z.string().optional(),
    coopPhone: z.string().optional(),
    coopEmail: z.string().optional(),
    coopWebsite: z.string().optional(),
    vatNumber: z.string().optional(),
    coopAddress: z.record(z.string(), z.string()).nullable().optional(),
  })
  .strict();

type UpdateCoopSettingsParams = z.infer<typeof updateCoopSettingsParameters>;

@Injectable()
export class McpCoopTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analyticsService: AnalyticsService,
    private readonly coopsService: CoopsService,
    private readonly toolkit: McpToolkit,
  ) {}

  // Mirrors GET admin/coops/:coopId
  @Tool({
    name: 'get_coop_info',
    description:
      'Get cooperative details: name, slug, bank info, address, branding channels, and settings.',
    parameters: z.object({}).strict(),
  })
  async getCoopInfo() {
    return this.toolkit.run({}, undefined, async (ctx) =>
      this.prisma.coop.findUniqueOrThrow({
        where: { id: ctx.coopId },
        select: {
          id: true,
          name: true,
          slug: true,
          bankName: true,
          bankIban: true,
          bankBic: true,
          coopAddress: true,
          coopPhone: true,
          coopEmail: true,
          coopWebsite: true,
          legalForm: true,
          foundedDate: true,
          logoUrl: true,
          vatNumber: true,
          requiresApproval: true,
          minimumHoldingPeriod: true,
          channels: {
            where: { active: true },
            select: {
              id: true,
              slug: true,
              name: true,
              description: true,
              logoUrl: true,
              primaryColor: true,
              secondaryColor: true,
              isDefault: true,
            },
          },
        },
      }),
    );
  }

  // Mirrors GET admin/coops/:coopId/stats
  @Tool({
    name: 'get_coop_stats',
    description:
      'Get high-level cooperative statistics: total/active/pending shareholders, pending registrations, unmatched bank transactions, and total capital.',
    parameters: z.object({}).strict(),
  })
  async getCoopStats() {
    return this.toolkit.run({}, undefined, async (ctx) => {
      const [
        totalShareholders,
        activeShareholders,
        pendingShareholders,
        pendingRegistrations,
        unmatchedBankTransactions,
        capitalResult,
      ] = await Promise.all([
        this.prisma.shareholder.count({ where: { coopId: ctx.coopId } }),
        this.prisma.shareholder.count({ where: { coopId: ctx.coopId, status: 'ACTIVE' } }),
        this.prisma.shareholder.count({ where: { coopId: ctx.coopId, status: 'PENDING' } }),
        this.prisma.registration.count({ where: { coopId: ctx.coopId, status: 'PENDING' } }),
        this.prisma.bankTransaction.count({
          where: { coopId: ctx.coopId, matchStatus: 'UNMATCHED' },
        }),
        this.prisma.$queryRaw<[{ total: string }]>`
          SELECT COALESCE(SUM(
            CASE WHEN r."type" = 'BUY' THEN p."amount" ELSE -p."amount" END
          ), 0)::text as total
          FROM payments p
          JOIN registrations r ON r.id = p."registrationId"
          WHERE r."coopId" = ${ctx.coopId}
          AND r."status" IN ('ACTIVE', 'COMPLETED')
        `,
      ]);

      return {
        totalShareholders,
        activeShareholders,
        pendingShareholders,
        pendingRegistrations,
        unmatchedBankTransactions,
        totalCapital: Number(capitalResult[0].total),
      };
    });
  }

  // Mirrors GET admin/coops/:coopId/share-classes
  @Tool({
    name: 'list_share_classes',
    description:
      'List all share classes for the cooperative with their name, code, price per share, and active status.',
    parameters: z.object({}).strict(),
  })
  async listShareClasses() {
    return this.toolkit.run({ permission: 'canManageShareClasses' }, undefined, async (ctx) =>
      this.prisma.shareClass.findMany({
        where: { coopId: ctx.coopId },
        orderBy: { name: 'asc' },
      }),
    );
  }

  // Mirrors GET admin/coops/:coopId/projects
  @Tool({
    name: 'list_projects',
    description:
      'List all projects for the cooperative with the number of shares sold per project.',
    parameters: z.object({}).strict(),
  })
  async listProjects() {
    return this.toolkit.run({ permission: 'canManageProjects' }, undefined, async (ctx) => {
      const [projects, capitalByProject] = await Promise.all([
        this.prisma.project.findMany({
          where: { coopId: ctx.coopId },
          orderBy: { name: 'asc' },
        }),
        this.analyticsService.getCapitalByProject(ctx.coopId),
      ]);

      const sharesByProject = new Map(
        capitalByProject
          .filter((project) => project.projectId !== null)
          .map((project) => [project.projectId as string, project.shareCount]),
      );

      return projects.map((project) => ({
        ...project,
        sharesSold: sharesByProject.get(project.id) ?? 0,
      }));
    });
  }

  // Mirrors GET admin/coops/:coopId/settings
  @Tool({
    name: 'get_coop_settings',
    description: 'Get cooperative settings without SMTP, Graph, or Brevo credentials.',
    parameters: z.object({}).strict(),
  })
  async getCoopSettings() {
    return this.toolkit.run({ permission: 'canManageSettings' }, undefined, async (ctx) =>
      this.coopsService.getSettings(ctx.coopId),
    );
  }

  // Mirrors PUT admin/coops/:coopId/settings
  @Tool({
    name: 'update_coop_settings',
    description: 'Update cooperative settings and return the saved settings without credentials.',
    parameters: updateCoopSettingsParameters,
  })
  async updateCoopSettings(params: UpdateCoopSettingsParams) {
    return this.toolkit.run(
      { permission: 'canManageSettings', write: true, dto: UpdateCoopSettingsDto },
      params,
      async (ctx, dto) => {
        await this.coopsService.update(
          ctx.coopId,
          dto,
          ctx.audit.userId,
          ctx.audit.ip,
          ctx.audit.userAgent,
        );
        return this.coopsService.getSettings(ctx.coopId);
      },
    );
  }
}
