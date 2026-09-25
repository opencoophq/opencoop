import { IsString, IsOptional, MinLength, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { AudienceDto } from './audience.dto';

export class UpdateDraftDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  subject?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;

  @ApiProperty({ required: false, enum: ['TEXT', 'HTML'] })
  @IsOptional()
  @IsIn(['TEXT', 'HTML'])
  format?: 'TEXT' | 'HTML';

  @ApiProperty({ required: false, type: AudienceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AudienceDto)
  audience?: AudienceDto;
}
