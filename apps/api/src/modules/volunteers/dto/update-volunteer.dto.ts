import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const STATUSES = ['PENDING_CONFIRMATION', 'ACTIVE', 'WITHDRAWN'] as const;

export class UpdateVolunteerDto {
  @ApiProperty({ required: false, enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  interests?: string[];

  @ApiProperty({ required: false, type: [String], description: 'Alias of interests' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
}
