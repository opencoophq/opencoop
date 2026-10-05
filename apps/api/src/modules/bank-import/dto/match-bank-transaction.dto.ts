import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Exactly one of the three is required; the service rejects any other combination with a 400.
export class MatchBankTransactionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  registrationId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  paymentId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  chargeCardId?: string;
}
