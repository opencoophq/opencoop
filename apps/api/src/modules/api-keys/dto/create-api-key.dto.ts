import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Claude Code - laptop' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}
