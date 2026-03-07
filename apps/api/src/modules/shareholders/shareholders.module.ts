import { Module, forwardRef } from '@nestjs/common';
import { ShareholdersService } from './shareholders.service';
import { ShareholderActionsController } from './shareholder-actions.controller';
import { BirthdaySchedulerService } from './birthday-scheduler.service';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [forwardRef(() => AuthModule), EmailModule, RegistrationsModule, DocumentsModule],
  controllers: [ShareholderActionsController],
  providers: [ShareholdersService, BirthdaySchedulerService],
  exports: [ShareholdersService],
})
export class ShareholdersModule {}
