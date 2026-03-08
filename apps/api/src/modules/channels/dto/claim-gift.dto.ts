import {
  IsString,
  IsEmail,
  IsOptional,
  IsDateString,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { AddressDto } from '../../shareholders/dto/create-shareholder.dto';

export class ClaimGiftDto {
  @ApiProperty({ description: 'Gift code (format: XXXX-XXXX)' })
  @IsString()
  giftCode: string;

  @ApiProperty()
  @IsString()
  firstName: string;

  @ApiProperty()
  @IsString()
  lastName: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiProperty()
  @IsEmail()
  email: string;

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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nationalId?: string;
}
