import { IsDateString, IsNumber, IsPositive } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddPaymentDto {
  @ApiProperty({ example: 50, description: 'Payment amount (must be positive)' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ example: '2026-01-01', description: 'Bank value date of the payment' })
  @IsDateString()
  bankDate: string;
}
