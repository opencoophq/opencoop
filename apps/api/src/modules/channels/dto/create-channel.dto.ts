import { IsString, IsOptional, IsArray, Matches, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateChannelDto {
  @ApiProperty({ example: 'my-channel', description: 'URL-friendly slug (lowercase, hyphens)' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase alphanumeric with optional hyphens',
  })
  slug: string;

  @ApiProperty({ example: 'My Channel', description: 'Display name' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ required: false, example: 'Channel description' })
  @IsOptional()
  @IsString()
  description?: string;

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

  @ApiProperty({ required: false, example: 'https://example.com/terms' })
  @IsOptional()
  @IsString()
  termsUrl?: string;

  @ApiProperty({ required: false, type: [String], description: 'Share class IDs to link' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shareClassIds?: string[];

  @ApiProperty({ required: false, type: [String], description: 'Project IDs to link' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  projectIds?: string[];
}
