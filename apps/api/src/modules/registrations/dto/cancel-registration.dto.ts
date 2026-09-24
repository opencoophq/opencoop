import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CancelRegistrationDto {
  @ApiPropertyOptional({ description: 'Reason for cancelling the registration' })
  @IsOptional()
  @IsString()
  reason?: string;
}
