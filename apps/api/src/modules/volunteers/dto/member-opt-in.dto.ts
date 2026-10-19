import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class MemberVolunteerOptInDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  interests: string[];

  @ApiProperty({ description: 'Explicit consent. Must be true.' })
  @IsBoolean()
  consent: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiProperty({ required: false, description: 'Defaults to the shareholder postcode' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  postalCode?: string;

  @ApiProperty({ required: false, description: 'Defaults to the shareholder city' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  municipality?: string;
}
