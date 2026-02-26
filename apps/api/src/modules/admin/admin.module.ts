import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AnalyticsService } from './analytics.service';
import { ReportsService } from './reports.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ShareholdersModule } from '../shareholders/shareholders.module';
import { SharesModule } from '../shares/shares.module';
import { ProjectsModule } from '../projects/projects.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { PaymentsModule } from '../payments/payments.module';
import { BankImportModule } from '../bank-import/bank-import.module';
import { DividendsModule } from '../dividends/dividends.module';
import { DocumentsModule } from '../documents/documents.module';
import { CoopsModule } from '../coops/coops.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    PrismaModule,
    CoopsModule,
    BillingModule,
    ShareholdersModule,
    SharesModule,
    ProjectsModule,
    TransactionsModule,
    PaymentsModule,
    BankImportModule,
    DividendsModule,
    DocumentsModule,
  ],
  controllers: [AdminController],
  providers: [AnalyticsService, ReportsService],
  exports: [AnalyticsService, ReportsService],
})
export class AdminModule {}
