import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePaymentDateDto {
  @ApiProperty({ example: '2026-01-01', description: 'Bank value date of the payment' })
  @IsDateString()
  bankDate: string;
}
