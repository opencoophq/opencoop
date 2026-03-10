import { Module } from '@nestjs/common';
import { ExternalApiController } from './external-api.controller';
import { ExternalApiService } from './external-api.service';
import { ApiKeyThrottleGuard } from './api-key-throttle.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { CoopsModule } from '../coops/coops.module';

@Module({
  imports: [PrismaModule, CoopsModule],
  controllers: [ExternalApiController],
  providers: [ExternalApiService, ApiKeyThrottleGuard],
})
export class ExternalApiModule {}
