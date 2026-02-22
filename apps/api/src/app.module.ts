import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CoopsModule } from './modules/coops/coops.module';
import { ShareholdersModule } from './modules/shareholders/shareholders.module';
import { SharesModule } from './modules/shares/shares.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { BankImportModule } from './modules/bank-import/bank-import.module';
import { DividendsModule } from './modules/dividends/dividends.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { EmailModule } from './modules/email/email.module';
import { AdminModule } from './modules/admin/admin.module';
import { SystemModule } from './modules/system/system.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      redis: {
        host: new URL(process.env.REDIS_URL || 'redis://localhost:6379').hostname,
        port: parseInt(new URL(process.env.REDIS_URL || 'redis://localhost:6379').port || '6379', 10),
      },
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CoopsModule,
    ShareholdersModule,
    SharesModule,
    ProjectsModule,
    TransactionsModule,
    PaymentsModule,
    BankImportModule,
    DividendsModule,
    DocumentsModule,
    EmailModule,
    AdminModule,
    SystemModule,
  ],
})
export class AppModule {}
