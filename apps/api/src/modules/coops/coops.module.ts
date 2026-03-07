import { Module, forwardRef } from '@nestjs/common';
import { CoopsController } from './coops.controller';
import { CoopsService } from './coops.service';
import { ShareholdersModule } from '../shareholders/shareholders.module';
import { RegistrationsModule } from '../registrations/registrations.module';

@Module({
  imports: [forwardRef(() => ShareholdersModule), RegistrationsModule],
  controllers: [CoopsController],
  providers: [CoopsService],
  exports: [CoopsService],
})
export class CoopsModule {}
