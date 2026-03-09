import { IsString, IsOptional, IsArray, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateConversationDto {
  @ApiProperty({ example: 'Uitnodiging Algemene Vergadering 2026' })
  @IsString()
  @MinLength(1)
  subject: string;

  @ApiProperty({ enum: ['BROADCAST', 'DIRECT'], example: 'BROADCAST' })
  @IsString()
  type: 'BROADCAST' | 'DIRECT';

  @ApiProperty({ example: 'Beste leden, ...' })
  @IsString()
  @MinLength(1)
  body: string;

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
