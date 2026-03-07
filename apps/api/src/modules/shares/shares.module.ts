import { Module } from '@nestjs/common';
import { ShareClassesService } from './share-classes.service';

@Module({
  providers: [ShareClassesService],
  exports: [ShareClassesService],
})
export class SharesModule {}
