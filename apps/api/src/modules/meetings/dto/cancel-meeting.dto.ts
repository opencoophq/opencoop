import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CancelMeetingDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}
