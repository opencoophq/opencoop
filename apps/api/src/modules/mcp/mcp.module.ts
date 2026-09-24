import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { McpAuthStore } from './mcp-auth.store';
import { McpCoopTools } from './tools/mcp-coop.tools';
import { McpShareholderTools } from './tools/mcp-shareholder.tools';
import { McpTransactionTools } from './tools/mcp-transaction.tools';
import { McpAnalyticsTools } from './tools/mcp-analytics.tools';
import { McpMessageTools } from './tools/mcp-message.tools';
import { McpCatalogTools } from './tools/mcp-catalog.tools';
import { ShareholdersModule } from '../shareholders/shareholders.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { AdminModule } from '../admin/admin.module';
import { MessagesModule } from '../messages/messages.module';
import { SharesModule } from '../shares/shares.module';
import { ProjectsModule } from '../projects/projects.module';
import { ChannelsModule } from '../channels/channels.module';
import { CoopsModule } from '../coops/coops.module';
import { CoopPermissionsService } from '../../common/utils/coop-permissions';
import { BillingModule } from '../billing/billing.module';
import { PaymentsModule } from '../payments/payments.module';
import { McpToolkit } from './mcp-toolkit';

@Module({
  imports: [
    McpModule.forFeature(
      [
        McpCoopTools,
        McpShareholderTools,
        McpTransactionTools,
        McpAnalyticsTools,
        McpMessageTools,
        McpCatalogTools,
      ],
      'opencoop',
    ),
    ShareholdersModule,
    RegistrationsModule,
    AdminModule,
    MessagesModule,
    SharesModule,
    ProjectsModule,
    ChannelsModule,
    CoopsModule,
    BillingModule,
    PaymentsModule,
  ],
  providers: [
    McpAuthStore,
    McpCoopTools,
    McpShareholderTools,
    McpTransactionTools,
    McpAnalyticsTools,
    McpMessageTools,
    McpCatalogTools,
    CoopPermissionsService,
    McpToolkit,
  ],
  exports: [McpAuthStore, McpToolkit],
})
export class McpToolsModule {}
