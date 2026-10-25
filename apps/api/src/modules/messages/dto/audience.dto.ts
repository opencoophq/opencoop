import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class VolunteerAudienceFilterDto {
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

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  volunteerIds?: string[];
}

export class AudienceDto {
  @ApiProperty({ enum: ['ALL', 'PROJECT', 'SELECTED', 'VOLUNTEERS'], example: 'PROJECT' })
  @IsIn(['ALL', 'PROJECT', 'SELECTED', 'VOLUNTEERS'])
  type: 'ALL' | 'PROJECT' | 'SELECTED' | 'VOLUNTEERS';

  @ApiProperty({ required: false, description: 'Required when type is PROJECT' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({ required: false, description: 'Used when type is SELECTED', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shareholderIds?: string[];

  @ApiProperty({ required: false, description: 'Used when type is VOLUNTEERS' })
  @IsOptional()
  @ValidateNested()
  @Type(() => VolunteerAudienceFilterDto)
  volunteerFilter?: VolunteerAudienceFilterDto;
}
