import { IsString, IsObject, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CoopPermissions } from '@opencoop/shared';

export class UpdateRoleDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false })
  @IsObject()
  @IsOptional()
  permissions?: CoopPermissions;
}
