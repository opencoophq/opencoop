import { IsString, IsOptional, MaxLength, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiProperty({ example: 'John Doe', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ example: 'nl', required: false, enum: ['nl', 'en', 'fr', 'de'] })
  @IsOptional()
  @IsString()
  @IsIn(['nl', 'en', 'fr', 'de'])
  preferredLanguage?: string;
}
