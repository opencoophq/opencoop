import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestChargeCardDto {
  @ApiProperty({ required: false, maxLength: 60, example: 'Auto Anna' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;
}
