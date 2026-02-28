import {
  IsString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsNumber,
  IsDateString,
  ValidateNested,
  IsObject,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ShareholderType } from '@opencoop/database';
import { AddressDto } from '../../shareholders/dto/create-shareholder.dto';

export class PublicRegisterDto {
  // === Existing shareholder (skip creation) ===
  @ApiProperty({ required: false, description: 'ID of existing shareholder (skip creation)' })
  @IsOptional()
  @IsString()
  shareholderId?: string;

  // === New shareholder fields (required when no shareholderId) ===
  @ApiProperty({ required: false, enum: ShareholderType })
  @IsOptional()
  @IsEnum(ShareholderType)
  type?: ShareholderType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  vatNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ required: false, type: AddressDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  // === Purchase fields (always required) ===
  @ApiProperty({ description: 'Share class to purchase' })
  @IsString()
  shareClassId: string;

  @ApiProperty({ description: 'Number of shares to purchase' })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ required: false, description: 'Project to link the purchase to' })
  @IsOptional()
  @IsString()
  projectId?: string;
}
