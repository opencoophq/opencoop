import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

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

  @ApiProperty({ required: false, enum: ['PENDING_CONFIRMATION', 'ACTIVE', 'WITHDRAWN'] })
  @IsOptional()
  @IsIn(['PENDING_CONFIRMATION', 'ACTIVE', 'WITHDRAWN'])
  status?: 'PENDING_CONFIRMATION' | 'ACTIVE' | 'WITHDRAWN';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  pageSize?: string;
}
