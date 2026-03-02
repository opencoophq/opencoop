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
        logoUrl: true,
      },
      orderBy: { name: 'asc' },
    });
    return JSON.stringify(coops, null, 2);
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
    const coop = await this.prisma.coop.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        bankName: true,
        bankIban: true,
        bankBic: true,
        termsUrl: true,
      },
    });
    if (!coop) return JSON.stringify({ error: 'Cooperative not found' });
    return JSON.stringify(coop, null, 2);
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
    const coop = await this.prisma.coop.findUnique({
      where: { slug },
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

    const shareStats = await this.prisma.share.groupBy({
      by: ['projectId'],
      where: {
        projectId: { in: projectIds },
        status: 'ACTIVE',
      },
      _sum: { quantity: true },
    });

    const capitalByProject = await Promise.all(
      projectIds.map(async (projectId) => {
        const shares = await this.prisma.share.findMany({
          where: { projectId, status: 'ACTIVE' },
          select: { quantity: true, purchasePricePerShare: true },
        });
        const capital = shares.reduce(
          (sum, s) => sum + s.quantity * s.purchasePricePerShare.toNumber(),
          0,
        );
        return { projectId, capital };
      }),
    );

    const statsMap = new Map(shareStats.map((s) => [s.projectId, s]));
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
    const coop = await this.prisma.coop.findUnique({
      where: { slug },
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
    }),
  })
  async getSharePurchaseUrl({
    slug,
    classCode,
    projectId,
  }: {
    slug: string;
    classCode?: string;
    projectId?: string;
  }) {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const params = new URLSearchParams();
    if (classCode) params.set('class', classCode);
    if (projectId) params.set('project', projectId);
    const query = params.toString();
    const url = `${baseUrl}/nl/${slug}/register${query ? `?${query}` : ''}`;
    return JSON.stringify({ url }, null, 2);
  }
}
