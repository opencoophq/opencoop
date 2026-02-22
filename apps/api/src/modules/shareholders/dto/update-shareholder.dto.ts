import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateShareholderDto } from './create-shareholder.dto';
import { ShareholderStatus } from '@opencoop/database';

export class UpdateShareholderDto extends PartialType(CreateShareholderDto) {
  @IsOptional()
  @IsEnum(ShareholderStatus)
  status?: ShareholderStatus;
}
