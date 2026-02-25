import { IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserRoleDto {
  @ApiProperty({ example: 'COOP_ADMIN', enum: ['SYSTEM_ADMIN', 'COOP_ADMIN', 'SHAREHOLDER'] })
  @IsString()
  @IsIn(['SYSTEM_ADMIN', 'COOP_ADMIN', 'SHAREHOLDER'])
  role: string;
}
