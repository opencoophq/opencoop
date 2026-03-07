import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class McpTools {
  constructor(private readonly prisma: PrismaService) {}

  @Tool({
    name: 'list_coops',
    description:
      'List all active cooperatives on OpenCoop. Returns slug, name, and logo URL for each coop.',
    parameters: z.object({}),
  })
  async listCoops() {
    const coops = await this.prisma.coop.findMany({
      where: { active: true },
      select: {
        slug: true,
        name: true,
        channels: {
          where: { isDefault: true },
          select: { logoUrl: true },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });
    const result = coops.map(({ channels, ...rest }) => ({
      ...rest,
      logoUrl: channels[0]?.logoUrl ?? null,
    }));
    return JSON.stringify(result, null, 2);
  }

  @Tool({
    name: 'get_coop_info',
    description:
      'Get public information for a cooperative by its slug. Returns name, logo, branding colors, bank details, and terms URL.',
    parameters: z.object({
      slug: z.string().describe('The cooperative slug (e.g. "zonnecooperatie")'),
    }),
  })
  async getCoopInfo({ slug }: { slug: string }) {
    const coop = await this.prisma.coop.findFirst({
      where: { slug, active: true },
      select: {
        slug: true,
        name: true,
        bankName: true,
        bankIban: true,
        bankBic: true,
        channels: {
          where: { isDefault: true },
          select: {
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
            termsUrl: true,
          },
          take: 1,
        },
      },
    });
    if (!coop) return JSON.stringify({ error: 'Cooperative not found' });
    const { channels, ...rest } = coop;
    const ch = channels[0];
    const result = {
      ...rest,
      logoUrl: ch?.logoUrl ?? null,
      primaryColor: ch?.primaryColor ?? '#1e40af',
      secondaryColor: ch?.secondaryColor ?? '#3b82f6',
      termsUrl: ch?.termsUrl ?? null,
    };
    return JSON.stringify(result, null, 2);
  }

  @Tool({
    name: 'list_projects',
    description:
      'List active projects for a cooperative. Returns project details including type, capacity, and live investment stats (shares sold, capital raised).',
    parameters: z.object({
      slug: z.string().describe('The cooperative slug (e.g. "zonnecooperatie")'),
    }),
  })
  async listProjects({ slug }: { slug: string }) {
    const coop = await this.prisma.coop.findFirst({
      where: { slug, active: true },
      select: {
        projects: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            description: true,
            type: true,
            capacityKw: true,
            targetShares: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!coop) return JSON.stringify({ error: 'Cooperative not found' });

    const projectIds = coop.projects.map((p) => p.id);

    const regStats = await this.prisma.registration.groupBy({
      by: ['projectId'],
      where: {
        projectId: { in: projectIds },
        type: 'BUY',
        status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] },
      },
      _sum: { quantity: true },
    });

    const capitalByProject = await Promise.all(
      projectIds.map(async (projectId) => {
        const registrations = await this.prisma.registration.findMany({
          where: { projectId, type: 'BUY', status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] } },
          include: { payments: { select: { amount: true } } },
        });
        const capital = registrations.reduce(
          (sum, reg) => sum + reg.payments.reduce((s, p) => s + Number(p.amount), 0),
          0,
        );
        return { projectId, capital };
      }),
    );

    const statsMap = new Map(regStats.map((s) => [s.projectId, s]));
    const capitalMap = new Map(capitalByProject.map((c) => [c.projectId, c.capital]));

    const projects = coop.projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      type: project.type,
      capacityKw: project.capacityKw?.toNumber() ?? null,
      targetShares: project.targetShares,
      sharesSold: statsMap.get(project.id)?._sum.quantity ?? 0,
      capitalRaised: capitalMap.get(project.id) ?? 0,
    }));

    return JSON.stringify(projects, null, 2);
  }

  @Tool({
    name: 'list_share_classes',
    description:
      'List active share classes for a cooperative. Returns pricing, limits, and voting rights for each class.',
    parameters: z.object({
      slug: z.string().describe('The cooperative slug (e.g. "zonnecooperatie")'),
    }),
  })
  async listShareClasses({ slug }: { slug: string }) {
    const coop = await this.prisma.coop.findFirst({
      where: { slug, active: true },
      select: {
        shareClasses: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            code: true,
            pricePerShare: true,
            minShares: true,
            maxShares: true,
            hasVotingRights: true,
          },
          orderBy: { code: 'asc' },
        },
      },
    });
    if (!coop) return JSON.stringify({ error: 'Cooperative not found' });

    const classes = coop.shareClasses.map((sc) => ({
      ...sc,
      pricePerShare: sc.pricePerShare.toNumber(),
    }));

    return JSON.stringify(classes, null, 2);
  }

  @Tool({
    name: 'get_share_purchase_url',
    description:
      'Generate a deep link URL for purchasing shares in a cooperative. Optionally specify a share class code and/or project ID to pre-select them in the purchase form.',
    parameters: z.object({
      slug: z.string().describe('The cooperative slug (e.g. "zonnecooperatie")'),
      classCode: z
        .string()
        .optional()
        .describe('Share class code to pre-select (e.g. "A", "B")'),
      projectId: z.string().optional().describe('Project ID to pre-select'),
      locale: z
        .enum(['nl', 'en', 'fr', 'de'])
        .default('nl')
        .describe('URL locale (default: nl)'),
    }),
  })
  async getSharePurchaseUrl({
    slug,
    classCode,
    projectId,
    locale = 'nl',
  }: {
    slug: string;
    classCode?: string;
    projectId?: string;
    locale?: string;
  }) {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const params = new URLSearchParams();
    if (classCode) params.set('class', classCode);
    if (projectId) params.set('project', projectId);
    const query = params.toString();
    const url = `${baseUrl}/${locale}/${slug}/register${query ? `?${query}` : ''}`;
    return JSON.stringify({ url }, null, 2);
  }
}
