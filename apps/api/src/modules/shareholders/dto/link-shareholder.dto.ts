import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkShareholderDto {
  @ApiProperty({ description: 'ID of the User to link this shareholder to', example: 'clx...abc' })
  @IsString()
  @IsNotEmpty()
  targetUserId!: string;
}
