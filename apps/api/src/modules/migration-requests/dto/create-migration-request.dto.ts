import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMigrationRequestDto {
  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'My Cooperative' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  coopName: string;

  @ApiProperty({ example: '50-100', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  estimatedShareholders?: string;

  @ApiProperty({ example: 'Excel spreadsheets', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  currentSystem?: string;

  @ApiProperty({ example: 'We have 5 years of shareholder data in Excel...' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message: string;

  @ApiProperty({ example: 'en', required: false })
  @IsOptional()
  @IsString()
  locale?: string;
}
