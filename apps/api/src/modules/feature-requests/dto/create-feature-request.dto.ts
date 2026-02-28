import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateFeatureRequestDto {
  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Dark mode support' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'It would be great to have a dark mode option...' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  description: string;

  @ApiProperty({ example: 'en', required: false })
  @IsOptional()
  @IsString()
  locale?: string;

  @ApiProperty({ example: 'feature', required: false, enum: ['feature', 'bug'] })
  @IsOptional()
  @IsIn(['feature', 'bug'])
  type?: 'feature' | 'bug';
}
