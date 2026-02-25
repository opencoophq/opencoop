import { IsString, IsOptional, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateBrandingDto {
  @ApiProperty({ required: false, example: '#1e40af' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Must be a valid hex color' })
  primaryColor?: string;

  @ApiProperty({ required: false, example: '#3b82f6' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Must be a valid hex color' })
  secondaryColor?: string;
}
