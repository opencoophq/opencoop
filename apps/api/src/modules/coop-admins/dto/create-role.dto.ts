import { IsString, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CoopPermissions } from '@opencoop/shared';

export class CreateRoleDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsObject()
  permissions: CoopPermissions;
}
