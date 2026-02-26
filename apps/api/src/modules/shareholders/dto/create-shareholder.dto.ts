import {
  IsString,
  IsEmail,
  IsEnum,
  IsOptional,
  ValidateNested,
  IsArray,
  IsDateString,
  IsNumber,
  Min,
  Max,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ShareholderType } from '@opencoop/database';

export class AddressDto {
  @ApiProperty()
  @IsString()
  street: string;

  @ApiProperty()
  @IsString()
  number: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  box?: string;

  @ApiProperty()
  @IsString()
  postalCode: string;

  @ApiProperty()
  @IsString()
  city: string;

  @ApiProperty()
  @IsString()
  country: string;
}

class BeneficialOwnerDto {
  @ApiProperty()
  @IsString()
  firstName: string;

  @ApiProperty()
  @IsString()
  lastName: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nationalId?: string;

  @ApiProperty({ example: 25.5 })
  @IsNumber()
  @Min(0)
  @Max(100)
  ownershipPercentage: number;
}

export class CreateShareholderDto {
  @ApiProperty({ enum: ShareholderType })
  @IsEnum(ShareholderType)
  type: ShareholderType;

  // Individual/Minor fields
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
  @IsString()
  nationalId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  // Company fields
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiProperty({ required: false, description: 'Belgian company number (KBO/BCE)' })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  vatNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  legalForm?: string;

  // Contact fields
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

  // Bank details
  @ApiProperty({ required: false, description: 'IBAN for refunds' })
  @IsOptional()
  @IsString()
  bankIban?: string;

  @ApiProperty({ required: false, description: 'BIC for refunds' })
  @IsOptional()
  @IsString()
  bankBic?: string;

  // Beneficial owners for company
  @ApiProperty({ required: false, type: [BeneficialOwnerDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BeneficialOwnerDto)
  beneficialOwners?: BeneficialOwnerDto[];
}
