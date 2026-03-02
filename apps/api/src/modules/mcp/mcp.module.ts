import { Module } from '@nestjs/common';
import { McpTools } from './mcp.tools';

@Module({
  providers: [McpTools],
})
export class McpToolsModule {}
