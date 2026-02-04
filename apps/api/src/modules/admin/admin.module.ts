import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
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

@Module({
  imports: [
    PrismaModule,
    CoopsModule,
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
})
export class AdminModule {}
