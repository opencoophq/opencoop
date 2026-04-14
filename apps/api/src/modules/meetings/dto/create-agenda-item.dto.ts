import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  Min,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgendaType, MajorityType } from '@opencoop/database';

export class ResolutionInputDto {
  @ApiProperty()
  @IsString()
  proposedText!: string;

  @ApiProperty({ enum: MajorityType })
  @IsEnum(MajorityType)
  majorityType!: MajorityType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  quorumRequired?: number;
}

export class CreateAgendaItemDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  order!: number;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: AgendaType })
  @IsEnum(AgendaType)
  type!: AgendaType;

  @ApiPropertyOptional({ type: ResolutionInputDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ResolutionInputDto)
  resolution?: ResolutionInputDto;
}
