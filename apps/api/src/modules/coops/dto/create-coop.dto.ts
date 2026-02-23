import { IsString, IsBoolean, IsOptional, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCoopDto {
  @ApiProperty({ example: 'my-coop' })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must be lowercase alphanumeric with dashes' })
  slug: string;

  @ApiProperty({ example: 'My Cooperative' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: '001', description: 'Unique 3-digit prefix for OGM codes (auto-generated if not provided)', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d{3}$/, { message: 'OGM prefix must be exactly 3 digits' })
  ogmPrefix?: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiProperty({ example: '#1e40af', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Must be a valid hex color' })
  primaryColor?: string;

  @ApiProperty({ example: '#3b82f6', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Must be a valid hex color' })
  secondaryColor?: string;
}
