import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class RenameVolunteerInterestDto {
  @ApiProperty()
  @IsString()
  @MaxLength(40)
  from: string;

  @ApiProperty()
  @IsString()
  @MaxLength(40)
  to: string;
}

export class UpdateVolunteerInterestsDto {
  @ApiProperty({
    required: false,
    type: [String],
    description: 'Replace the ordered list. An empty array restores the built-in defaults.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  interests?: string[];

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  add?: string[];

  @ApiProperty({ required: false, type: [RenameVolunteerInterestDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RenameVolunteerInterestDto)
  rename?: RenameVolunteerInterestDto[];

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  deactivate?: string[];

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  reorder?: string[];
}
