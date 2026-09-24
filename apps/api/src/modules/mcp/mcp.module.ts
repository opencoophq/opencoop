import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { McpAuthStore } from './mcp-auth.store';
import { McpCoopTools } from './tools/mcp-coop.tools';
import { McpShareholderTools } from './tools/mcp-shareholder.tools';
import { McpTransactionTools } from './tools/mcp-transaction.tools';
import { McpAnalyticsTools } from './tools/mcp-analytics.tools';
import { McpMessageTools } from './tools/mcp-message.tools';
import { McpMeetingTools } from './tools/mcp-meeting.tools';
import { ShareholdersModule } from '../shareholders/shareholders.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { AdminModule } from '../admin/admin.module';
import { MessagesModule } from '../messages/messages.module';
import { CoopPermissionsService } from '../../common/utils/coop-permissions';
import { BillingModule } from '../billing/billing.module';
import { PaymentsModule } from '../payments/payments.module';
import { MeetingsModule } from '../meetings/meetings.module';
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
        McpMeetingTools,
      ],
      'opencoop',
    ),
    ShareholdersModule,
    RegistrationsModule,
    AdminModule,
    MessagesModule,
    BillingModule,
    PaymentsModule,
    MeetingsModule,
  ],
  providers: [
    McpAuthStore,
    McpCoopTools,
    McpShareholderTools,
    McpTransactionTools,
    McpAnalyticsTools,
    McpMessageTools,
    McpMeetingTools,
    CoopPermissionsService,
    McpToolkit,
  ],
  exports: [McpAuthStore, McpToolkit],
})
export class McpToolsModule {}
