import { Module, forwardRef } from '@nestjs/common';
import { RegistrationsService } from './registrations.service';
import { DocumentsModule } from '../documents/documents.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [forwardRef(() => DocumentsModule), EmailModule],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
