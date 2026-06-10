import { IsDateString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CompleteRegistrationDto {
  @ApiPropertyOptional({ example: '2026-01-01', description: 'Bank value date of the payment' })
  @IsOptional()
  @IsDateString()
  bankDate?: string;
}
