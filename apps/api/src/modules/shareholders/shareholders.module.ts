import { Module } from '@nestjs/common';
import { ShareholdersService } from './shareholders.service';
import { BirthdaySchedulerService } from './birthday-scheduler.service';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [AuthModule, EmailModule],
  providers: [ShareholdersService, BirthdaySchedulerService],
  exports: [ShareholdersService],
})
export class ShareholdersModule {}
