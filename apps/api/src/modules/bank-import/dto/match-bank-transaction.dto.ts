import { IsNotEmpty, IsString } from 'class-validator';

export class MatchBankTransactionDto {
  @IsString()
  @IsNotEmpty()
  registrationId: string;
}
