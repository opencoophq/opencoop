import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';

@Module({
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
