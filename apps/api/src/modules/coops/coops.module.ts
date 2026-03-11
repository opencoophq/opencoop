import { Module, forwardRef } from '@nestjs/common';
import { CoopsController } from './coops.controller';
import { CoopsService } from './coops.service';
import { ShareholdersModule } from '../shareholders/shareholders.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [forwardRef(() => ShareholdersModule), RegistrationsModule, EmailModule],
  controllers: [CoopsController],
  providers: [CoopsService],
  exports: [CoopsService],
})
export class CoopsModule {}
