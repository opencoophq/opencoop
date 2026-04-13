import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import { McpModule, McpTransportType } from '@rekog/mcp-nest';
import { randomUUID } from 'crypto';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CoopsModule } from './modules/coops/coops.module';
import { ShareholdersModule } from './modules/shareholders/shareholders.module';
import { SharesModule } from './modules/shares/shares.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RegistrationsModule } from './modules/registrations/registrations.module';
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
import { HealthModule } from './modules/health/health.module';
import { AuditModule } from './modules/audit/audit.module';
import { CoopAdminsModule } from './modules/coop-admins/coop-admins.module';
import { AdminNotificationsModule } from './modules/admin-notifications/admin-notifications.module';
import { PontoModule } from './modules/ponto/ponto.module';
import { ExternalApiModule } from './modules/external-api/external-api.module';
import { ChangelogModule } from './modules/changelog/changelog.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { McpToolsModule } from './modules/mcp/mcp.module';
import { McpAuthMiddleware } from './modules/mcp/mcp-auth.middleware';

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
    AuditModule,
    AuthModule,
    UsersModule,
    CoopsModule,
    ShareholdersModule,
    SharesModule,
    ProjectsModule,
    RegistrationsModule,
    PaymentsModule,
    BankImportModule,
    PontoModule,
    DividendsModule,
    DocumentsModule,
    EmailModule,
    AdminModule,
    CoopAdminsModule,
    AdminNotificationsModule,
    SystemModule,
    FeatureRequestsModule,
    UploadsModule,
    MigrationRequestsModule,
    BillingModule,
    HealthModule,
    McpModule.forRoot({
      name: 'opencoop',
      version: '1.0.0',
      instructions:
        'OpenCoop public API for AI agents — query cooperative data and generate share purchase URLs',
      transport: McpTransportType.STREAMABLE_HTTP,
      capabilities: {
        tools: {},
      },
      streamableHttp: {
        sessionIdGenerator: () => randomUUID(),
      },
    }),
    ExternalApiModule,
    ChangelogModule,
    ApiKeysModule,
    McpToolsModule,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(McpAuthMiddleware).forRoutes('mcp');
  }
}
