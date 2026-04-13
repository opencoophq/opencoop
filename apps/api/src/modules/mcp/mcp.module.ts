import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { McpAuthStore } from './mcp-auth.store';
import { McpCoopTools } from './tools/mcp-coop.tools';
import { McpShareholderTools } from './tools/mcp-shareholder.tools';
import { McpTransactionTools } from './tools/mcp-transaction.tools';
import { McpAnalyticsTools } from './tools/mcp-analytics.tools';
import { ShareholdersModule } from '../shareholders/shareholders.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    McpModule.forFeature(
      [McpCoopTools, McpShareholderTools, McpTransactionTools, McpAnalyticsTools],
      'opencoop',
    ),
    ShareholdersModule,
    RegistrationsModule,
    AdminModule,
  ],
  providers: [
    McpAuthStore,
    McpCoopTools,
    McpShareholderTools,
    McpTransactionTools,
    McpAnalyticsTools,
  ],
  exports: [McpAuthStore],
})
export class McpToolsModule {}
