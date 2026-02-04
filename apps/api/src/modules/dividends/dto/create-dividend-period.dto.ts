import { IsNumber, IsDateString, IsOptional, IsString, Min, Max, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDividendPeriodDto {
  @ApiProperty({ example: 'Q4 2024' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ example: 2024 })
  @IsNumber()
  @Min(2000)
  @Max(2100)
  year: number;

  @ApiProperty({ example: 2.5, description: 'Dividend rate as percentage (e.g., 2.5 = 2.5%)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  dividendRate: number;

  @ApiProperty({
    example: 30,
    description: 'Withholding tax rate as percentage (e.g., 30 = 30%)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  withholdingTaxRate?: number;

  @ApiProperty({ example: '2024-12-31', description: 'Shares owned before this date qualify' })
  @IsDateString()
  exDividendDate: string;

  @ApiProperty({ example: '2025-01-15', description: 'Date when dividends will be paid', required: false })
  @IsOptional()
  @IsDateString()
  paymentDate?: string;
}
