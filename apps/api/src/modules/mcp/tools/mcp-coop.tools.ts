import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { PrismaService } from '../../../prisma/prisma.service';
import { McpAuthStore } from '../mcp-auth.store';

function decimalReplacer(_key: string, value: unknown) {
  if (value && typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return value;
}

@Injectable()
export class McpCoopTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: McpAuthStore,
  ) {}

  @Tool({
    name: 'get_coop_info',
    description:
      'Get cooperative details: name, slug, bank info, address, branding channels, and settings.',
    parameters: z.object({}),
  })
  async getCoopInfo() {
    const coopId = this.auth.getCoopId();
    const coop = await this.prisma.coop.findUniqueOrThrow({
      where: { id: coopId },
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
    });

    return JSON.stringify(coop, decimalReplacer, 2);
  }

  @Tool({
    name: 'get_coop_stats',
    description:
      'Get high-level cooperative statistics: total/active/pending shareholders, pending registrations, unmatched bank transactions, and total capital.',
    parameters: z.object({}),
  })
  async getCoopStats() {
    const coopId = this.auth.getCoopId();

    const [
      totalShareholders,
      activeShareholders,
      pendingShareholders,
      pendingRegistrations,
      unmatchedBankTransactions,
      capitalResult,
    ] = await Promise.all([
      this.prisma.shareholder.count({ where: { coopId } }),
      this.prisma.shareholder.count({ where: { coopId, status: 'ACTIVE' } }),
      this.prisma.shareholder.count({ where: { coopId, status: 'PENDING' } }),
      this.prisma.registration.count({ where: { coopId, status: 'PENDING' } }),
      this.prisma.bankTransaction.count({
        where: { coopId, matchStatus: 'UNMATCHED' },
      }),
      this.prisma.$queryRaw<[{ total: string }]>`
        SELECT COALESCE(SUM(
          CASE WHEN r."type" = 'BUY' THEN p."amount" ELSE -p."amount" END
        ), 0)::text as total
        FROM payments p
        JOIN registrations r ON r.id = p."registrationId"
        WHERE r."coopId" = ${coopId}
        AND r."status" IN ('ACTIVE', 'COMPLETED')
      `,
    ]);

    const stats = {
      totalShareholders,
      activeShareholders,
      pendingShareholders,
      pendingRegistrations,
      unmatchedBankTransactions,
      totalCapital: Number(capitalResult[0].total),
    };

    return JSON.stringify(stats, decimalReplacer, 2);
  }

  @Tool({
    name: 'list_share_classes',
    description:
      'List all share classes for the cooperative with their name, code, price per share, and active status.',
    parameters: z.object({}),
  })
  async listShareClasses() {
    const coopId = this.auth.getCoopId();
    const shareClasses = await this.prisma.shareClass.findMany({
      where: { coopId },
      orderBy: { name: 'asc' },
    });

    const result = shareClasses.map((sc) => ({
      ...sc,
      pricePerShare: Number(sc.pricePerShare),
    }));

    return JSON.stringify(result, decimalReplacer, 2);
  }

  @Tool({
    name: 'list_projects',
    description:
      'List all projects for the cooperative with the number of shares sold per project.',
    parameters: z.object({}),
  })
  async listProjects() {
    const coopId = this.auth.getCoopId();

    const projects = await this.prisma.project.findMany({
      where: { coopId },
      orderBy: { name: 'asc' },
    });

    const sharesSold = await this.prisma.registration.groupBy({
      by: ['projectId'],
      where: {
        coopId,
        type: 'BUY',
        status: { in: ['ACTIVE', 'COMPLETED'] },
        projectId: { not: null },
      },
      _sum: { quantity: true },
    });

    const sharesByProject = new Map(
      sharesSold.map((g) => [g.projectId, g._sum.quantity || 0]),
    );

    const result = projects.map((p) => ({
      ...p,
      sharesSold: sharesByProject.get(p.id) || 0,
    }));

    return JSON.stringify(result, decimalReplacer, 2);
  }
}
