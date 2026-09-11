import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { McpAuthStore } from './mcp-auth.store';
import { McpCoopTools } from './tools/mcp-coop.tools';
import { McpShareholderTools } from './tools/mcp-shareholder.tools';
import { McpTransactionTools } from './tools/mcp-transaction.tools';
import { McpAnalyticsTools } from './tools/mcp-analytics.tools';
import { McpMessageTools } from './tools/mcp-message.tools';
import { ShareholdersModule } from '../shareholders/shareholders.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { AdminModule } from '../admin/admin.module';
import { MessagesModule } from '../messages/messages.module';
import { CoopPermissionsService } from '../../common/utils/coop-permissions';

@Module({
  imports: [
    McpModule.forFeature(
      [McpCoopTools, McpShareholderTools, McpTransactionTools, McpAnalyticsTools, McpMessageTools],
      'opencoop',
    ),
    ShareholdersModule,
    RegistrationsModule,
    AdminModule,
    MessagesModule,
  ],
  providers: [
    McpAuthStore,
    McpCoopTools,
    McpShareholderTools,
    McpTransactionTools,
    McpAnalyticsTools,
    McpMessageTools,
    CoopPermissionsService,
  ],
  exports: [McpAuthStore],
})
export class McpToolsModule {}
