import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Exactly one of the two is required; the service rejects both or neither with a 400.
export class MatchBankTransactionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  registrationId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  paymentId?: string;
}
