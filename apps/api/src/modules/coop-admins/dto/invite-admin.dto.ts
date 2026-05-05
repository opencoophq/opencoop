import { IsEmail, IsString, IsArray, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InviteAdminDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ type: [String], description: 'IDs of the roles the invitee will receive on acceptance. At least one.' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roleIds: string[];
}
