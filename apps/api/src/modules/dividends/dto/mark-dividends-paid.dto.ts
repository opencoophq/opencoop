import { IsOptional, IsString } from 'class-validator';

export class MarkDividendsPaidDto {
  @IsOptional()
  @IsString()
  paymentReference?: string;
}
