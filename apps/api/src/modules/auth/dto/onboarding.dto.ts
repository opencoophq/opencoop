import { IsEmail, IsString, MinLength, MaxLength, Matches, IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class OnboardingDto {
  @ApiProperty({ example: 'admin@mycoop.be' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Securepass1', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain at least one lowercase letter, one uppercase letter, and one digit',
  })
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

  @ApiProperty({ example: 'essentials', enum: ['free', 'essentials', 'professional'] })
  @IsIn(['free', 'essentials', 'professional'])
  plan: 'free' | 'essentials' | 'professional';

  @ApiProperty({ example: 'yearly', enum: ['monthly', 'yearly'], required: false })
  @IsOptional()
  @IsIn(['monthly', 'yearly'])
  billingPeriod?: 'monthly' | 'yearly';

  @ApiProperty({ example: 'John Doe', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ example: 'nl', required: false })
  @IsOptional()
  @IsString()
  preferredLanguage?: string;
}
