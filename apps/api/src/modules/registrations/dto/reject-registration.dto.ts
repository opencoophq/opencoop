import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RejectRegistrationDto {
  @ApiProperty({ description: 'Reason for rejecting the registration' })
  @IsString()
  reason: string;
}
