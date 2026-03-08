import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePontoSettingsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  autoMatchPayments?: boolean;
}
