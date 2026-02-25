import { IsString, IsInt, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePurchaseDto {
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
}
