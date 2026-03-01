import { IsString, Length, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MfaEnableDto {
  @ApiProperty({ example: '123456', description: 'TOTP code from authenticator app' })
  @IsString()
  @Length(6, 6)
  code: string;
}

export class MfaVerifyDto {
  @ApiProperty({ description: 'Short-lived MFA-pending JWT token' })
  @IsString()
  mfaToken: string;

  @ApiProperty({ example: '123456', description: 'TOTP code or recovery code', required: false })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiProperty({ description: 'Recovery code (alternative to TOTP code)', required: false })
  @IsString()
  @IsOptional()
  recoveryCode?: string;
}

export class MfaDisableDto {
  @ApiProperty({ description: 'Current password for confirmation' })
  @IsString()
  password: string;
}
