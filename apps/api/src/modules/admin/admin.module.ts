import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AnalyticsService } from './analytics.service';
import { ReportsService } from './reports.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ShareholdersModule } from '../shareholders/shareholders.module';
import { SharesModule } from '../shares/shares.module';
import { ProjectsModule } from '../projects/projects.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { BankImportModule } from '../bank-import/bank-import.module';
import { DividendsModule } from '../dividends/dividends.module';
import { DocumentsModule } from '../documents/documents.module';
import { CoopsModule } from '../coops/coops.module';
import { ChannelsModule } from '../channels/channels.module';
import { BillingModule } from '../billing/billing.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [
    PrismaModule,
    CoopsModule,
    ChannelsModule,
    BillingModule,
    ShareholdersModule,
    SharesModule,
    ProjectsModule,
    RegistrationsModule,
    BankImportModule,
    DividendsModule,
    DocumentsModule,
    MessagesModule,
  ],
  controllers: [AdminController],
  providers: [AnalyticsService, ReportsService],
  exports: [AnalyticsService, ReportsService],
})
export class AdminModule {}
