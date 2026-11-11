import { IsString, IsNumber, IsBoolean, IsOptional, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateShareClassDto {
  @ApiProperty({ example: 'Class A' })
  @IsString()
  @MaxLength(50)
  name: string;

  @ApiProperty({ example: 'A' })
  @IsString()
  @MaxLength(10)
  code: string;

  @ApiProperty({ example: 250 })
  @IsNumber()
  @Min(0.01)
  pricePerShare: number;

  @ApiProperty({ example: 1, required: false })
  @IsOptional()
  @IsNumber()
  @Min(1)
  minShares?: number;

  @ApiProperty({ example: 100, required: false })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxShares?: number;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  hasVotingRights?: boolean;

  @ApiProperty({
    example: 0.035,
    description:
      'Override dividend rate as a fraction of share value. 0.035 means 3.5%. The admin form converts from percent.',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  dividendRateOverride?: number;
}
