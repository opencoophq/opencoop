import { Module, forwardRef } from '@nestjs/common';
import { ShareholdersService } from './shareholders.service';
import { ShareholderImportService } from './shareholder-import.service';
import { ShareholderActionsController } from './shareholder-actions.controller';
import { HouseholdController } from './household.controller';
import { HouseholdService } from './household.service';
import { BirthdaySchedulerService } from './birthday-scheduler.service';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { DocumentsModule } from '../documents/documents.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [forwardRef(() => AuthModule), EmailModule, RegistrationsModule, DocumentsModule, MessagesModule],
  controllers: [ShareholderActionsController, HouseholdController],
  providers: [ShareholdersService, ShareholderImportService, BirthdaySchedulerService, HouseholdService],
  exports: [ShareholdersService, ShareholderImportService],
})
export class ShareholdersModule {}
