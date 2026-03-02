import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('LLMs')
@Controller()
export class LlmsController {
  private fullTextCache: { text: string; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('llms.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({ summary: 'LLM-readable overview of OpenCoop' })
  getLlmsTxt(): string {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const apiUrl = process.env.API_URL || 'http://localhost:3001';

    return `# OpenCoop
> Cooperative shareholding management platform

OpenCoop helps cooperatives manage shareholders, share classes, projects, and transactions.

## API
- Public coop info: GET ${apiUrl}/coops/{slug}/public-info
- Public project stats: GET ${apiUrl}/coops/{slug}/public-projects
- MCP server: POST ${apiUrl}/mcp (Streamable HTTP transport)

## Coops
Each cooperative has a public page at ${baseUrl}/{locale}/{slug} and a share purchase flow at ${baseUrl}/{locale}/{slug}/register.

### Deep link parameters for share purchase
- class={code} — Pre-select a share class (e.g. "A", "B")
- project={id} — Pre-select a project

Example: ${baseUrl}/nl/zonnecooperatie/register?class=A&project=abc123

## Full Data
See ${apiUrl}/llms-full.txt for a complete listing of all cooperatives, projects, and share purchase URLs.
`;
  }

  @Public()
  @Get('llms-full.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({ summary: 'Full public coop data for LLMs' })
  async getLlmsFullTxt(): Promise<string> {
    const now = Date.now();
    if (this.fullTextCache && this.fullTextCache.expiresAt > now) {
      return this.fullTextCache.text;
    }

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3002';

    const coops = await this.prisma.coop.findMany({
      where: { active: true },
      select: {
        slug: true,
        name: true,
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
        projects: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            description: true,
            type: true,
            capacityKw: true,
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const lines: string[] = ['# OpenCoop - Full Public Data\n'];

    for (const coop of coops) {
      lines.push(`## ${coop.name} (slug: ${coop.slug})\n`);

      if (coop.shareClasses.length > 0) {
        lines.push('### Share Classes');
        for (const sc of coop.shareClasses) {
          const max = sc.maxShares ? `max ${sc.maxShares}` : 'no max';
          const voting = sc.hasVotingRights ? 'yes' : 'no';
          lines.push(
            `- ${sc.name} (code: ${sc.code}): \u20AC${sc.pricePerShare.toNumber().toFixed(2)}/share (min ${sc.minShares}, ${max}, voting rights: ${voting})`,
          );
        }
        lines.push('');
      }

      if (coop.projects.length > 0) {
        lines.push('### Projects');
        for (const p of coop.projects) {
          const capacity = p.capacityKw
            ? ` \u2014 ${p.capacityKw.toNumber()} kW ${p.type.toLowerCase()}`
            : '';
          lines.push(`- ${p.name}${capacity}`);
          if (p.description) lines.push(`  ${p.description}`);
        }
        lines.push('');
      }

      // Generate purchase URLs for all class x project combinations
      lines.push('### Purchase URLs');
      for (const sc of coop.shareClasses) {
        lines.push(
          `- Buy ${sc.name} shares: ${baseUrl}/nl/${coop.slug}/register?class=${sc.code}`,
        );
        for (const p of coop.projects) {
          lines.push(
            `- Buy ${sc.name} for ${p.name}: ${baseUrl}/nl/${coop.slug}/register?class=${sc.code}&project=${p.id}`,
          );
        }
      }
      lines.push('');
    }

    const text = lines.join('\n');
    this.fullTextCache = { text, expiresAt: now + 5 * 60 * 1000 };
    return text;
  }
}
