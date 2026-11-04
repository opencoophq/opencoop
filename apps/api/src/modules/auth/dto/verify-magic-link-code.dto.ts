import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyMagicLinkCodeDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit code from the sign-in email. Spaces are ignored.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code: string;
}
