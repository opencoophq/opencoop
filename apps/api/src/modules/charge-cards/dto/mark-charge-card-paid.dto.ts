import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export const MANUAL_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'OTHER'] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export class MarkChargeCardPaidDto {
  @ApiPropertyOptional({
    description:
      'Payment date (YYYY-MM-DD). Defaults to today in Europe/Brussels; cannot be in the future.',
    example: '2026-11-16',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'paidAt must be a date in YYYY-MM-DD format' })
  paidAt?: string;

  @ApiProperty({ enum: MANUAL_PAYMENT_METHODS, example: 'CASH' })
  @IsIn(MANUAL_PAYMENT_METHODS)
  method: ManualPaymentMethod;

  @ApiPropertyOptional({ description: 'Free text, kept in the audit log', maxLength: 500 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  note?: string;
}
