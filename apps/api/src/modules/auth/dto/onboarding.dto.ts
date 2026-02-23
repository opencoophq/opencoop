import { IsEmail, IsString, MinLength, MaxLength, Matches, IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class OnboardingDto {
  @ApiProperty({ example: 'admin@mycoop.be' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'securepassword', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'My Cooperative' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  coopName: string;

  @ApiProperty({ example: 'my-cooperative' })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase letters, numbers, and dashes only',
  })
  coopSlug: string;

  @ApiProperty({ example: 'essentials', enum: ['essentials', 'professional'] })
  @IsIn(['essentials', 'professional'])
  plan: 'essentials' | 'professional';

  @ApiProperty({ example: 'yearly', enum: ['monthly', 'yearly'] })
  @IsIn(['monthly', 'yearly'])
  billingPeriod: 'monthly' | 'yearly';

  @ApiProperty({ example: 'nl', required: false })
  @IsOptional()
  @IsString()
  preferredLanguage?: string;
}
