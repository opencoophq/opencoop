# AI-Accessible API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add MCP server and llms.txt endpoints to the OpenCoop API so AI agents can query public coop data and generate share purchase URLs.

**Architecture:** Use `@rekog/mcp-nest` to add MCP tools to the NestJS API with Streamable HTTP transport at `POST /mcp`. Add a lightweight `llms` module for `GET /llms.txt` and `GET /llms-full.txt` plain text endpoints. Both modules delegate to existing `CoopsService` and `PrismaService` — no schema changes.

**Tech Stack:** NestJS 10, `@rekog/mcp-nest`, `@modelcontextprotocol/sdk`, zod@^4, Prisma

**Design doc:** `docs/plans/2026-03-02-ai-accessible-api-design.md`

---

### Task 1: Install MCP dependencies

**Files:**
- Modify: `apps/api/package.json`

**Step 1: Install packages**

Run from repo root:
```bash
cd apps/api && pnpm add @rekog/mcp-nest @modelcontextprotocol/sdk zod
```

**Step 2: Verify installation**

Run: `cd apps/api && pnpm list @rekog/mcp-nest @modelcontextprotocol/sdk zod`
Expected: All three packages listed with versions.

**Step 3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "feat: add MCP server dependencies"
```

---

### Task 2: Register McpModule in AppModule

**Files:**
- Modify: `apps/api/src/app.module.ts`

**Step 1: Add McpModule import**

At the top of `apps/api/src/app.module.ts`, add:
```typescript
import { McpModule } from '@rekog/mcp-nest';
```

In the `imports` array, add (after the last module):
```typescript
McpModule.forRoot({
  name: 'opencoop',
  version: '1.0.0',
  description: 'OpenCoop public API for AI agents — query cooperative data and generate share purchase URLs',
  capabilities: {
    tools: {},
  },
}),
```

No `guards` property — this keeps it fully public.

**Step 2: Verify the API starts**

Run: `cd apps/api && pnpm build`
Expected: Build succeeds. The MCP module auto-registers `/mcp` endpoint.

**Step 3: Commit**

```bash
git add apps/api/src/app.module.ts
git commit -m "feat: register MCP module in app"
```

---

### Task 3: Create MCP tools provider

**Files:**
- Create: `apps/api/src/modules/mcp/mcp.tools.ts`
- Create: `apps/api/src/modules/mcp/mcp.module.ts`

**Step 1: Create the MCP module directory**

```bash
mkdir -p apps/api/src/modules/mcp
```

**Step 2: Create the tools provider**

Create `apps/api/src/modules/mcp/mcp.tools.ts`:

```typescript
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
      where: { isActive: true },
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
      'List active projects for a cooperative. Returns project details including type, capacity, and live investment stats (shares sold, capital raised, shareholder count).',
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
      projectId: z
        .string()
        .optional()
        .describe('Project ID to pre-select'),
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
```

**Step 3: Create the MCP module**

Create `apps/api/src/modules/mcp/mcp.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { McpTools } from './mcp.tools';

@Module({
  providers: [McpTools],
})
export class McpToolsModule {}
```

**Step 4: Register in AppModule**

In `apps/api/src/app.module.ts`, add import:
```typescript
import { McpToolsModule } from './modules/mcp/mcp.module';
```

Add `McpToolsModule` to the `imports` array.

**Step 5: Verify build**

Run: `cd apps/api && pnpm build`
Expected: Build succeeds.

**Step 6: Commit**

```bash
git add apps/api/src/modules/mcp/
git commit -m "feat: add MCP tools for public coop data"
```

---

### Task 4: Create llms.txt controller

**Files:**
- Create: `apps/api/src/modules/llms/llms.controller.ts`
- Create: `apps/api/src/modules/llms/llms.module.ts`

**Step 1: Create directory**

```bash
mkdir -p apps/api/src/modules/llms
```

**Step 2: Create the controller**

Create `apps/api/src/modules/llms/llms.controller.ts`:

```typescript
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
      where: { isActive: true },
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
            `- ${sc.name} (code: ${sc.code}): €${sc.pricePerShare.toNumber().toFixed(2)}/share (min ${sc.minShares}, ${max}, voting rights: ${voting})`,
          );
        }
        lines.push('');
      }

      if (coop.projects.length > 0) {
        lines.push('### Projects');
        for (const p of coop.projects) {
          const capacity = p.capacityKw ? ` — ${p.capacityKw.toNumber()} kW ${p.type.toLowerCase()}` : '';
          lines.push(`- ${p.name}${capacity}`);
          if (p.description) lines.push(`  ${p.description}`);
        }
        lines.push('');
      }

      // Generate purchase URLs for all class × project combinations
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
```

**Step 3: Create the module**

Create `apps/api/src/modules/llms/llms.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { LlmsController } from './llms.controller';

@Module({
  controllers: [LlmsController],
})
export class LlmsModule {}
```

**Step 4: Register in AppModule**

In `apps/api/src/app.module.ts`, add:
```typescript
import { LlmsModule } from './modules/llms/llms.module';
```

Add `LlmsModule` to the `imports` array.

**Step 5: Verify build**

Run: `cd apps/api && pnpm build`
Expected: Build succeeds.

**Step 6: Commit**

```bash
git add apps/api/src/modules/llms/
git commit -m "feat: add llms.txt endpoints for AI discoverability"
```

---

### Task 5: Manual smoke test

**Step 1: Start the API**

Run: `pnpm dev` (from repo root)

**Step 2: Test llms.txt**

Run: `curl http://localhost:3001/llms.txt`
Expected: Plain text overview of OpenCoop with API URLs.

**Step 3: Test llms-full.txt**

Run: `curl http://localhost:3001/llms-full.txt`
Expected: Full data dump with coops, share classes, projects, and purchase URLs.

**Step 4: Test MCP endpoint**

Run:
```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
Expected: JSON response listing all 5 tools (list_coops, get_coop_info, list_projects, list_share_classes, get_share_purchase_url).

**Step 5: Test a tool call**

Run:
```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_coops","arguments":{}}}'
```
Expected: JSON response with array of active coops.

**Step 6: Final commit with any fixes**

If any adjustments were needed during testing, commit them.

---

### Task 6: Update CLAUDE.md and documentation

**Files:**
- Modify: `.claude/CLAUDE.md`
- Modify: `docs/plans/2026-03-02-ai-accessible-api-design.md`

**Step 1: Add MCP info to CLAUDE.md**

Add to the "API Documentation" section of `.claude/CLAUDE.md`:

```markdown
## AI Integration

- **MCP Server:** `POST /mcp` — Streamable HTTP transport, public, no auth. Tools: `list_coops`, `get_coop_info`, `list_projects`, `list_share_classes`, `get_share_purchase_url`
- **llms.txt:** `GET /llms.txt` — Plain text API overview for LLMs
- **llms-full.txt:** `GET /llms-full.txt` — Full public data dump (cached 5 min)
```

**Step 2: Update design doc status**

Change status in `docs/plans/2026-03-02-ai-accessible-api-design.md` from "Approved" to "Implemented".

**Step 3: Commit**

```bash
git add .claude/CLAUDE.md docs/plans/2026-03-02-ai-accessible-api-design.md
git commit -m "docs: add MCP server and llms.txt documentation"
```
