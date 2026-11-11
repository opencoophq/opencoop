import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpsertSenderDomainDto {
  @ApiProperty({ example: 'bronsgroen.be' })
  @IsString()
  @MaxLength(253)
  domain: string;

  @ApiProperty({ example: 'noreply@bronsgroen.be' })
  @IsString()
  @MaxLength(320)
  fromAddress: string;

  @ApiProperty({ required: false, example: 'Bronsgroen' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fromName?: string;
}
