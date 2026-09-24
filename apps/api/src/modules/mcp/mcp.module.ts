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
import { ShareholdersModule } from '../shareholders/shareholders.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { AdminModule } from '../admin/admin.module';
import { MessagesModule } from '../messages/messages.module';
import { CoopPermissionsService } from '../../common/utils/coop-permissions';
import { BillingModule } from '../billing/billing.module';
import { BankImportModule } from '../bank-import/bank-import.module';
import { DividendsModule } from '../dividends/dividends.module';
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
      ],
      'opencoop',
    ),
    ShareholdersModule,
    RegistrationsModule,
    AdminModule,
    MessagesModule,
    BillingModule,
    BankImportModule,
    DividendsModule,
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
    CoopPermissionsService,
    McpToolkit,
  ],
  exports: [McpAuthStore, McpToolkit],
})
export class McpToolsModule {}
