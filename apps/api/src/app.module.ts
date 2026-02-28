import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
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
import { FeatureRequestsModule } from './modules/feature-requests/feature-requests.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { MigrationRequestsModule } from './modules/migration-requests/migration-requests.module';
import { BillingModule } from './modules/billing/billing.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
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
    FeatureRequestsModule,
    UploadsModule,
    MigrationRequestsModule,
    BillingModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
