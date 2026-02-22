import { Module } from '@nestjs/common';
import { ShareClassesService } from './share-classes.service';
import { SharesService } from './shares.service';

@Module({
  providers: [ShareClassesService, SharesService],
  exports: [ShareClassesService, SharesService],
})
export class SharesModule {}
