import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SearchByNameDto {
  @ApiProperty({ description: 'Full name to search for (case-insensitive)' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;
}
