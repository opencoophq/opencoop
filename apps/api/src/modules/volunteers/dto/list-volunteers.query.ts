import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const STATUSES = ['PENDING_CONFIRMATION', 'ACTIVE', 'WITHDRAWN', 'ALL'] as const;

export class ListVolunteersQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  municipality?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  postalCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  interest?: string;

  @ApiProperty({ required: false, description: 'Alias of interest' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tag?: string;

  @ApiProperty({ required: false, enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
