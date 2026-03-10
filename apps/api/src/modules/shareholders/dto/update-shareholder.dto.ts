import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { CreateShareholderDto } from './create-shareholder.dto';
import { ShareholderStatus } from '@opencoop/database';

export class UpdateShareholderDto extends PartialType(CreateShareholderDto) {
  @IsOptional()
  @IsEnum(ShareholderStatus)
  status?: ShareholderStatus;

  @IsOptional()
  @IsBoolean()
  isEcoPowerClient?: boolean;

  @IsOptional()
  @IsString()
  ecoPowerId?: string | null;
}
