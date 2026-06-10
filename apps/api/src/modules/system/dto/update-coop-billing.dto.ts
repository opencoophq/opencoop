import { IsDateString, IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCoopBillingDto {
  @ApiPropertyOptional({ enum: ['FREE', 'ESSENTIALS', 'PROFESSIONAL'] })
  @IsOptional()
  @IsIn(['FREE', 'ESSENTIALS', 'PROFESSIONAL'])
  plan?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'New trial end date (ISO date string)' })
  @IsOptional()
  @IsDateString()
  trialEndsAt?: string;

  @ApiPropertyOptional({ example: 14, description: 'Number of days to extend the trial by' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  extendTrialDays?: number;
}
