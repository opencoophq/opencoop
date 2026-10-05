import { Module } from '@nestjs/common';
import { OgmService } from './ogm.service';

@Module({
  providers: [OgmService],
  exports: [OgmService],
})
export class OgmModule {}
