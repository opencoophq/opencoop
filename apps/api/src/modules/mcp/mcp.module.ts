import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { McpAuthStore } from './mcp-auth.store';
import { McpCoopTools } from './tools/mcp-coop.tools';
import { McpShareholderTools } from './tools/mcp-shareholder.tools';
import { McpTransactionTools } from './tools/mcp-transaction.tools';
import { McpAnalyticsTools } from './tools/mcp-analytics.tools';
import { McpMessageTools } from './tools/mcp-message.tools';
import { McpBankTools } from './tools/mcp-bank.tools';
import { McpDividendTools } from './tools/mcp-dividend.tools';
import { McpCatalogTools } from './tools/mcp-catalog.tools';
import { McpMeetingTools } from './tools/mcp-meeting.tools';
import { McpReportTools } from './tools/mcp-report.tools';
import { ShareholdersModule } from '../shareholders/shareholders.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { AdminModule } from '../admin/admin.module';
import { MessagesModule } from '../messages/messages.module';
import { SharesModule } from '../shares/shares.module';
import { ProjectsModule } from '../projects/projects.module';
import { ChannelsModule } from '../channels/channels.module';
import { CoopsModule } from '../coops/coops.module';
import { DocumentsModule } from '../documents/documents.module';
import { AuditModule } from '../audit/audit.module';
import { CoopPermissionsService } from '../../common/utils/coop-permissions';
import { BillingModule } from '../billing/billing.module';
import { BankImportModule } from '../bank-import/bank-import.module';
import { DividendsModule } from '../dividends/dividends.module';
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
        McpBankTools,
        McpDividendTools,
        McpCatalogTools,
        McpMeetingTools,
        McpReportTools,
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
    DocumentsModule,
    AuditModule,
    BillingModule,
    BankImportModule,
    DividendsModule,
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
    McpBankTools,
    McpDividendTools,
    McpCatalogTools,
    McpMeetingTools,
    McpReportTools,
    CoopPermissionsService,
    McpToolkit,
  ],
  exports: [McpAuthStore, McpToolkit],
})
export class McpToolsModule {}
