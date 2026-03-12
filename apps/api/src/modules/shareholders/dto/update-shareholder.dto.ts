import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CreateShareholderDto } from './create-shareholder.dto';
import { ShareholderStatus } from '@opencoop/database';

export class UpdateShareholderDto extends PartialType(CreateShareholderDto) {
  @IsOptional()
  @IsEnum(ShareholderStatus)
  status?: ShareholderStatus;

  @ApiProperty({ required: false, description: 'Parent/guardian user ID (required when type is MINOR)' })
  @IsOptional()
  @IsString()
  registeredByUserId?: string | null;

  @IsOptional()
  @IsBoolean()
  isEcoPowerClient?: boolean;

  @IsOptional()
  @IsString()
  ecoPowerId?: string | null;
}
