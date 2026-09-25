import { IsString, IsOptional, IsArray, MinLength, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { AudienceDto } from './audience.dto';

export class CreateConversationDto {
  @ApiProperty({ example: 'Uitnodiging Algemene Vergadering 2026' })
  @IsString()
  @MinLength(1)
  subject: string;

  @ApiProperty({ enum: ['BROADCAST', 'DIRECT'], example: 'BROADCAST' })
  @IsIn(['BROADCAST', 'DIRECT'])
  type: 'BROADCAST' | 'DIRECT';

  @ApiProperty({ example: '<p>Beste leden, ...</p>' })
  @IsString()
  @MinLength(1)
  body: string;

  @ApiProperty({ required: false, enum: ['TEXT', 'HTML'], description: 'Default TEXT' })
  @IsOptional()
  @IsIn(['TEXT', 'HTML'])
  format?: 'TEXT' | 'HTML';

  @ApiProperty({ required: false, enum: ['DRAFT', 'SENT'], description: 'Default SENT (send immediately)' })
  @IsOptional()
  @IsIn(['DRAFT', 'SENT'])
  status?: 'DRAFT' | 'SENT';

  @ApiProperty({ required: false, type: AudienceDto, description: 'BROADCAST only. Default ALL.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AudienceDto)
  audience?: AudienceDto;

  @ApiProperty({ required: false, description: 'Required for DIRECT type' })
  @IsOptional()
  @IsString()
  shareholderId?: string;

  @ApiProperty({ required: false, description: 'IDs of existing ShareholderDocuments to attach' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  existingDocumentIds?: string[];
}
