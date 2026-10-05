import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class IssueChargeCardDto {
  @ApiProperty({ description: 'Printed card number or RFID UID', example: 'NL-ABC-123' })
  @IsString()
  @MaxLength(64)
  cardNumber: string;
}
