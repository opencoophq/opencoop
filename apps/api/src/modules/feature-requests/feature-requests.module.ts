import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { FeatureRequestsController } from './feature-requests.controller';
import { FeatureRequestsService } from './feature-requests.service';

@Module({
  imports: [EmailModule],
  controllers: [FeatureRequestsController],
  providers: [FeatureRequestsService],
})
export class FeatureRequestsModule {}
