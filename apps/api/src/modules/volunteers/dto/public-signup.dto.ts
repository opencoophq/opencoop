import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class PublicVolunteerSignupDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(200)
  email: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(12)
  postalCode: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  municipality: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  interests: string[];

  @ApiProperty({ description: 'Must be true. The checkbox starts unticked.' })
  @IsBoolean()
  consent: boolean;

  @ApiProperty({ required: false, description: 'nl, en, fr or de' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  locale?: string;

  @ApiProperty({ required: false, description: 'Leave empty. Filled values are treated as spam.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class VolunteerTokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(16)
  @MaxLength(200)
  token: string;
}
