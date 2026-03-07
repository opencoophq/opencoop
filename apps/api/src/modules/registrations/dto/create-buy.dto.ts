import { IsString, IsInt, IsOptional, IsBoolean, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBuyDto {
  @ApiProperty({ description: 'Share class to purchase' })
  @IsString()
  shareClassId: string;

  @ApiProperty({ description: 'Number of shares to purchase', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ required: false, description: 'Project to assign shares to' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({ required: false, description: 'Whether this is a savings share (monthly installments)' })
  @IsOptional()
  @IsBoolean()
  isSavings?: boolean;
}
