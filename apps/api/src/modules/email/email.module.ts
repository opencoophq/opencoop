import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';
import { SenderDomainService } from './sender-domain.service';
import { SenderDomainScheduler } from './sender-domain.scheduler';
import { SenderDomainProofChecker } from './sender-domain-proof';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'email',
    }),
  ],
  providers: [
    EmailService,
    EmailProcessor,
    SenderDomainService,
    SenderDomainScheduler,
    SenderDomainProofChecker,
  ],
  exports: [EmailService, EmailProcessor, SenderDomainService],
})
export class EmailModule {}
