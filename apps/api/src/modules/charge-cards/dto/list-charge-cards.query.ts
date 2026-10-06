import { ApiProperty } from '@nestjs/swagger';
import { ChargeCardStatus } from '@opencoop/database';
import { IsEnum, IsIn, IsOptional } from 'class-validator';

export class ListChargeCardsQueryDto {
  @ApiProperty({ required: false, enum: ChargeCardStatus })
  @IsOptional()
  @IsEnum(ChargeCardStatus)
  status?: ChargeCardStatus;

  // A string, not a boolean: enableImplicitConversion turns "false" into true.
  @ApiProperty({ required: false, enum: ['true', 'false'], description: 'Only cards with a pending provider-portal change' })
  @IsOptional()
  @IsIn(['true', 'false'])
  todo?: string;
}
