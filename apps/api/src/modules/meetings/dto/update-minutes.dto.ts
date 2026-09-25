import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class UpdateMinutesDto {
  @ApiProperty()
  @IsString()
  content!: string;
}
