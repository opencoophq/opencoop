import { Module } from '@nestjs/common';
import { McpAuthStore } from './mcp-auth.store';

@Module({
  providers: [McpAuthStore],
  exports: [McpAuthStore],
})
export class McpToolsModule {}
