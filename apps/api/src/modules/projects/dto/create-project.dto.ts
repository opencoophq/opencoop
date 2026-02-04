import { IsString, IsOptional, MaxLength, IsEnum, IsNumber, Min, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ProjectType {
  SOLAR = 'SOLAR',
  WIND = 'WIND',
}

export class CreateProjectDto {
  @ApiProperty({ example: 'Solar Farm Project' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ enum: ProjectType, default: ProjectType.SOLAR })
  @IsOptional()
  @IsEnum(ProjectType)
  type?: ProjectType;

  @ApiProperty({ required: false, example: 250, description: 'Power capacity in kW' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  capacityKw?: number;

  @ApiProperty({ required: false, example: 300, description: 'Estimated annual production in MWh' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedAnnualMwh?: number;

  @ApiProperty({ required: false, example: '2024-01-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ required: false, example: '2044-12-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
