import { IsEmail, IsString, MinLength, MaxLength, Matches, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ValidateUpgradeTokenDto {
  @ApiProperty()
  @IsString()
  token: string;
}

export class UpgradeToAdultDto {
  @ApiProperty({ description: 'Upgrade token received via email/link' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Securepass1', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain at least one lowercase letter, one uppercase letter, and one digit',
  })
  password: string;

  @ApiProperty({ example: 'nl', required: false })
  @IsOptional()
  @IsString()
  preferredLanguage?: string;
}
