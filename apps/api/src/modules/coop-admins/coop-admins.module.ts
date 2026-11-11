import { Module } from '@nestjs/common';
import { CoopAdminsController } from './coop-admins.controller';
import { CoopAdminsService } from './coop-admins.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { AuthEmailService } from '../auth/auth-email.service';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [CoopAdminsController],
  providers: [CoopAdminsService, AuthEmailService],
  exports: [CoopAdminsService],
})
export class CoopAdminsModule {}
