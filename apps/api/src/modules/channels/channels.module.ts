import { Module, forwardRef } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ShareholdersModule } from '../shareholders/shareholders.module';
import { RegistrationsModule } from '../registrations/registrations.module';

@Module({
  imports: [forwardRef(() => ShareholdersModule), RegistrationsModule],
  controllers: [ChannelsController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
