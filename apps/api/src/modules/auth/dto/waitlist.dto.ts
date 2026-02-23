import { IsEmail, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WaitlistDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'essentials', required: false })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiProperty({ example: 'nl', required: false })
  @IsOptional()
  @IsString()
  locale?: string;
}
