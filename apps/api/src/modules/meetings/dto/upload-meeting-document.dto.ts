import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UploadMeetingDocumentDto {
  @ApiPropertyOptional({ description: 'Display name shown in UI/mail. Defaults to original filename.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;
}
