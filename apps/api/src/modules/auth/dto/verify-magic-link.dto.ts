import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyMagicLinkDto {
  @ApiProperty({ example: 'abc123...' })
  @IsString()
  @IsNotEmpty()
  token: string;
}
