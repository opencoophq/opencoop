import { IsEmail, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WebAuthnRegisterVerifyDto {
  @ApiProperty({ description: 'Opaque WebAuthn registration ceremony response from the browser' })
  @IsObject()
  response: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Optional friendly name for the passkey' })
  @IsOptional()
  @IsString()
  friendlyName?: string;
}

export class WebAuthnAuthenticateOptionsDto {
  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class WebAuthnAuthenticateVerifyDto {
  @ApiProperty({ description: 'Opaque WebAuthn authentication ceremony response from the browser' })
  @IsObject()
  response: Record<string, unknown>;
}

export class WebAuthnRenameCredentialDto {
  @ApiProperty({ description: 'New friendly name for the passkey' })
  @IsString()
  @IsNotEmpty()
  friendlyName: string;
}
