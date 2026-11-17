import { Controller, Get, Header } from '@nestjs/common';
import { McpRegistryDiscoveryService } from '@rekog/mcp-nest';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';

// Same name, version, and instructions that McpModule.forRoot registers in app.module.ts.
export const MCP_SERVER_INFO = {
  name: 'opencoop',
  title: 'OpenCoop MCP',
  version: '1.0.0',
  instructions:
    "OpenCoop admin API — query your cooperative's shareholders, transactions, analytics, and more. Authenticated via API key.",
};

// Public MCP URL for the card. MCP_PUBLIC_URL wins when the API container has it;
// otherwise FRONTEND_URL + /api/mcp, which Caddy routes to this API on opencoop.be.
export function mcpPublicUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MCP_PUBLIC_URL) return env.MCP_PUBLIC_URL;
  const frontendUrl = (env.FRONTEND_URL || 'http://localhost:3002').replace(/\/+$/, '');
  return `${frontendUrl}/api/mcp`;
}

/**
 * MCP server card for Cloudflare Agent Readiness (isitagentready.com).
 * The tool list comes from the live @rekog/mcp-nest registry, the same source as tools/list.
 */
@Controller('.well-known/mcp')
export class McpServerCardController {
  constructor(private readonly registry: McpRegistryDiscoveryService) {}

  @Get('server-card.json')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'public, max-age=300')
  getServerCard() {
    const moduleIds = this.registry.getMcpModuleIds();
    if (moduleIds.length !== 1) {
      throw new Error(`Expected one MCP server, found ${moduleIds.length}`);
    }

    const tools = this.registry.getTools(moduleIds[0]).map(({ metadata }) => {
      const parameters = normalizeObjectSchema(metadata.parameters);
      return {
        name: metadata.name,
        description: metadata.description,
        ...(metadata.annotations ? { annotations: metadata.annotations } : {}),
        ...(parameters ? { inputSchema: toJsonSchemaCompat(parameters) } : {}),
      };
    });

    return {
      $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
      version: '1.0',
      protocolVersion: LATEST_PROTOCOL_VERSION,
      serverInfo: {
        name: MCP_SERVER_INFO.name,
        title: MCP_SERVER_INFO.title,
        version: MCP_SERVER_INFO.version,
      },
      description: MCP_SERVER_INFO.instructions,
      transport: { type: 'streamable-http', endpoint: mcpPublicUrl() },
      authentication: {
        required: true,
        schemes: ['bearer'],
        description:
          'Send Authorization: Bearer oc_<key>. Coop admins create API keys in the OpenCoop dashboard.',
      },
      tools,
    };
  }
}
