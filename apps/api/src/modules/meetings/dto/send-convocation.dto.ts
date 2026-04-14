import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class SendConvocationDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirmShortNotice?: boolean;
}
