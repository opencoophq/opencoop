import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { RSVPStatus } from '@opencoop/database';

export class RsvpUpdateDto {
  @ApiProperty({ enum: RSVPStatus })
  @IsEnum(RSVPStatus)
  status!: RSVPStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  delegateShareholderId?: string;
}
